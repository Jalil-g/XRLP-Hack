// XRPL-16 · Stage readiness: GO / WARN / NO-GO per demo beat, for the 30 minutes before the slot. Read-only.
//
// `pnpm --filter @xrlp/xrpl stage:check [--json]` (scripts/stage-check.ts) reads the wallet file, .data/prestage.json,
// .data/prestage-preimages.json and ONE validated devnet ledger into a `StageSnapshot`. `evaluateStage(snapshot, now)`
// here is pure (offline-tested, test/stage-check.test.ts) and reuses the package's own rules instead of restating them:
// evaluatePreflight (release, XRPL-14), wrongFinishBlockers (ledger says no), cancelReadiness + planLoanPayment
// (stall → refund, XRPL-07), vaultPhase, defaultCoverDeposit (live lock-terms cover, XRPL-04). Time = the snapshot
// ledger's close_time; the wall clock only dates prestage.json.
//
// Secrets never enter a snapshot: `walletAddresses` keeps addresses only and `summarizePreimages` turns each preimage
// into its (public) condition in memory. No message, table cell or JSON field carries a preimage, fulfillment or seed.
import { createHash } from "node:crypto";
import { rippleTimeToISOTime } from "xrpl";
import { VERIFICATION_FEE_RLUSD } from "./compliance.ts";
import { conditionFromPreimage, normalizeCondition } from "./condition.ts";
import type { CredentialStatus, CredentialType } from "./credentials.ts";
import { cancelReadiness, FINISH_LLS_MARGIN, WRONG_FINISH_MIN_CANCEL_S, wrongFinishBlockers } from "./escrow.ts";
import { defaultCoverDeposit, expectedInterest, fromMicro, toMicro } from "./lending-math.ts";
import { LoanPayAmountError, planLoanPayment, type LoanEntry, type LoanPayPlan } from "./loan.ts";
import {
  DEFAULT_MARGIN_S,
  evaluatePreflight,
  MAX_CLOSE_INTERVAL_S,
  type AccountSnapshot,
  type LedgerNow,
  type PreflightReason,
  type PreflightRequest,
  type PreflightSnapshot,
  type TrustlineSnapshot,
} from "./preflight.ts";
import { PRESTAGE_KEYS, type PrestageFile, type PrestageKey, type PrestageProject } from "./prestage-types.ts";
import { dropsToXrpDecimal, toRlusd, type EscrowNode, type VaultNode } from "./reads.ts";
import { vaultPhase } from "./vault.ts";
import { WALLET_ROLES, type WalletRole } from "./wallets.ts";

// ---------------------------------------------------------------------------------------------------------
// Beats, statuses, defaults

/** Demo beats (docs/08-pitch-storyline.md §3) plus the investor withdrawal from Project C. */
export const STAGE_BEATS = ["D1", "D2", "D3", "D4", "D5", "D6", "withdraw"] as const;
export type StageBeat = (typeof STAGE_BEATS)[number];
export const STAGE_BEAT_TITLES: Record<StageBeat, string> = {
  D1: "verified builder",
  D2: "locked state",
  D3: "release",
  D4: "fraud held",
  D5: "ledger says no",
  D6: "stall → refund",
  withdraw: "withdraw (C)",
};
/** "D3 release" / "withdraw (C)". */
export const stageBeatLabel = (b: StageBeat) => (b.startsWith("D") ? `${b} ${STAGE_BEAT_TITLES[b]}` : STAGE_BEAT_TITLES[b]);

export type StageStatus = "GO" | "WARN" | "NO-GO";
const RANK: Record<StageStatus, number> = { GO: 0, WARN: 1, "NO-GO": 2 };
const worst = (ss: readonly StageStatus[]): StageStatus => ss.reduce<StageStatus>((a, s) => (RANK[s] > RANK[a] ? s : a), "GO");

/** Amendments the demo path runs on (docs/xrpl-protocol-notes.md §0). */
export const REQUIRED_AMENDMENTS = ["SingleAssetVault", "LendingProtocol", "LendingProtocolV1_1", "TokenEscrow", "Credentials", "PermissionedDomains", "BatchV1_1"] as const;
export const DEVNET_NETWORK_ID = 2;
/** rippled build the demo and prestage were proven on. Another build is a WARN (rehearse once). */
export const PROVEN_RIPPLED_VERSION = "3.4.1";
/** What the release path needs before CancelAfter: max(120 s, EscrowFinish LLS 60 ledgers × 5 s) = 300 s (XRPL-07/10). */
export const RELEASE_MARGIN_S = Math.max(DEFAULT_MARGIN_S, FINISH_LLS_MARGIN * MAX_CLOSE_INTERVAL_S);
/** bootstrap (ensureFundedWallets) tops a role up from the faucet below this many XRP. */
export const BOOTSTRAP_MIN_XRP = 30;
/** Terms of a live lock-terms when prestage.json has no Project A: A's terms in scripts/prestage.ts. */
export const DEFAULT_LOCK_TERMS = { principal: "30000", interestRateBps: 1000, paymentTotal: 6, paymentIntervalS: 30 * 86_400 } as const;

export interface StageOptions {
  /** Every beat runs within this many seconds of the check, so time gates must hold until now + windowS. Default 3600. */
  windowS?: number;
  /** WARN when prestage.json finished more than this many minutes ago (wall clock). Default 60. */
  maxAgeMin?: number;
  /** NO-GO when an account's spendable XRP (balance − reserve) is below this. Default 2. */
  minSpendableXrp?: number;
  /** WARN when an account holds less XRP than this (bootstrap would top it up). Default BOOTSTRAP_MIN_XRP. */
  topUpXrp?: number;
  /** Project A's SPV may hold this much RLUSD and still count as "liquid ≈ 0". Default "1". */
  spvDustRlusd?: string;
  /** server_info validated_ledger.age (s) above which devnet is a WARN / a NO-GO. Defaults 30 / 120. */
  ledgerAgeWarnS?: number;
  ledgerAgeNoGoS?: number;
}

export const STAGE_DEFAULTS: Readonly<Required<StageOptions>> = {
  windowS: 3_600,
  maxAgeMin: 60,
  minSpendableXrp: 2,
  topUpXrp: BOOTSTRAP_MIN_XRP,
  spvDustRlusd: "1",
  ledgerAgeWarnS: 30,
  ledgerAgeNoGoS: 120,
};

// ---------------------------------------------------------------------------------------------------------
// Snapshot (everything evaluateStage reads; `undefined` = not fetched, `null` = fetched and absent)

/** AccountRoot fields from account_info at the snapshot ledger. */
export interface StageAccount {
  /** Drops. */
  balance: string;
  ownerCount: number;
  flags: number;
}

export interface StageRole {
  address: string;
  /** `null` = no such account on the ledger (unfunded, or devnet was reset). */
  account?: StageAccount | null;
  /** RLUSD holders: the role's own side of its line to the issuer. `null` = no line. */
  rlusdLine?: TrustlineSnapshot | null;
  /** Statuses of the platform-issued credentials this check asks about. */
  credentials?: Partial<Record<CredentialType, CredentialStatus>>;
}

export interface StageProjectLedger {
  vault: VaultNode | null;
  loan: LoanEntry | null;
  /** Same order as `PrestageProject.escrows`. `null` = gone from the ledger (finished or cancelled). */
  escrows: (EscrowNode | null)[];
  spvAccount: StageAccount | null;
  /** The SPV's RLUSD balance. `null` = no RLUSD line. */
  spvRlusd: string | null;
  /** Raw share-MPT balance per investor role listed in `investments` ("0" = none). */
  shares: Record<string, string>;
}

export type StageDevnet =
  | { reachable: false; error: string }
  | {
      reachable: true;
      networkId?: number;
      buildVersion?: string;
      serverState?: string;
      /** server_info validated_ledger.age, seconds. */
      validatedAgeS?: number;
      reserveBaseXrp: number;
      reserveIncXrp: number;
      /** Amendment name -> enabled (at least every REQUIRED_AMENDMENTS name). */
      amendments: Record<string, boolean>;
      /** "ledger": the Amendments object of the snapshot ledger (default); "feature": the `feature` command (fallback). */
      amendmentsFrom?: "ledger" | "feature";
      /** Neither source could be read. */
      featureError?: string;
    };

/** One preimages-file entry, reduced to public data by `summarizePreimages`. */
export interface StagePreimage {
  /** The `condition` stored next to the preimage. */
  storedCondition: string;
  /** conditionFromPreimage(preimage), computed in memory. `undefined` = malformed preimage. */
  derivedCondition?: string;
}

export interface StageSnapshot {
  /** Repo-relative paths, for messages. */
  files: { wallets: string; prestage: string; preimages: string };
  config: {
    network: string;
    wsUrl: string;
    faucetHost: string;
    /** Prefix that makes a fix command use the same files, e.g. "WALLETS_FILE=.data/wallets.jalil.json ". */
    commandEnv: string;
  };
  devnet: StageDevnet;
  /** HEAD request to the faucet (never a funding POST). `ok` = it answered below HTTP 500. */
  faucet: { ok: boolean; status?: number; ms?: number; error?: string };
  wallets: {
    exists: boolean;
    /** Content-free reason the file couldn't be read (never a JSON excerpt: it would quote a seed). */
    error?: string;
    network?: string;
    roles: Partial<Record<WalletRole, StageRole>>;
    missingRoles: WalletRole[];
  };
  prestage: { exists: boolean; error?: string; file?: PrestageFile };
  preimages: {
    exists: boolean;
    error?: string;
    /** File permission bits (`stat.mode & 0o777`). */
    mode?: number;
    /** projectId -> milestoneId -> entry (A and B escrows only). */
    entries: Record<string, Record<string, StagePreimage>>;
  };
  /** Reads pinned to `now.ledger`. Absent when devnet was unreachable. */
  ledger?: {
    /** The pinned reads failed as a whole (connection dropped, ...). */
    error?: string;
    baseFeeDrops: number;
    projects: Partial<Record<PrestageKey, StageProjectLedger>>;
    /** Reads of one project failed (bad id in prestage.json, ...). */
    projectErrors?: Partial<Record<PrestageKey, string>>;
    /** deposit_authorized(releaseService -> builder). Only fetched when the builder has DepositAuth. */
    releasePreauthorized?: boolean;
  };
}

export interface StageNow {
  /** The validated ledger every read came from. `undefined` = devnet unreachable. */
  ledger?: LedgerNow;
  /** Wall clock, ms since the Unix epoch. Only dates prestage.json. */
  wallMs: number;
}

// ---------------------------------------------------------------------------------------------------------
// Report

export interface StageCheck {
  /** Stable id, e.g. "devnet.amendments", "wallets.builder.rlusd", "A.m1.release", "preimages.A.m1". */
  id: string;
  status: StageStatus;
  /** One line, safe to print: never a preimage, fulfillment or seed. */
  message: string;
  /** Beats this check gates (every beat for infrastructure). Empty = advisory: such a check is never NO-GO. */
  beats: StageBeat[];
  /** Exact command (or step) that fixes it. */
  fix?: string;
}

export interface StageBeatResult {
  beat: StageBeat;
  title: string;
  status: StageStatus;
  /** NO-GO / WARN: the worst checks' messages. GO: what was verified. */
  details: string[];
  fixes: string[];
}

export interface StageFixStep {
  command: string;
  eta?: string;
}

export interface StageReport {
  version: 1;
  /** No NO-GO (GO, or GO with warnings): exit code 0. */
  ok: boolean;
  status: StageStatus;
  /** Wall clock of the check. */
  checkedAt: string;
  ledger?: { index: number; closeTime: string };
  network: string;
  files: StageSnapshot["files"];
  prestage?: { finishedAt: string; ageMin: number; projects: Partial<Record<PrestageKey, string>> };
  beats: StageBeatResult[];
  checks: StageCheck[];
  /** What to run before the slot (fixes of every NO-GO), merged and in order. */
  fixes: StageFixStep[];
  /** Fixes of the warnings that the `fixes` don't already cover. Optional. */
  suggestions: StageFixStep[];
  counts: Record<StageStatus, number>;
}

// ---------------------------------------------------------------------------------------------------------
// Fix commands

export type StageFix =
  | { kind: "bootstrap"; preVerifyBuilder?: boolean }
  | { kind: "prestage"; only: readonly PrestageKey[] }
  | { kind: "chmod"; path: string }
  | { kind: "manual"; text: string };

const PKG = "pnpm --filter @xrlp/xrpl";
const orderKeys = (ks: Iterable<PrestageKey>): PrestageKey[] => {
  const s = new Set(ks);
  return PRESTAGE_KEYS.filter((k) => s.has(k));
};
const prestageEta = (ks: readonly PrestageKey[]) => (!ks.includes("C") ? "~3-5 min" : ks.length === 1 ? "~10 min" : "~13 min");

/** The exact command for a fix. `env` = the snapshot's `commandEnv`, so it runs against the same wallet and data files. */
export function renderFix(f: StageFix, env = ""): string {
  switch (f.kind) {
    case "bootstrap":
      return `${env}${PKG} bootstrap${f.preVerifyBuilder ? " --pre-verify-builder" : ""}`;
    case "prestage": {
      const ks = orderKeys(f.only);
      return `${env}${PKG} prestage${ks.length === PRESTAGE_KEYS.length ? "" : ` --only ${ks.join(",")}`}`;
    }
    case "chmod":
      return `chmod 600 ${f.path}`;
    case "manual":
      return f.text;
  }
}

/**
 * One fix sequence for many failures: manual steps (connectivity) first, then one bootstrap (with --pre-verify-builder if
 * any fix asked for it), one prestage for the union of projects (all three = plain `prestage`), then chmod.
 */
export function mergeFixes(fixes: readonly StageFix[], env = ""): StageFixStep[] {
  const out: StageFixStep[] = [];
  for (const text of new Set(fixes.flatMap((f) => (f.kind === "manual" ? [f.text] : [])))) out.push({ command: text });
  const boots = fixes.flatMap((f) => (f.kind === "bootstrap" ? [f] : []));
  if (boots.length) out.push({ command: renderFix({ kind: "bootstrap", preVerifyBuilder: boots.some((b) => b.preVerifyBuilder) }, env), eta: "~1 min" });
  const keys = orderKeys(fixes.flatMap((f) => (f.kind === "prestage" ? f.only : [])));
  if (keys.length) out.push({ command: renderFix({ kind: "prestage", only: keys }, env), eta: prestageEta(keys) });
  for (const path of new Set(fixes.flatMap((f) => (f.kind === "chmod" ? [f.path] : [])))) out.push({ command: renderFix({ kind: "chmod", path }) });
  return out;
}

/** Does running `have` already fix `f`? (bootstrap --pre-verify-builder covers bootstrap; prestage A,B covers prestage A.) */
function covered(f: StageFix, have: readonly StageFix[]): boolean {
  return have.some((h) => {
    if (f.kind === "bootstrap") return h.kind === "bootstrap" && (!f.preVerifyBuilder || !!h.preVerifyBuilder);
    if (f.kind === "prestage") return h.kind === "prestage" && f.only.every((k) => h.only.includes(k));
    if (f.kind === "chmod") return h.kind === "chmod" && h.path === f.path;
    return h.kind === "manual" && h.text === f.text;
  });
}

// ---------------------------------------------------------------------------------------------------------
// Secret reducers (pure): what the fetch layer runs on the wallet file and the preimages file

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Wallet file JSON -> addresses by role. A role counts only with an address and a seed; the seed is never copied out. */
export function walletAddresses(json: unknown): { network?: string; roles: Partial<Record<WalletRole, string>>; missingRoles: WalletRole[] } {
  if (!isObj(json)) throw new Error("not a wallet file (expected a JSON object)");
  const wallets = isObj(json.wallets) ? json.wallets : {};
  const roles: Partial<Record<WalletRole, string>> = {};
  for (const role of WALLET_ROLES) {
    const w = wallets[role];
    if (isObj(w) && typeof w.address === "string" && w.address && typeof w.seed === "string" && w.seed) roles[role] = w.address;
  }
  return { ...(typeof json.network === "string" ? { network: json.network } : {}), roles, missingRoles: WALLET_ROLES.filter((r) => !roles[r]) };
}

/**
 * Preimages file JSON (`PrestagePreimagesFile`) -> for each wanted escrow, the stored condition and the condition derived
 * from its preimage. The preimages themselves never leave this function. Throws (content-free) on a wrong shape.
 */
export function summarizePreimages(json: unknown, wanted: readonly { projectId: string; milestoneIds: readonly string[] }[]): Record<string, Record<string, StagePreimage>> {
  if (!isObj(json) || !isObj(json.projects)) throw new Error("not a PrestagePreimagesFile (no projects object)");
  const out: Record<string, Record<string, StagePreimage>> = {};
  for (const { projectId, milestoneIds } of wanted) {
    const p = json.projects[projectId];
    if (!isObj(p)) continue;
    for (const id of milestoneIds) {
      const e = p[id];
      if (!isObj(e)) continue;
      const pre = typeof e.preimage === "string" && /^[0-9a-f]{64}$/i.test(e.preimage) ? e.preimage : undefined;
      (out[projectId] ??= {})[id] = {
        storedCondition: typeof e.condition === "string" ? e.condition : "",
        ...(pre ? { derivedCondition: conditionFromPreimage(Buffer.from(pre, "hex")) } : {}),
      };
    }
  }
  return out;
}

/** Ledger index of the Amendments singleton (`keylet::amendments`). Its `Amendments` field lists the enabled amendment IDs. */
export const AMENDMENTS_LEDGER_INDEX = "7DB0788C020F02780A673DC74757F23823FA3014C1866E72CC4CD8B226CD6EF4";

/** Amendment ID = SHA-512Half of its name (rippled `feature` keys), uppercase hex. */
export function amendmentId(name: string): string {
  return createHash("sha512").update(name).digest().subarray(0, 32).toString("hex").toUpperCase();
}

/** First-loss cover the platform posts for a lock-terms on these terms (the setupPrivateProject sizing, XRPL-04). */
export function lockTermsCover(t: { principal: string; interestRateBps: number; paymentTotal: number; paymentIntervalS: number }): string {
  const interest = expectedInterest({ principal: t.principal, interestRate: t.interestRateBps * 10, paymentTotal: t.paymentTotal, paymentIntervalS: t.paymentIntervalS });
  return defaultCoverDeposit({ principal: t.principal, interest });
}

// ---------------------------------------------------------------------------------------------------------
// Formatting

/** 45 s · 12 min · 3.5 h · 29.9 d (absolute value). */
export function fmtDuration(seconds: number): string {
  const a = Math.abs(Math.round(seconds));
  if (a < 120) return `${a} s`;
  if (a < 7_200) return `${Math.round(a / 60)} min`;
  if (a < 172_800) return `${(a / 3_600).toFixed(1)} h`;
  return `${(a / 86_400).toFixed(1)} d`;
}
const isoAt = (rippleTime: number) => rippleTimeToISOTime(rippleTime).replace(".000Z", "Z");
const xrpOf = (drops: string) => Number(drops) / 1e6;
const fmtXrp = (n: number) => n.toFixed(2);
const short = (id: string) => (id.length > 12 ? `${id.slice(0, 8)}…` : id);
/** Holder-side RLUSD of a line ("0" without a line, or on the issuer's negative side). */
const lineRlusd = (l: TrustlineSnapshot | null | undefined) => (!l || l.balance.trim().startsWith("-") ? "0" : toRlusd(l.balance));
const micro = (v: string) => toMicro(toRlusd(v));
const escrowValue = (n: EscrowNode) => (typeof n.Amount === "string" ? dropsToXrpDecimal(n.Amount) : toRlusd(n.Amount.value));
const mLabel = (key: PrestageKey, index: number) => `${key} m${index + 1}`;
const phaseText = (ph: ReturnType<typeof vaultPhase>, redemption: string) =>
  ph === "subscription"
    ? "still in Subscription (the loan never closed)"
    : ph === "investment"
      ? `in Investment until RedemptionDate ${redemption}`
      : ph === "redemption"
        ? `past RedemptionDate ${redemption}`
        : "not a closed-ended vault";

// ---------------------------------------------------------------------------------------------------------
// Evaluation

/** Detail order inside a beat: project facts, then preimages, then wallets, then infrastructure. */
const idRank = (id: string) => (/^[ABC]\./.test(id) ? 0 : id.startsWith("preimages.") ? 1 : id.startsWith("wallets.") ? 2 : 3);

const PROJECT_BEATS: Record<PrestageKey, StageBeat[]> = { A: ["D1", "D2", "D3", "D4", "D5"], B: ["D6"], C: ["withdraw"] };
const SCENARIO: Record<PrestageKey, string> = { A: "ready", B: "stalled", C: "repaid" };
const INSPECTORS = ["inspector1", "inspector2", "inspector3"] as const;
const BOOT: StageFix = { kind: "bootstrap" };
const stage = (...only: PrestageKey[]): StageFix => ({ kind: "prestage", only });

/** Beats an account gates (it pays a fee there, or must exist for it). Inspectors: only the one A assigned. */
function roleBeats(role: WalletRole, assigned: WalletRole | undefined): readonly StageBeat[] | "all" {
  switch (role) {
    case "issuer":
      return "all";
    case "platform":
      return ["D1", "D2", "D5"];
    case "releaseService":
      return ["D3", "D6"];
    case "builder":
      return ["D1", "D3"];
    case "investor1":
    case "investor2":
      return ["D2", "withdraw"];
    case "investor3":
      return ["D2"];
    case "aiAgent":
      return ["D3", "D4"];
    case "trustee":
      return ["D6"];
    default:
      return role === assigned ? ["D3", "D4"] : [];
  }
}

/** Fix for a preflight refusal: re-stage for escrow-side problems, bootstrap for missing accounts / lines. */
function preflightFix(reason: PreflightReason | undefined, key: PrestageKey): StageFix {
  switch (reason) {
    case "destination_not_found":
    case "no_trustline":
    case "submitter_not_found":
    case "submitter_unfunded":
      return BOOT;
    case "trustline_limit":
    case "not_authorized":
    case "frozen":
    case "deposit_auth":
      return { kind: "manual", text: "fix the builder's RLUSD trust line / the issuer flags (see the message), then re-run" };
    default:
      return stage(key);
  }
}

interface Check {
  id: string;
  status: StageStatus;
  message: string;
  beats: StageBeat[];
  fix?: StageFix;
  /** The GO detail of this beat shows this check's message. */
  summary?: StageBeat;
}

/** State the sections share. Each section adds checks; the early ones also fill in what the later ones need. */
interface Ctx {
  snap: StageSnapshot;
  now: StageNow;
  o: Required<StageOptions>;
  checks: Check[];
  /** Set by walletFileChecks: every role present, on this network. */
  walletsOk: boolean;
  /** Set by prestageChecks: prestage.json, when it belongs to the wallet file. */
  file?: PrestageFile;
  ageMin?: number;
  /** Set by devnetChecks: the snapshot ledger and its reads, when usable. */
  ledger?: { now: LedgerNow; reads: NonNullable<StageSnapshot["ledger"]>; reserveBaseXrp: number; reserveIncXrp: number };
}

function add(c: Ctx, id: string, status: StageStatus, message: string, beats: readonly StageBeat[] | "all", extra: { fix?: StageFix; summary?: StageBeat } = {}) {
  const list = beats === "all" ? [...STAGE_BEATS] : [...beats];
  // An advisory check (it gates no beat) can't hold up the slot.
  c.checks.push({ id, status: !list.length && status === "NO-GO" ? "WARN" : status, message, beats: list, ...extra });
}

const addrOf = (c: Ctx, r: WalletRole) => c.snap.wallets.roles[r]?.address;
const reserveOf = (c: Ctx, a: StageAccount) => c.ledger!.reserveBaseXrp + c.ledger!.reserveIncXrp * a.ownerCount;

/**
 * Pure go/no-go. `now.ledger` must be the validated ledger the snapshot was read from (time gates use its close time,
 * and must hold until `close time + windowS`); `now.wallMs` only ages prestage.json.
 */
export function evaluateStage(snap: StageSnapshot, now: StageNow, opts: StageOptions = {}): StageReport {
  const o: Required<StageOptions> = { ...STAGE_DEFAULTS };
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) (o as Record<string, unknown>)[k] = v;
  const c: Ctx = { snap, now, o, checks: [], walletsOk: false };
  devnetChecks(c);
  walletFileChecks(c);
  prestageChecks(c);
  preimageChecks(c);
  if (c.ledger) {
    roleChecks(c);
    projectChecks(c);
  }
  return buildReport(c);
}

function devnetChecks(c: Ctx) {
  const { snap, o } = c;
  const d = snap.devnet;
  const ln = c.now.ledger;
  const ws = snap.config.wsUrl;
  if (!d.reachable) {
    add(c, "devnet.reachable", "NO-GO", `devnet unreachable at ${ws}: ${d.error}`, "all", { fix: { kind: "manual", text: `check the network and XRPL_WS_URL (${ws}), then re-run stage:check` } });
  } else if (!ln) {
    add(c, "devnet.reachable", "NO-GO", "devnet answered, but the validated ledger could not be read", "all", { fix: { kind: "manual", text: "re-run stage:check in a minute" } });
  } else {
    add(c, "devnet.reachable", "GO", `${ws}: validated ledger ${ln.ledgerIndex} @ ${isoAt(ln.closeTime)} (${d.serverState ?? "state ?"})`, "all");
    if (d.networkId === DEVNET_NETWORK_ID) add(c, "devnet.network", "GO", `network_id ${d.networkId} (devnet)`, "all");
    else {
      add(c, "devnet.network", "NO-GO", `network_id ${d.networkId ?? "unknown"}, expected ${DEVNET_NETWORK_ID} (devnet)`, "all", {
        fix: { kind: "manual", text: "point XRPL_WS_URL at devnet (wss://s.devnet.rippletest.net:51233)" },
      });
    }
    if (d.buildVersion === PROVEN_RIPPLED_VERSION) add(c, "devnet.rippled", "GO", `rippled ${d.buildVersion}`, []);
    else add(c, "devnet.rippled", "WARN", `rippled ${d.buildVersion ?? "?"}: the demo was proven on ${PROVEN_RIPPLED_VERSION}; rehearse once before the slot`, []);
    const age = d.validatedAgeS;
    if (age !== undefined && age > o.ledgerAgeNoGoS) {
      add(c, "devnet.ledger_age", "NO-GO", `the validated ledger is ${age} s old: devnet is not closing ledgers`, "all", {
        fix: { kind: "manual", text: "wait until devnet closes ledgers again (https://devnet.xrpl.org), then re-run stage:check" },
      });
    } else if (age !== undefined && age > o.ledgerAgeWarnS) add(c, "devnet.ledger_age", "WARN", `the validated ledger is ${age} s old (slow devnet?)`, []);
    else add(c, "devnet.ledger_age", "GO", `validated ledger age ${age ?? "?"} s`, []);
    const missing = REQUIRED_AMENDMENTS.filter((a) => d.amendments[a] !== true);
    const from = d.amendmentsFrom === "feature" ? "per `feature`" : `in the Amendments object of ledger ${ln.ledgerIndex}`;
    if (d.featureError) {
      add(c, "devnet.amendments", "NO-GO", `could not read the amendments: ${d.featureError}`, "all", { fix: { kind: "manual", text: "re-run stage:check" } });
    } else if (missing.length) {
      add(c, "devnet.amendments", "NO-GO", `not enabled ${from}: ${missing.join(", ")} (devnet reset or upgraded?)`, "all", {
        fix: { kind: "manual", text: "check the devnet amendments (https://devnet.xrpl.org); once they are back, re-run bootstrap and prestage" },
      });
    } else add(c, "devnet.amendments", "GO", `enabled ${from}: ${REQUIRED_AMENDMENTS.join(", ")}`, "all");
    if (snap.ledger?.error) {
      add(c, "devnet.reads", "NO-GO", `ledger reads failed at ledger ${ln.ledgerIndex}: ${snap.ledger.error}`, "all", { fix: { kind: "manual", text: "re-run stage:check" } });
    } else if (snap.ledger) c.ledger = { now: ln, reads: snap.ledger, reserveBaseXrp: d.reserveBaseXrp, reserveIncXrp: d.reserveIncXrp };
  }
  const fz = snap.faucet;
  const host = snap.config.faucetHost;
  if (fz.ok) add(c, "devnet.faucet", "GO", `faucet ${host} answers (HTTP ${fz.status ?? "?"} to HEAD in ${fz.ms ?? "?"} ms; funding is POST-only)`, ["D2"]);
  else {
    const why = fz.status ? `HTTP ${fz.status}` : `unreachable${fz.error ? ` (${fz.error})` : ""}`;
    add(c, "devnet.faucet", "WARN", `faucet ${host} ${why}: bootstrap top-ups, prestage and a live lock-terms (new SPV account) need it`, ["D2"]);
  }
}

function walletFileChecks(c: Ctx) {
  const W = c.snap.wallets;
  const F = c.snap.files;
  const net = c.snap.config.network;
  if (!W.exists) add(c, "wallets.file", "NO-GO", `no wallet file at ${F.wallets}`, "all", { fix: BOOT });
  else if (W.error) {
    add(c, "wallets.file", "NO-GO", `${F.wallets} is unreadable (${W.error})`, "all", {
      fix: { kind: "manual", text: `restore ${F.wallets} from a backup (bootstrap --fresh makes new accounts: re-run prestage after it)` },
    });
  } else if (W.network !== undefined && W.network !== net) {
    add(c, "wallets.file", "NO-GO", `${F.wallets} is for ${W.network}, not ${net}`, "all", { fix: { kind: "manual", text: `use a ${net} wallet file (WALLETS_FILE=...)` } });
  } else if (W.missingRoles.length) add(c, "wallets.file", "NO-GO", `${F.wallets} lacks ${W.missingRoles.join(", ")}`, "all", { fix: BOOT });
  else {
    c.walletsOk = true;
    add(c, "wallets.file", "GO", `${WALLET_ROLES.length} roles in ${F.wallets}`, "all");
  }
}

function prestageChecks(c: Ctx) {
  const P = c.snap.prestage;
  const F = c.snap.files;
  if (!P.exists) add(c, "prestage.file", "NO-GO", `no prestage file at ${F.prestage}`, "all", { fix: stage(...PRESTAGE_KEYS) });
  else if (P.error || !P.file) add(c, "prestage.file", "NO-GO", `${F.prestage} is not a valid PrestageFile: ${P.error ?? "empty"}`, "all", { fix: stage(...PRESTAGE_KEYS) });
  else {
    const pf = P.file;
    const problems: string[] = [];
    if (pf.network !== c.snap.config.network) problems.push(`staged on ${pf.network}`);
    if (c.walletsOk) {
      if (pf.rlusd.issuer !== addrOf(c, "issuer")) problems.push("another RLUSD issuer");
      const differ = WALLET_ROLES.filter((r) => pf.accounts[r] !== undefined && pf.accounts[r] !== addrOf(c, r));
      if (differ.length) problems.push(`other accounts for ${differ.join(", ")}`);
    }
    if (problems.length) {
      add(c, "prestage.file", "NO-GO", `${F.prestage} does not belong to ${F.wallets}: ${problems.join("; ")}. Use the WALLETS_FILE that staged it, or re-stage`, "all", { fix: stage(...PRESTAGE_KEYS) });
      return;
    }
    c.file = pf;
    const keys = PRESTAGE_KEYS.filter((k) => pf.projects[k]);
    add(c, "prestage.file", "GO", `${F.prestage}: ${keys.map((k) => `${k} ${pf.projects[k]!.projectId}`).join(", ")}`, "all");
    const ageMin = (c.now.wallMs - Date.parse(pf.finishedAt)) / 60_000;
    if (Number.isFinite(ageMin)) {
      c.ageMin = ageMin;
      if (ageMin > c.o.maxAgeMin) {
        add(c, "prestage.age", "WARN", `prestage.json finished ${fmtDuration(ageMin * 60)} ago (> ${c.o.maxAgeMin} min): re-stage A,B if you rehearsed since`, [], { fix: stage("A", "B") });
      } else add(c, "prestage.age", "GO", `prestage.json finished ${fmtDuration(ageMin * 60)} ago`, []);
    }
    for (const k of PRESTAGE_KEYS) {
      if (!pf.projects[k]) add(c, `prestage.${k}`, "NO-GO", `prestage.json has no project ${k} (${SCENARIO[k]})`, PROJECT_BEATS[k], { fix: stage(k) });
    }
  }
}

/** The preimage of every A and B escrow hashes to its Condition. Only A m1 (the D3 release) is a NO-GO. */
function preimageChecks(c: Ctx) {
  const file = c.file;
  if (!file) return;
  const PI = c.snap.preimages;
  const F = c.snap.files;
  if (!PI.exists) {
    add(c, "preimages.file", "NO-GO", `no preimages file at ${F.preimages}: core has no fulfillment for A m1`, ["D3"], { fix: stage("A", "B") });
    return;
  }
  if (PI.error) {
    add(c, "preimages.file", "NO-GO", `${F.preimages} is unreadable (${PI.error})`, ["D3"], {
      fix: { kind: "manual", text: `mv ${F.preimages} ${F.preimages}.bad && ${renderFix(stage("A", "B"), c.snap.config.commandEnv)}` },
    });
    return;
  }
  add(c, "preimages.file", "GO", `${F.preimages} readable`, []);
  if (PI.mode !== undefined && (PI.mode & 0o077) !== 0) {
    add(c, "preimages.mode", "WARN", `${F.preimages} is mode ${PI.mode.toString(8)}: it holds escrow preimages, make it 600`, [], { fix: { kind: "chmod", path: F.preimages } });
  } else if (PI.mode !== undefined) add(c, "preimages.mode", "GO", `${F.preimages} mode 600`, []);
  for (const k of ["A", "B"] as const) {
    const p = file.projects[k];
    if (!p) continue;
    const onLedger = c.ledger?.reads.projects[k]?.escrows;
    p.escrows.forEach((e, i) => {
      const critical = k === "A" && i === 0;
      const sev: StageStatus = critical ? "NO-GO" : "WARN";
      const beats: StageBeat[] = critical ? ["D3"] : [];
      const label = mLabel(k, e.index ?? i);
      const node = onLedger?.[i] ?? null;
      const want = normalizeCondition(node?.Condition ?? e.condition);
      const where = node?.Condition ? "on-ledger" : "staged";
      const entry = PI.entries[p.projectId]?.[e.milestoneId];
      const id = `preimages.${k}.m${i + 1}`;
      const why = critical ? ": the release can't happen" : " (core's preimage import, CORE-12, wants one per escrow)";
      if (!entry) add(c, id, sev, `${label}: no preimage in ${F.preimages}${why}`, beats, { fix: stage(k) });
      else if (!entry.derivedCondition) add(c, id, sev, `${label}: the stored preimage is malformed${why}`, beats, { fix: stage(k) });
      else if (normalizeCondition(entry.derivedCondition) !== want) add(c, id, sev, `${label}: the preimage does not match the ${where} escrow Condition${why}`, beats, { fix: stage(k) });
      else if (normalizeCondition(entry.storedCondition) !== want) add(c, id, sev, `${label}: the condition stored with the preimage differs from the ${where} one${why}`, beats, { fix: stage(k) });
      else add(c, id, "GO", `${label}: preimage matches the ${where} Condition`, beats, critical ? { summary: "D3" } : {});
    });
  }
}

/** XRP per role, credentials (KYC x2, none for investor3, the inspector panel, VERIFIED_BUILDER), builder + platform RLUSD. */
function roleChecks(c: Ctx) {
  const R = c.snap.wallets.roles;
  const o = c.o;
  const A = c.file?.projects.A;
  const assigned = A ? INSPECTORS.find((r) => addrOf(c, r) === A.assignedInspector) : undefined;
  if (A && c.walletsOk && !assigned) {
    add(c, "A.inspector", "NO-GO", `A's assigned inspector ${A.assignedInspector} is not inspector1..3 of ${c.snap.files.wallets}: nobody can sign the audit`, ["D3", "D4"], { fix: stage("A") });
  }
  for (const role of WALLET_ROLES) {
    const r = R[role];
    if (!r || r.account === undefined) continue;
    const beats = roleBeats(role, assigned);
    // Multisig signers need no funded account, so the trustee can only WARN.
    const cap: StageStatus = role === "trustee" ? "WARN" : "NO-GO";
    const id = `wallets.${role}.xrp`;
    if (r.account === null) {
      add(c, id, cap, `${role} ${r.address} is not on the ledger (never funded, or devnet was reset)`, beats, { fix: BOOT });
      continue;
    }
    const bal = xrpOf(r.account.balance);
    const reserve = reserveOf(c, r.account);
    const spendable = bal - reserve;
    if (spendable < o.minSpendableXrp) add(c, id, cap, `${role} can spend ${fmtXrp(spendable)} XRP (${fmtXrp(bal)} − ${fmtXrp(reserve)} reserve) < ${o.minSpendableXrp}`, beats, { fix: BOOT });
    else if (bal < o.topUpXrp) add(c, id, "WARN", `${role} holds ${fmtXrp(bal)} XRP (< ${o.topUpXrp}: bootstrap tops it up)`, beats, { fix: BOOT });
    else add(c, id, "GO", `${role} ${fmtXrp(bal)} XRP (${fmtXrp(spendable)} spendable)`, beats);
  }

  const cred = (role: WalletRole, type: CredentialType) => R[role]?.credentials?.[type];
  const vb = cred("builder", "VERIFIED_BUILDER");
  if (vb === "accepted") add(c, "wallets.builder.verified", "GO", "builder holds VERIFIED_BUILDER", ["D1"], { summary: "D1" });
  else if (vb !== undefined) {
    add(c, "wallets.builder.verified", "NO-GO", `builder's VERIFIED_BUILDER is ${vb}: the Verified badge has no credential behind it`, ["D1"], { fix: { kind: "bootstrap", preVerifyBuilder: true } });
  }
  for (const inv of ["investor1", "investor2"] as const) {
    const s = cred(inv, "KYC_INVESTOR");
    if (s === "accepted") add(c, `wallets.${inv}.kyc`, "GO", `${inv} holds KYC_INVESTOR`, ["D2"]);
    else if (s !== undefined) add(c, `wallets.${inv}.kyc`, "NO-GO", `${inv}'s KYC_INVESTOR is ${s}: not a member of the vault domain`, ["D2"], { fix: BOOT });
  }
  const k3 = cred("investor3", "KYC_INVESTOR");
  if (k3 === "none") add(c, "wallets.investor3.no_kyc", "GO", "investor3 has no KYC_INVESTOR (the tecNO_AUTH deposit)", ["D2"]);
  else if (k3 === "accepted") {
    add(c, "wallets.investor3.no_kyc", "NO-GO", "investor3 holds an accepted KYC_INVESTOR: its deposit would go through and the tecNO_AUTH story breaks", ["D2"], { fix: BOOT });
  } else if (k3 !== undefined) {
    // Domain membership needs an ACCEPTED credential, so a pending one still gets tecNO_AUTH.
    add(c, "wallets.investor3.no_kyc", "WARN", "investor3 has a pending KYC_INVESTOR (deposit still tecNO_AUTH; bootstrap deletes it)", ["D2"], { fix: BOOT });
  }
  for (const insp of INSPECTORS) {
    const s = cred(insp, "VERIFIED_INSPECTOR");
    if (s === undefined) continue;
    const mine = insp === assigned;
    const beats: StageBeat[] = mine ? ["D3", "D4"] : [];
    if (s === "accepted") add(c, `wallets.${insp}.verified`, "GO", `${insp} holds VERIFIED_INSPECTOR${mine ? " (A's assigned inspector)" : ""}`, beats);
    else add(c, `wallets.${insp}.verified`, "NO-GO", `${insp}'s VERIFIED_INSPECTOR is ${s}${mine ? ": A's assigned inspector is not on the verified panel" : " (panel)"}`, beats, { fix: BOOT });
  }

  const fee = VERIFICATION_FEE_RLUSD;
  const bl = R.builder?.rlusdLine;
  if (bl !== undefined) {
    const b = lineRlusd(bl);
    if (micro(b) >= toMicro(fee)) add(c, "wallets.builder.rlusd", "GO", `builder ${b} RLUSD ≥ ${fee} verification fee`, ["D1"], { summary: "D1" });
    else add(c, "wallets.builder.rlusd", "NO-GO", `builder ${b} RLUSD < the ${fee} RLUSD verification fee${bl ? "" : " (no RLUSD line)"}`, ["D1"], { fix: BOOT });
  }
  const pl = R.platform?.rlusdLine;
  if (pl !== undefined) {
    const terms = A ? { principal: A.terms.principal, interestRateBps: A.terms.interestRateBps, paymentTotal: A.terms.paymentTotal, paymentIntervalS: A.terms.paymentIntervalS } : DEFAULT_LOCK_TERMS;
    const need = lockTermsCover(terms);
    const b = lineRlusd(pl);
    if (micro(b) >= toMicro(need)) add(c, "wallets.platform.rlusd", "GO", `platform ${b} RLUSD ≥ ${need} cover for a live lock-terms (A terms)`, ["D2"], { summary: "D2" });
    else add(c, "wallets.platform.rlusd", "NO-GO", `platform ${b} RLUSD < ${need} first-loss cover a live lock-terms posts (A terms)`, ["D2"], { fix: BOOT });
  }
}

/** The ledger side of A / B / C. A project whose reads failed is one NO-GO for its beats, nothing else. */
function projectChecks(c: Ctx) {
  const L = c.ledger!.reads;
  const errs = L.projectErrors ?? {};
  for (const k of PRESTAGE_KEYS) {
    if (c.file?.projects[k] && errs[k]) add(c, `${k}.reads`, "NO-GO", `could not read project ${k} at ledger ${c.ledger!.now.ledgerIndex}: ${errs[k]}`, PROJECT_BEATS[k], { fix: stage(k) });
  }
  const pair = (k: PrestageKey) => {
    const p = c.file?.projects[k];
    const l = L.projects[k];
    return p && l && !errs[k] ? { p, l } : undefined;
  };
  const a = pair("A");
  if (a) projectA(c, a.p, a.l);
  const b = pair("B");
  if (b) projectB(c, b.p, b.l);
  const cc = pair("C");
  if (cc) projectC(c, cc.p, cc.l);
}

/** A preflight input for one of `key`'s escrows, from the snapshot: builder as destination, `submitter` paying. */
function preflightInput(c: Ctx, key: PrestageKey, i: number, req: PreflightRequest, submitter: WalletRole): PreflightSnapshot {
  const R = c.snap.wallets.roles;
  const L = c.ledger!.reads;
  const acct = (r: StageRole | undefined): AccountSnapshot | null | undefined =>
    r?.account === undefined ? undefined : r.account === null ? null : { address: r.address, balance: r.account.balance, flags: r.account.flags };
  const builder = acct(R.builder);
  const issuer = acct(R.issuer);
  const payer = acct(R[submitter]);
  return {
    request: req,
    escrow: L.projects[key]?.escrows[i] ?? null,
    ...(builder !== undefined ? { destinationAccount: builder } : {}),
    trustline: R.builder?.rlusdLine ?? null,
    ...(issuer !== undefined ? { issuerAccount: issuer } : {}),
    ...(payer !== undefined ? { submitterAccount: payer } : {}),
    ...(L.releasePreauthorized !== undefined ? { submitterPreauthorized: L.releasePreauthorized } : {}),
    baseFeeDrops: L.baseFeeDrops,
  };
}

/** D2 locked state, D3 release (m1), D4 fraud held (m2), D5 ledger says no (m2). */
function projectA(c: Ctx, A: PrestageProject, la: StageProjectLedger) {
  const ln = c.ledger!.now;
  const t = ln.closeTime;
  const tw = t + c.o.windowS;
  const v = la.vault;
  if (!v) add(c, "A.vault", "NO-GO", `A vault ${short(A.chain.vaultId)} is not on the ledger`, ["D2", "D3", "D4", "D5"], { fix: stage("A") });
  else {
    const ph = vaultPhase(v, t);
    const red = v.RedemptionDate ? isoAt(v.RedemptionDate) : "?";
    if (ph === "investment" && vaultPhase(v, tw) === "investment") add(c, "A.vault", "GO", `A vault in Investment until ${red.slice(0, 10)}`, ["D2"], { summary: "D2" });
    else if (ph === "investment") add(c, "A.vault", "WARN", `A vault reaches its RedemptionDate ${red} within the window`, ["D2"], { fix: stage("A") });
    else add(c, "A.vault", "NO-GO", `A vault: ${phaseText(ph, red)}, expected Investment`, ["D2"], { fix: stage("A") });
  }
  if (!la.loan) add(c, "A.loan", "NO-GO", `A loan ${short(A.chain.loanId)} is not on the ledger`, ["D2", "D3", "D4", "D5"], { fix: stage("A") });
  else if (!(la.loan.PaymentRemaining ?? 0)) add(c, "A.loan", "NO-GO", "A loan is fully repaid: not a ready project", ["D2"], { fix: stage("A") });
  else add(c, "A.loan", "GO", `A loan ${toRlusd(la.loan.PrincipalOutstanding)} outstanding, ${la.loan.PaymentRemaining} payments left`, ["D2"]);
  // Every A escrow open, and each CancelAfter beyond the release margin for the whole window (else: WARN).
  const escrows = A.escrows.map((e, i) => {
    const n = la.escrows[i] ?? null;
    const label = mLabel("A", e.index ?? i);
    const left = n?.CancelAfter === undefined ? Infinity : n.CancelAfter - t;
    return { label, left, state: !n ? "gone" : left < 0 ? "expired" : left < RELEASE_MARGIN_S + c.o.windowS ? "soon" : "open" };
  });
  const open = escrows.filter((x) => x.state === "open" || x.state === "soon").length;
  const bad = escrows.filter((x) => x.state === "gone" || x.state === "expired");
  const soon = escrows.filter((x) => x.state === "soon");
  if (bad.length) add(c, "A.escrows", "NO-GO", `A: ${open}/${A.escrows.length} escrows open (${bad.map((x) => `${x.label} ${x.state}`).join(", ")}; a rehearsal?)`, ["D2"], { fix: stage("A") });
  else if (soon.length) {
    add(c, "A.escrows", "WARN", `A: ${soon.map((x) => `${x.label} CancelAfter in ${fmtDuration(x.left)}`).join(", ")} (< ${RELEASE_MARGIN_S} s release margin + the window)`, ["D2"], { fix: stage("A") });
  } else add(c, "A.escrows", "GO", `${open}/${A.escrows.length} escrows open`, ["D2"], { summary: "D2" });
  if (la.spvRlusd === null) add(c, "A.spv", "WARN", `A SPV ${A.chain.spv} has no RLUSD line`, ["D2"], { fix: stage("A") });
  else if (micro(la.spvRlusd) <= micro(c.o.spvDustRlusd)) add(c, "A.spv", "GO", `SPV ${toRlusd(la.spvRlusd)} RLUSD liquid`, ["D2"], { summary: "D2" });
  else add(c, "A.spv", "WARN", `A SPV holds ${toRlusd(la.spvRlusd)} RLUSD liquid (the money map says ≈ 0)`, ["D2"], { fix: stage("A") });

  // D3: the release service's EscrowFinish of m1, judged the way preflightFinish will judge it (margin 300 s).
  const e1 = A.escrows[0];
  const builder = addrOf(c, "builder");
  const rsvc = addrOf(c, "releaseService");
  if (!e1) add(c, "A.m1.release", "NO-GO", "prestage.json A has no escrows", ["D3"], { fix: stage("A") });
  else if (builder && rsvc) {
    const req: PreflightRequest = { owner: e1.owner, offerSequence: e1.offerSequence, destination: builder, condition: e1.condition, submitter: rsvc, marginS: DEFAULT_MARGIN_S, lastLedgerOffset: FINISH_LLS_MARGIN };
    const snapM1 = preflightInput(c, "A", 0, req, "releaseService");
    const r0 = evaluatePreflight(snapM1, ln);
    const rw = evaluatePreflight(snapM1, { ...ln, closeTime: tw });
    const left = r0.details.secondsToCancelAfter;
    const label = `A m1 seq ${e1.offerSequence}`;
    if (!r0.ok) add(c, "A.m1.release", "NO-GO", `${label}: the release preflight would refuse (${r0.reason}: ${r0.message})`, ["D3"], { fix: preflightFix(r0.reason, "A") });
    else if (!rw.ok) {
      const by = left !== undefined ? `CancelAfter is ${fmtDuration(left)} away, release before ${isoAt(t + left - RELEASE_MARGIN_S)}` : rw.message ?? "refused later";
      add(c, "A.m1.release", "WARN", `${label}: release ok now, but not for the whole ${fmtDuration(c.o.windowS)} window (${by})`, ["D3"], { fix: stage("A") });
    } else {
      const cancel = left !== undefined ? `${fmtDuration(left)} to CancelAfter` : "no CancelAfter";
      add(c, "A.m1.release", "GO", `${label}: release preflight ok (${cancel}, needs ≥ ${RELEASE_MARGIN_S} s), builder RLUSD line ok`, ["D3"], { summary: "D3" });
    }
  }

  // D4: m2 must stay locked through the beat.
  const e2 = A.escrows[1];
  const n2 = la.escrows[1] ?? null;
  if (!e2) add(c, "A.m2.locked", "NO-GO", "prestage.json A has no second escrow", ["D4", "D5"], { fix: stage("A") });
  else if (!n2) add(c, "A.m2.locked", "NO-GO", `A m2 seq ${e2.offerSequence} is gone from the ledger (finished or cancelled in a rehearsal?)`, ["D4"], { fix: stage("A") });
  else {
    const left = n2.CancelAfter === undefined ? Infinity : n2.CancelAfter - t;
    if (left <= 0) add(c, "A.m2.locked", "NO-GO", `A m2 seq ${e2.offerSequence} expired ${fmtDuration(-left)} ago (anyone can cancel it)`, ["D4"], { fix: stage("A") });
    else if (left <= c.o.windowS) add(c, "A.m2.locked", "WARN", `A m2 seq ${e2.offerSequence} expires in ${fmtDuration(left)}, inside the window`, ["D4"], { fix: stage("A") });
    else add(c, "A.m2.locked", "GO", `A m2 seq ${e2.offerSequence} locked (${Number.isFinite(left) ? `${fmtDuration(left)} to CancelAfter` : "no CancelAfter"})`, ["D4"], { summary: "D4" });
  }

  // D5: the platform's EscrowFinish with a random fulfillment must reach the ledger (tecCRYPTOCONDITION_ERROR).
  const platform = addrOf(c, "platform");
  if (e2 && platform) {
    const snapM2 = preflightInput(c, "A", 1, { owner: e2.owner, offerSequence: e2.offerSequence, submitter: platform }, "platform");
    const b0 = wrongFinishBlockers(evaluatePreflight(snapM2, ln));
    const bw = wrongFinishBlockers(evaluatePreflight(snapM2, { ...ln, closeTime: tw }));
    if (b0.length) {
      add(c, "A.m2.wrong_finish", "NO-GO", `A m2: the random-fulfillment EscrowFinish would be refused before submitting (${b0[0]!.reason}: ${b0[0]!.message}), so no tecCRYPTOCONDITION_ERROR`, ["D5"], {
        fix: preflightFix(b0[0]!.reason, "A"),
      });
    } else if (bw.length) {
      const ca = n2?.CancelAfter;
      const when = ca !== undefined ? `A m2 expires in ${fmtDuration(ca - t)}: run the random-fulfillment try before ${isoAt(ca - WRONG_FINISH_MIN_CANCEL_S)}` : `A m2: ${bw[0]!.message}`;
      add(c, "A.m2.wrong_finish", "WARN", `${when} (later it is refused before submitting, no tecCRYPTOCONDITION_ERROR)`, ["D5"], { fix: stage("A") });
    } else add(c, "A.m2.wrong_finish", "GO", "A m2: nothing blocks the platform's random-fulfillment EscrowFinish (expect tecCRYPTOCONDITION_ERROR)", ["D5"], { summary: "D5" });
  }
}

/** D6: keeper EscrowCancel of the stall escrow, then the refund LoanPay (on time, ≥ one periodic payment). */
function projectB(c: Ctx, B: PrestageProject, lb: StageProjectLedger) {
  const t = c.ledger!.now.closeTime;
  const tw = t + c.o.windowS;
  const si = B.escrows.findIndex((e) => e.state === "expired");
  const e = B.escrows[si];
  if (!e) {
    add(c, "B.stall", "NO-GO", "prestage.json B has no expired (stall) escrow", ["D6"], { fix: stage("B") });
    return;
  }
  const label = `${mLabel("B", e.index ?? si)} seq ${e.offerSequence}`;
  const node = lb.escrows[si] ?? null;
  const cr = cancelReadiness(node, t);
  if (!node) add(c, "B.stall", "NO-GO", `${label} is already gone (cancelled in a rehearsal?): the keeper tick has nothing to cancel`, ["D6"], { fix: stage("B") });
  else if (cr.ok) add(c, "B.stall", "GO", `${label} cancellable (CancelAfter passed ${fmtDuration(cr.secondsPast)} ago)`, ["D6"], { summary: "D6" });
  else if (cr.reason === "too_soon" && (cr.secondsLeft ?? Infinity) <= c.o.windowS) {
    add(c, "B.stall", "WARN", `${label} becomes cancellable in ${fmtDuration(cr.secondsLeft ?? 0)}: run the keeper tick after that`, ["D6"]);
  } else add(c, "B.stall", "NO-GO", `${label}: ${cr.message}`, ["D6"], { fix: stage("B") });

  const loan = lb.loan;
  // What the refund LoanPay would carry: the escrow (if still open) + what the SPV already holds. A consumed escrow's
  // money is already in the SPV (cancelled) or with the builder (finished), so it is not counted twice.
  const refundMicro = (node ? micro(escrowValue(node)) : 0n) + (lb.spvRlusd ? micro(lb.spvRlusd) : 0n);
  if (!loan) add(c, "B.refund", "NO-GO", `B loan ${short(B.chain.loanId)} is not on the ledger`, ["D6"], { fix: stage("B") });
  else if (node || refundMicro > 0n) {
    // (Escrow gone and nothing in the SPV: B.stall already says why, there is nothing to refund.)
    const refund = fromMicro(refundMicro);
    const plan = (at: number): LoanPayPlan | Error => {
      try {
        return planLoanPayment({ loan, nowRipple: at, amount: refund, source: "escrow_refund" });
      } catch (err) {
        if (err instanceof LoanPayAmountError) return err;
        throw err;
      }
    };
    const p0 = plan(t);
    const pw = plan(tw);
    const due = loan.NextPaymentDueDate;
    if (p0 instanceof Error) add(c, "B.refund", "NO-GO", `B refund LoanPay ${refund}: ${p0.message}`, ["D6"], { fix: stage("B") });
    else if (p0.late) {
      add(c, "B.refund", "NO-GO", `B refund LoanPay would be late: NextPaymentDueDate ${due ? isoAt(due) : "?"} passed (without tfLoanLatePayment that is tecEXPIRED; GracePeriod only delays a default)`, ["D6"], {
        fix: stage("B"),
      });
    } else if (pw instanceof Error || pw.late) {
      add(c, "B.refund", "WARN", `B's next payment falls due ${due ? `${isoAt(due)}, in ${fmtDuration(due - t)}` : "soon"}, inside the window: refund before then`, ["D6"], { fix: stage("B") });
    } else if (!p0.overpaymentAllowed) add(c, "B.refund", "WARN", "B loan lacks lsfLoanOverpayment: the refund pays installments instead of principal", ["D6"], { fix: stage("B") });
    else add(c, "B.refund", "GO", `refund ${refund} ≥ one periodic payment ${p0.minimum} (LoanPay ${p0.mode}), next due in ${due ? fmtDuration(due - t) : "?"}`, ["D6"], { summary: "D6" });
  }
  const sa = lb.spvAccount;
  if (!sa) add(c, "B.spv", "NO-GO", `B SPV ${B.chain.spv} is not on the ledger`, ["D6"], { fix: stage("B") });
  else {
    const spendable = xrpOf(sa.balance) - reserveOf(c, sa);
    if (spendable < c.o.minSpendableXrp) add(c, "B.spv", "NO-GO", `B SPV can spend ${fmtXrp(spendable)} XRP: not enough for the multisig LoanPay fee`, ["D6"], { fix: stage("B") });
    else add(c, "B.spv", "GO", `B SPV ${fmtXrp(spendable)} XRP spendable (pays the LoanPay fee)`, ["D6"]);
  }
}

/** withdraw: C past RedemptionDate, liquidity in the vault, shares with the investors. */
function projectC(c: Ctx, C: PrestageProject, lc: StageProjectLedger) {
  const t = c.ledger!.now.closeTime;
  const v = lc.vault;
  if (!v) add(c, "C.vault", "NO-GO", `C vault ${short(C.chain.vaultId)} is not on the ledger`, ["withdraw"], { fix: stage("C") });
  else {
    const ph = vaultPhase(v, t);
    const red = v.RedemptionDate;
    if (ph === "redemption") add(c, "C.vault", "GO", `C vault in Redemption since ${red ? isoAt(red) : "?"}`, ["withdraw"], { summary: "withdraw" });
    else if (ph === "investment" && red !== undefined && red - t <= c.o.windowS) add(c, "C.vault", "WARN", `C withdrawals open in ${fmtDuration(red - t)} (RedemptionDate ${isoAt(red)})`, ["withdraw"]);
    else add(c, "C.vault", "NO-GO", `C vault: ${phaseText(ph, red ? isoAt(red) : "?")}: VaultWithdraw would be refused`, ["withdraw"], { fix: stage("C") });
    const avail = toRlusd(v.AssetsAvailable);
    if (micro(avail) > 0n) add(c, "C.liquidity", "GO", `${avail} RLUSD withdrawable`, ["withdraw"], { summary: "withdraw" });
    else add(c, "C.liquidity", "NO-GO", "C vault has nothing withdrawable (AssetsAvailable 0)", ["withdraw"], { fix: stage("C") });
  }
  const invs = [...new Set(C.investments.map((i) => i.role))];
  const holding = invs.filter((r) => BigInt(lc.shares[r] ?? "0") > 0n);
  const scale = v?.Scale ?? 6;
  const whole = (r: string) => fromMicro((BigInt(lc.shares[r] ?? "0") * 1_000_000n) / 10n ** BigInt(scale));
  if (!invs.length) add(c, "C.shares", "NO-GO", "prestage.json C lists no investments", ["withdraw"], { fix: stage("C") });
  else if (!holding.length) add(c, "C.shares", "NO-GO", `C: ${invs.join(", ")} hold no shares (withdrawn in a rehearsal?)`, ["withdraw"], { fix: stage("C") });
  else if (holding.length < invs.length) {
    add(c, "C.shares", "WARN", `C: ${invs.filter((r) => !holding.includes(r)).join(", ")} hold no shares; withdraw as ${holding.join(" or ")}`, ["withdraw"], { fix: stage("C") });
  } else add(c, "C.shares", "GO", invs.map((r) => `${r} ${whole(r)} shares`).join(", "), ["withdraw"], { summary: "withdraw" });
}

function buildReport(c: Ctx): StageReport {
  const { checks, snap } = c;
  const env = snap.config.commandEnv;
  const beats: StageBeatResult[] = STAGE_BEATS.map((beat) => {
    const rel = checks.filter((x) => x.beats.includes(beat));
    const status = worst(rel.map((x) => x.status));
    const bad = status === "GO" ? [] : rel.filter((x) => x.status === status);
    const details = (status === "GO" ? rel.filter((x) => x.summary === beat) : bad).sort((a, b) => idRank(a.id) - idRank(b.id)).map((x) => x.message);
    return { beat, title: STAGE_BEAT_TITLES[beat], status, details, fixes: [...new Set(bad.flatMap((x) => (x.fix ? [renderFix(x.fix, env)] : [])))] };
  });
  const counts: Record<StageStatus, number> = { GO: 0, WARN: 0, "NO-GO": 0 };
  for (const x of checks) counts[x.status]++;
  const status = worst(checks.map((x) => x.status));
  const required = checks.flatMap((x) => (x.status === "NO-GO" && x.fix ? [x.fix] : []));
  const optional = checks.flatMap((x) => (x.status === "WARN" && x.fix && !covered(x.fix, required) ? [x.fix] : []));
  const ln = c.now.ledger;
  const file = c.file;
  return {
    version: 1,
    ok: status !== "NO-GO",
    status,
    checkedAt: new Date(c.now.wallMs).toISOString(),
    ...(ln ? { ledger: { index: ln.ledgerIndex, closeTime: isoAt(ln.closeTime) } } : {}),
    network: snap.config.network,
    files: snap.files,
    ...(file
      ? {
          prestage: {
            finishedAt: file.finishedAt,
            ageMin: Math.round(c.ageMin ?? 0),
            projects: Object.fromEntries(PRESTAGE_KEYS.flatMap((k) => (file.projects[k] ? [[k, file.projects[k]!.projectId]] : []))),
          },
        }
      : {}),
    beats,
    checks: checks.map((x) => ({ id: x.id, status: x.status, message: x.message, beats: x.beats, ...(x.fix ? { fix: renderFix(x.fix, env) } : {}) })),
    fixes: mergeFixes(required, env),
    suggestions: mergeFixes(optional, env),
    counts,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Rendering (pure)

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Terminal / PR rendering: a markdown table per beat, the non-GO checks (all with `verbose`), the fix sequence, the verdict. */
export function renderStageReport(r: StageReport, opts: { verbose?: boolean } = {}): string {
  const out: string[] = [];
  const led = r.ledger ? `ledger ${r.ledger.index} @ ${r.ledger.closeTime}` : "no validated ledger";
  out.push(`== Stage check (read-only, nothing submitted) · ${r.network} ${led}`);
  out.push(
    `   wallets ${r.files.wallets} · prestage ${r.files.prestage}${r.prestage ? ` (finished ${r.prestage.finishedAt.slice(0, 19)}Z, ${fmtDuration(r.prestage.ageMin * 60)} ago)` : ""} · preimages ${r.files.preimages}`,
  );
  out.push("", "| beat | status | detail | fix |", "|---|---|---|---|");
  for (const b of r.beats) {
    const fixes = b.fixes.map((f) => `\`${cell(f)}\``).join("<br>");
    out.push(`| ${stageBeatLabel(b.beat)} | ${b.status === "GO" ? "GO" : `**${b.status}**`} | ${cell(b.details.join(" · ")) || "—"} | ${fixes} |`);
  }
  const shown = (opts.verbose ? r.checks : r.checks.filter((c) => c.status !== "GO")).slice().sort((a, b) => RANK[b.status] - RANK[a.status]);
  out.push("", `checks: ${r.counts.GO} GO · ${r.counts.WARN} WARN · ${r.counts["NO-GO"]} NO-GO${!opts.verbose && shown.length ? " (non-GO below, --verbose lists all)" : ""}`);
  const w = Math.max(0, ...shown.map((c) => c.id.length));
  for (const c of shown) {
    out.push(`  ${c.status.padEnd(5)}  ${c.id.padEnd(w)}  ${c.message}`);
    if (c.fix && c.status !== "GO") out.push(`  ${" ".repeat(5 + 2 + w)}  fix: ${c.fix}`);
  }
  const steps = (title: string, list: StageFixStep[]) => {
    if (!list.length) return;
    out.push("", title);
    list.forEach((f, i) => out.push(`  ${i + 1}. ${f.command}${f.eta ? `   # ${f.eta}` : ""}`));
  };
  steps("Fix before the slot, in order (then re-run stage:check):", r.fixes);
  steps("Optional, for the warnings:", r.suggestions);
  const nogo = r.beats.filter((b) => b.status === "NO-GO").map((b) => b.beat);
  const warn = r.beats.filter((b) => b.status === "WARN").map((b) => b.beat);
  out.push(
    "",
    r.status === "NO-GO"
      ? `VERDICT: NO-GO (${nogo.length ? `${nogo.join(", ")} not ready` : "see checks"}) · exit 1`
      : r.status === "WARN"
        ? `VERDICT: GO with ${r.counts.WARN} warning${r.counts.WARN === 1 ? "" : "s"}${warn.length ? ` (${warn.join(", ")})` : ""} · exit 0`
        : `VERDICT: GO, all ${r.beats.length} beats ready · exit 0`,
  );
  return out.join("\n");
}
