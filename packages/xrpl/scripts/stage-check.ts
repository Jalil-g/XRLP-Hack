// pnpm --filter @xrlp/xrpl stage:check [--json] [--verbose] [--window-min=60] [--max-age-min=60] [--prestage <file>] [--preimages <file>]
// XRPL-16: read-only GO / WARN / NO-GO per demo beat, for the 30 minutes before the slot (docs/04-demo-script.md, CLI backup).
// Submits NO transactions and never funds anything (the faucet gets a HEAD request). Reads the wallet file (addresses only),
// .data/prestage.json, .data/prestage-preimages.json (each preimage becomes its condition in memory and is dropped; never
// printed) and ONE validated devnet ledger, then runs the pure src/stage-check.ts `evaluateStage`.
//
// Exit 0 = no NO-GO (GO, or GO with warnings) · 1 = NO-GO · 2 = the check itself failed.
// --json prints only the StageReport JSON on stdout: `pnpm -s --filter @xrlp/xrpl stage:check --json` (-s keeps pnpm's
// banner off stdout). --verbose lists every check. Relative paths (WALLETS_FILE, DATA_DIR, --prestage, --preimages)
// resolve against the repo root, like config.ts. Env: STAGE_WINDOW_MIN, STAGE_MAX_AGE_MIN.
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { LedgerNow } from "../src/preflight.ts";
import { disconnect, getClient } from "../src/client.ts";
import { config, REPO_ROOT, RLUSD_CURRENCY } from "../src/config.ts";
import { credentialTypeHex, type CredentialStatus, type CredentialType } from "../src/credentials.ts";
import type { LoanEntry } from "../src/loan.ts";
import type { TrustlineSnapshot } from "../src/preflight.ts";
import { parsePrestageFile, PRESTAGE_KEYS, type PrestageFile, type PrestageKey, type PrestageProject } from "../src/prestage-types.ts";
import { fetchAccountLines, fetchEscrowNode, findTrustLine, rawRequest, type RawResult, type VaultNode } from "../src/reads.ts";
import {
  evaluateStage,
  renderStageReport,
  summarizePreimages,
  walletAddresses,
  type StageAccount,
  type StageDevnet,
  type StageNow,
  type StageProjectLedger,
  type StageRole,
  type StageSnapshot,
} from "../src/stage-check.ts";
import { RLUSD_HOLDERS, WALLET_ROLES, type WalletRole } from "../src/wallets.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
function opt(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1];
  return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}
function minutes(raw: string | undefined, what: string, dflt: number): number {
  if (raw === undefined || raw === "") return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${what} must be a positive number of minutes (got ${raw})`);
  return n;
}

const JSON_OUT = flag("json");
const fromRoot = (p: string) => (isAbsolute(p) ? p : resolve(REPO_ROOT, p));
const rel = (p: string) => relative(REPO_ROOT, p) || p;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 200);
const LSF_DEPOSIT_AUTH = 0x01000000;
/** Credential.Flags lsfAccepted (credentials.ts keeps its copy private). */
const LSF_ACCEPTED = 0x00010000;
const NOT_FOUND = new Set(["entryNotFound", "actNotFound", "objectNotFound"]);
const notFound = (r: RawResult) => typeof r.error === "string" && NOT_FOUND.has(r.error);
/** Credentials asked for per role (who issued: the platform). */
const CREDENTIALS: Partial<Record<WalletRole, CredentialType[]>> = {
  builder: ["VERIFIED_BUILDER"],
  investor1: ["KYC_INVESTOR"],
  investor2: ["KYC_INVESTOR"],
  investor3: ["KYC_INVESTOR"],
  inspector1: ["VERIFIED_INSPECTOR"],
  inspector2: ["VERIFIED_INSPECTOR"],
  inspector3: ["VERIFIED_INSPECTOR"],
};

/** `KEY=value ` for every env var that changes which files / node a fix command would use. */
function commandEnv(): string {
  const quote = (v: string) => (/^[\w./:@=-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`);
  return ["XRPL_NETWORK", "XRPL_WS_URL", "XRPL_FAUCET_HOST", "WALLETS_FILE", "DATA_DIR"]
    .filter((k) => process.env[k])
    .map((k) => `${k}=${quote(process.env[k]!)} `)
    .join("");
}

/** Run `fns` with at most `n` in flight (keeps the burst polite to the public devnet node). */
async function pool<T>(fns: (() => Promise<T>)[], n = 8): Promise<T[]> {
  const out: T[] = new Array(fns.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, fns.length) }, async () => {
      while (next < fns.length) {
        const i = next++;
        out[i] = await fns[i]!();
      }
    }),
  );
  return out;
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => void setTimeout(() => rej(new Error(`${what}: no answer in ${ms / 1000}s`)), ms).unref())]);

// ------------------------------------------------------------------ local files (secrets reduced right here)

function readWallets(path: string): StageSnapshot["wallets"] {
  if (!existsSync(path)) return { exists: false, roles: {}, missingRoles: [...WALLET_ROLES] };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // Never pass the parser's message on: it quotes the file, i.e. seeds.
    return { exists: true, error: "not valid JSON", roles: {}, missingRoles: [...WALLET_ROLES] };
  }
  try {
    const { network, roles, missingRoles } = walletAddresses(json);
    const out: StageSnapshot["wallets"] = { exists: true, roles: {}, missingRoles };
    if (network !== undefined) out.network = network;
    for (const [role, address] of Object.entries(roles) as [WalletRole, string][]) out.roles[role] = { address };
    return out;
  } catch (e) {
    return { exists: true, error: msg(e), roles: {}, missingRoles: [...WALLET_ROLES] };
  }
}

function readPrestage(path: string): StageSnapshot["prestage"] {
  if (!existsSync(path)) return { exists: false };
  try {
    return { exists: true, file: parsePrestageFile(JSON.parse(readFileSync(path, "utf8"))) };
  } catch (e) {
    return { exists: true, error: e instanceof SyntaxError ? "not valid JSON" : msg(e) };
  }
}

function readPreimages(path: string, file: PrestageFile | undefined): StageSnapshot["preimages"] {
  if (!existsSync(path)) return { exists: false, entries: {} };
  const mode = statSync(path).mode & 0o777;
  const wanted = (["A", "B"] as const).flatMap((k) => {
    const p = file?.projects[k];
    return p ? [{ projectId: p.projectId, milestoneIds: p.escrows.map((e) => e.milestoneId) }] : [];
  });
  try {
    return { exists: true, mode, entries: summarizePreimages(JSON.parse(readFileSync(path, "utf8")), wanted) };
  } catch (e) {
    // Content-free on purpose (a JSON excerpt would be a preimage).
    return { exists: true, mode, error: e instanceof SyntaxError ? "not valid JSON" : msg(e), entries: {} };
  }
}

// ------------------------------------------------------------------ devnet (one validated ledger)

async function probeFaucet(host: string): Promise<StageSnapshot["faucet"]> {
  const t0 = Date.now();
  try {
    // HEAD only: the faucet funds on POST /accounts; HEAD/GET answer 404 and fund nothing.
    const r = await fetch(`https://${host}/accounts`, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    return { ok: r.status < 500, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: msg(e) };
  }
}

interface DevnetRead {
  devnet: StageDevnet;
  now?: LedgerNow;
  ledger?: StageSnapshot["ledger"];
}

async function readDevnet(w: StageSnapshot["wallets"], file: PrestageFile | undefined): Promise<DevnetRead> {
  try {
    await withTimeout(getClient(), 25_000, `connect ${config.wsUrl}`);
  } catch (e) {
    return { devnet: { reachable: false, error: msg(e) } };
  }
  let info: RawResult, feature: RawResult, fee: RawResult, led: RawResult;
  try {
    [info, feature, fee, led] = await Promise.all([
      rawRequest({ command: "server_info" }),
      rawRequest({ command: "feature" }).catch((e: unknown) => ({ error: msg(e) }) as RawResult),
      rawRequest({ command: "fee" }),
      rawRequest({ command: "ledger", ledger_index: "validated" }),
    ]);
  } catch (e) {
    return { devnet: { reachable: false, error: msg(e) } };
  }
  const i = (info.info ?? {}) as Record<string, unknown>;
  const vl = (i.validated_ledger ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const amendments: Record<string, boolean> = {};
  for (const f of Object.values((feature.features ?? {}) as Record<string, { name?: string; enabled?: boolean }>)) if (f.name) amendments[f.name] = f.enabled === true;
  const devnet: StageDevnet = {
    reachable: true,
    reserveBaseXrp: num(vl.reserve_base_xrp) ?? 1,
    reserveIncXrp: num(vl.reserve_inc_xrp) ?? 0.2,
    amendments,
  };
  const networkId = num(i.network_id);
  const age = num(vl.age);
  if (networkId !== undefined) devnet.networkId = networkId;
  if (typeof i.build_version === "string") devnet.buildVersion = i.build_version;
  if (typeof i.server_state === "string") devnet.serverState = i.server_state;
  if (age !== undefined) devnet.validatedAgeS = age;
  if (feature.error) devnet.featureError = String(feature.error);
  const l = led.ledger as { ledger_index?: string | number; close_time?: number } | undefined;
  if (led.error || !l?.close_time) return { devnet };
  const now: LedgerNow = { ledgerIndex: Number(l.ledger_index), closeTime: l.close_time };
  const drops = (fee.drops ?? {}) as { base_fee?: string; open_ledger_fee?: string };
  const baseFeeDrops = Math.max(Number(drops.base_fee ?? 10), Number(drops.open_ledger_fee ?? 0)) || 10;
  try {
    return { devnet, now, ledger: { baseFeeDrops, ...(await readPinned(now.ledgerIndex, w, file)) } };
  } catch (e) {
    return { devnet, now, ledger: { baseFeeDrops, projects: {}, error: msg(e) } };
  }
}

async function readPinned(at: number, w: StageSnapshot["wallets"], file: PrestageFile | undefined): Promise<Omit<NonNullable<StageSnapshot["ledger"]>, "baseFeeDrops">> {
  const account = async (address: string): Promise<StageAccount | null> => {
    const r = await rawRequest({ command: "account_info", account: address, ledger_index: at });
    if (notFound(r)) return null;
    if (r.error) throw new Error(`account_info ${address}: ${r.error}`);
    const d = r.account_data as { Balance: string | number; OwnerCount?: number; Flags?: number };
    return { balance: String(d.Balance), ownerCount: Number(d.OwnerCount ?? 0), flags: Number(d.Flags ?? 0) };
  };
  const issuer = w.roles.issuer?.address ?? file?.rlusd.issuer;
  const line = async (address: string): Promise<TrustlineSnapshot | null> => {
    if (!issuer) return null;
    return findTrustLine(await fetchAccountLines(address, issuer, at), RLUSD_CURRENCY) as TrustlineSnapshot | null;
  };
  const platform = w.roles.platform?.address;
  const credentials = async (subject: string, types: CredentialType[]): Promise<Partial<Record<CredentialType, CredentialStatus>>> => {
    const objs: { Issuer?: string; CredentialType?: string; Flags?: number }[] = [];
    let marker: unknown;
    do {
      const r = await rawRequest({ command: "account_objects", account: subject, type: "credential", ledger_index: at, ...(marker ? { marker } : {}) });
      if (notFound(r)) break;
      if (r.error) throw new Error(`account_objects ${subject}: ${r.error}`);
      objs.push(...((r.account_objects ?? []) as typeof objs));
      marker = r.marker;
    } while (marker);
    const out: Partial<Record<CredentialType, CredentialStatus>> = {};
    for (const t of types) {
      const hex = credentialTypeHex(t).toUpperCase();
      const c = objs.find((o) => o.Issuer === platform && o.CredentialType?.toUpperCase() === hex);
      out[t] = !c ? "none" : (c.Flags ?? 0) & LSF_ACCEPTED ? "accepted" : "pending";
    }
    return out;
  };

  // Roles: account, RLUSD line (holders), credentials. Roles are filled in place (addresses only came from the file).
  const roleTasks: (() => Promise<void>)[] = [];
  for (const role of WALLET_ROLES) {
    const r: StageRole | undefined = w.roles[role];
    if (!r) continue;
    roleTasks.push(async () => void (r.account = await account(r.address)));
    if ((RLUSD_HOLDERS as readonly string[]).includes(role)) roleTasks.push(async () => void (r.rlusdLine = await line(r.address)));
    const types = CREDENTIALS[role];
    if (types && platform) roleTasks.push(async () => void (r.credentials = await credentials(r.address, types)));
  }
  await pool(roleTasks);

  // Projects: vault, loan, escrows, SPV account + RLUSD, investors' shares. One failure only blanks that project.
  const entry = async <T>(index: string): Promise<T | null> => {
    const r = await rawRequest({ command: "ledger_entry", index, ledger_index: at });
    if (notFound(r)) return null;
    if (r.error) throw new Error(`ledger_entry ${index.slice(0, 8)}…: ${r.error}`);
    return r.node as T;
  };
  const share = async (mptId: string, holder: string): Promise<string> => {
    const r = await rawRequest({ command: "ledger_entry", mptoken: { mpt_issuance_id: mptId, account: holder }, ledger_index: at });
    if (notFound(r)) return "0";
    if (r.error) throw new Error(`ledger_entry mptoken: ${r.error}`);
    return String((r.node as { MPTAmount?: string }).MPTAmount ?? "0");
  };
  const project = async (p: PrestageProject): Promise<StageProjectLedger> => {
    const investors = [...new Map(p.investments.map((i) => [i.role, i.investor])).entries()];
    const [vault, loan, escrows, spvAccount, spvLine, shares] = await Promise.all([
      entry<VaultNode>(p.chain.vaultId),
      entry<LoanEntry>(p.chain.loanId),
      pool(p.escrows.map((e) => () => fetchEscrowNode(e.owner, e.offerSequence, at)), 4),
      account(p.chain.spv),
      line(p.chain.spv),
      pool(investors.map(([role, a]) => async () => [role, await share(p.chain.shareMptIssuanceId, a)] as const), 4),
    ]);
    return { vault, loan, escrows, spvAccount, spvRlusd: spvLine ? spvLine.balance : null, shares: Object.fromEntries(shares) };
  };
  const projects: Partial<Record<PrestageKey, StageProjectLedger>> = {};
  const projectErrors: Partial<Record<PrestageKey, string>> = {};
  await Promise.all(
    PRESTAGE_KEYS.map(async (k) => {
      const p = file?.projects[k];
      if (!p) return;
      try {
        projects[k] = await project(p);
      } catch (e) {
        projectErrors[k] = msg(e);
      }
    }),
  );

  // deposit_authorized only matters if the builder turned DepositAuth on (preflight's deposit_auth reason).
  const builder = w.roles.builder;
  const rsvc = w.roles.releaseService?.address;
  let releasePreauthorized: boolean | undefined;
  if (builder?.account && builder.account.flags & LSF_DEPOSIT_AUTH && rsvc) {
    const r = await rawRequest({ command: "deposit_authorized", source_account: rsvc, destination_account: builder.address, ledger_index: at });
    releasePreauthorized = r.deposit_authorized === true;
  }
  return {
    projects,
    ...(Object.keys(projectErrors).length ? { projectErrors } : {}),
    ...(releasePreauthorized !== undefined ? { releasePreauthorized } : {}),
  };
}

// ------------------------------------------------------------------ main

async function fetchStageSnapshot(paths: { prestage: string; preimages?: string }): Promise<{ snapshot: StageSnapshot; now: StageNow }> {
  const wallets = readWallets(config.walletsFile);
  const prestage = readPrestage(paths.prestage);
  const preimagesPath = paths.preimages ?? (prestage.file?.preimagesFile ? fromRoot(prestage.file.preimagesFile) : join(config.dataDir, "prestage-preimages.json"));
  const preimages = readPreimages(preimagesPath, prestage.file);
  const [faucet, net] = await Promise.all([probeFaucet(config.faucetHost), readDevnet(wallets, prestage.file)]);
  const snapshot: StageSnapshot = {
    files: { wallets: rel(config.walletsFile), prestage: rel(paths.prestage), preimages: rel(preimagesPath) },
    config: { network: config.network, wsUrl: config.wsUrl, faucetHost: config.faucetHost, commandEnv: commandEnv() },
    devnet: net.devnet,
    faucet,
    wallets,
    prestage,
    preimages,
    ...(net.ledger ? { ledger: net.ledger } : {}),
  };
  return { snapshot, now: { ...(net.now ? { ledger: net.now } : {}), wallMs: Date.now() } };
}

async function main(): Promise<number> {
  if (flag("help") || flag("h")) {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
    return 0;
  }
  const windowS = minutes(opt("window-min") ?? process.env.STAGE_WINDOW_MIN, "--window-min", 60) * 60;
  const maxAgeMin = minutes(opt("max-age-min") ?? process.env.STAGE_MAX_AGE_MIN, "--max-age-min", 60);
  const prestagePath = opt("prestage") ? fromRoot(opt("prestage")!) : join(config.dataDir, "prestage.json");
  const preimagesArg = opt("preimages");
  const { snapshot, now } = await fetchStageSnapshot({ prestage: prestagePath, ...(preimagesArg ? { preimages: fromRoot(preimagesArg) } : {}) });
  const report = evaluateStage(snapshot, now, { windowS, maxAgeMin });
  if (JSON_OUT) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else console.log(renderStageReport(report, { verbose: flag("verbose") }));
  return report.ok ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (e) {
  if (JSON_OUT) process.stdout.write(JSON.stringify({ version: 1, ok: false, status: "NO-GO", error: msg(e) }, null, 2) + "\n");
  console.error("STAGE CHECK FAILED (the check itself, not the stage):", msg(e));
  process.exitCode = 2;
} finally {
  await disconnect();
}
