// XRPL-11: shared building blocks for scripts/demo.ts (CLI backup of the live demo) and scripts/prestage.ts (Projects A/B/C).
// Script-only code: composes the package API, prints narration + a tx table. Every tx is logged with its explorer link.
//
// Call sites that change when parallel tickets merge are marked `// after XRPL-06/07 merge:` and isolated here,
// so switching is a one-function edit.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ChainEvent, Project } from "@xrlp/shared";
import { explorerTxUrl } from "@xrlp/shared";
import { rippleTimeToISOTime, type Wallet } from "xrpl";
import { closeLoanAndCreateEscrows, releaseMilestone, repayLoan, spvSignersFor, type CloseLoanResult, type MilestoneEscrowInfo, type ProjectChainSetup } from "../src/api.ts";
import { prepareAttestTx, sha256Hex, type AttestMemo } from "../src/attest.ts";
import { ledgerTime, signAndSubmit, XrplTxError, type TxResult } from "../src/client.ts";
import { attest, createDomain, grantCredential, payVerificationFee, submitSignedBlob, VERIFICATION_FEE_RLUSD } from "../src/compliance.ts";
import { conditionFromPreimage, fulfillmentFromPreimage } from "../src/condition.ts";
import { config, REPO_ROOT } from "../src/config.ts";
import { revokeCredential } from "../src/credentials.ts";
import { toChainEvent } from "../src/events.ts";
import { COVER_RATE_LIQUIDATION, COVER_RATE_MINIMUM, defaultCoverDeposit, expectedInterest, MANAGEMENT_FEE_RATE, minimumCover, originationFeeFor } from "../src/lending-math.ts";
import { createLoanBroker, depositBrokerCover } from "../src/loan.ts";
import { preflightFinish, type PreflightResult } from "../src/preflight.ts";
import { getEscrow, getLoanSnapshot, getVaultSnapshot } from "../src/reads.ts";
import { payRlusd, rlusdBalance, topUpRlusd } from "../src/rlusd.ts";
import { createSpvAccount, lockSpv, type SpvSigners } from "../src/spv.ts";
import { createVault, depositToVaultTx } from "../src/vault.ts";
import { loadWallets, rememberSpv, type DemoWallets, type WalletRole } from "../src/wallets.ts";
import { PRESTAGE_VERSION, type PrestagePreimagesFile, type PrestageTx } from "../src/prestage-types.ts";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const envNum = (k: string, d: number) => {
  const v = process.env[k];
  if (v === undefined || v === "") return d;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${k} must be a positive number (got ${v})`);
  return n;
};
export const iso = (rippleTime: number) => rippleTimeToISOTime(rippleTime);
export const DAY_S = 86_400;

// ------------------------------------------------------------------ narration + tx log

export interface TxRow {
  beat: string;
  step: string;
  type: string;
  result: string;
  url: string;
  hash: string;
  /** Expected failure (tecNO_AUTH, tecCRYPTOCONDITION_ERROR): shown as such in the table. */
  expected?: boolean;
}

export class TxLog {
  readonly rows: TxRow[] = [];
  readonly notes: string[] = [];
  beat = "";

  constructor(private readonly prefix = "") {}

  /** Beat header + one-line narration (what the presenter says). */
  say(beat: string, line?: string) {
    this.beat = beat;
    console.log(`\n${this.prefix}== ${beat}`);
    if (line) console.log(`${this.prefix}   "${line}"`);
  }

  info(s: string) {
    console.log(`${this.prefix}  ${s}`);
  }

  note(s: string) {
    this.notes.push(s);
    this.info(`NOTE ${s}`);
  }

  rec(step: string, tx: TxResult | undefined): TxResult | undefined {
    if (!tx) return undefined;
    this.rows.push({ beat: this.beat, step, type: String(tx.tx.TransactionType ?? "?"), result: tx.result, url: tx.explorerUrl, hash: tx.hash });
    console.log(`${this.prefix}  ✓ ${step.padEnd(52)} ${tx.explorerUrl}`);
    return tx;
  }

  /** Record an on-ledger failure we wanted to show (the ledger says no). */
  expectedFailure(step: string, txType: string, e: XrplTxError) {
    const hash = e.hash ?? "";
    this.rows.push({ beat: this.beat, step, type: txType, result: e.engineResult, url: hash ? explorerTxUrl(hash) : "(not on ledger)", hash, expected: true });
    console.log(`${this.prefix}  ✗ ${step.padEnd(52)} ${e.engineResult} (expected) ${hash ? explorerTxUrl(hash) : ""}`);
  }

  asPrestageTxs(): PrestageTx[] {
    return this.rows.map((r) => ({ step: r.step, type: r.type, result: r.result, hash: r.hash, explorerUrl: r.url }));
  }

  /** Markdown table (paste-able into a PR). */
  table(title = "tx table"): string {
    const lines = [`### ${title}`, "", "| # | beat | step | type | result | explorer |", "|---|---|---|---|---|---|"];
    const short = (b: string) => (b.split(":")[0] ?? b).slice(0, 28);
    this.rows.forEach((r, i) => lines.push(`| ${i + 1} | ${short(r.beat)} | ${r.step} | ${r.type} | ${r.expected ? `**${r.result}** (expected)` : r.result} | ${r.url} |`));
    return lines.join("\n");
  }
}

export const tick = (label: string) => (s: number) => process.stdout.write(`\r  … waiting for ${label}: ~${s}s   `);

/**
 * Retry an IDEMPOTENT step (reads, faucet, ensure-style calls, top-ups to a target) on transient errors.
 * Never wrap a plain submit in this: submissions are already retried safely by the submit layer (XRPL-12),
 * and a blind retry could double-spend (two deposits).
 */
export async function retry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const onLedger = e instanceof XrplTxError && e.onLedger;
      if (i >= attempts || onLedger) throw new Error(`${label} failed after ${i} attempt(s): ${(e as Error).message}`, { cause: e });
      console.warn(`  ↻ ${label}: ${(e as Error).message} — retry ${i}/${attempts - 1}`);
      await sleep(2000 * i);
    }
  }
}

/** Write JSON atomically (tmp + rename) so core never reads a half-written file. */
export function writeJsonAtomic(path: string, data: unknown, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode });
  renameSync(tmp, path);
}

export const repoRel = (p: string) => relative(REPO_ROOT, p);
export const dataPath = (name: string) => join(config.dataDir, name);

// ------------------------------------------------------------------ participants (idempotent)

export interface Participants {
  w: DemoWallets;
  domainId: string;
}

/**
 * KYC_INVESTOR for investor1/2 (issue + accept), none for investor3 (the tecNO_AUTH beat), VERIFIED_INSPECTOR for
 * inspector1..3, the platform PermissionedDomain. Idempotent: a second run submits 0 txs.
 * (XRPL-03 hardening makes bootstrap do the credentials; this keeps old wallet files demo-ready.)
 */
export async function ensureParticipants(log: TxLog): Promise<Participants> {
  const w = loadWallets();
  for (const inv of ["investor1", "investor2"] as const) {
    const r = await retry(`KYC ${inv}`, () => grantCredential({ subject: inv, type: "KYC_INVESTOR" }));
    r.txs.forEach((t) => log.rec(`Credential${t === r.createTx ? "Create" : "Accept"} KYC_INVESTOR ${inv}`, t));
    if (!r.txs.length) log.info(`${inv}: KYC_INVESTOR ${r.status}`);
  }
  // investor3 must NOT be a domain member (bootstrap strips it too; this covers wallet files bootstrapped before XRPL-03 hardening).
  const revoked = await revokeCredential(w.platform, w.investor3.classicAddress, "KYC_INVESTOR");
  if (revoked) log.rec("CredentialDelete KYC_INVESTOR investor3 (old wallet file)", revoked);
  else log.info("investor3: no KYC_INVESTOR (as intended)");
  for (const insp of ["inspector1", "inspector2", "inspector3"] as const) {
    const r = await retry(`VERIFIED_INSPECTOR ${insp}`, () => grantCredential({ subject: insp, type: "VERIFIED_INSPECTOR" }));
    r.txs.forEach((t) => log.rec(`Credential${t === r.createTx ? "Create" : "Accept"} VERIFIED_INSPECTOR ${insp}`, t));
  }
  const dom = await retry("PermissionedDomain", () => createDomain());
  if (dom.tx) log.rec("PermissionedDomainSet [platform, KYC_INVESTOR]", dom.tx);
  else log.info(`domain ${dom.domainId} (reused)`);
  return { w, domainId: dom.domainId };
}

/** Mock RLUSD is ours: top a holder up to `target` from the issuer (no-op if already there). */
export async function ensureRlusd(log: TxLog, role: WalletRole, target: number) {
  const w = loadWallets();
  log.rec(`RLUSD top-up ${role} -> ${target}`, await retry(`top up ${role}`, () => topUpRlusd(w.issuer, w[role].classicAddress, target)));
}

// ------------------------------------------------------------------ project

export interface ProjectSpec {
  id: string;
  name: string;
  siteAddress: string;
  siteGeo: { lat: number; lng: number; radiusM: number };
  description: string;
  principal: string;
  interestRateBps: number;
  /** [templateKey, title, amount] per milestone, in order. Amounts sum to the principal. */
  milestones: [string, string, string][];
  paymentTotal: number;
  paymentIntervalS: number;
}

export function makeProject(s: ProjectSpec, fundingDeadline: string): Project {
  const sum = s.milestones.reduce((a, [, , amt]) => a + Number(amt), 0);
  if (Math.abs(sum - Number(s.principal)) > 1e-6) throw new Error(`${s.id}: milestones sum to ${sum}, principal is ${s.principal}`);
  const termDays = Math.max(1, Math.round((s.paymentTotal * s.paymentIntervalS) / DAY_S));
  return {
    id: s.id,
    name: s.name,
    type: "residential_new",
    builderId: "builder-1",
    siteAddress: s.siteAddress,
    siteGeo: s.siteGeo,
    description: s.description,
    terms: {
      principal: s.principal,
      interestRateBps: s.interestRateBps,
      termDays,
      paymentIntervalDays: Math.max(1, Math.round(s.paymentIntervalS / DAY_S)),
      fundingDeadline,
    },
    status: "funding",
    milestones: s.milestones.map(([templateKey, title, amount], index) => ({
      id: `${s.id}-m${index + 1}-${templateKey}`,
      index,
      templateKey,
      title,
      amount,
      requiredInspectors: 1,
      status: "pending",
    })),
    chain: {},
  };
}

/** Beat 1: builder pays the per-project verification fee; AI-first verification passes -> VERIFIED_BUILDER (idempotent). */
export async function verifyBuilder(log: TxLog, projectId: string): Promise<{ fee: TxResult; events: ChainEvent[] }> {
  const fee = await payVerificationFee({ builder: "builder", projectId });
  log.rec(`Payment verification fee builder -> platform ${VERIFICATION_FEE_RLUSD} RLUSD`, fee.tx);
  const cred = await retry("VERIFIED_BUILDER", () => grantCredential({ subject: "builder", type: "VERIFIED_BUILDER", projectId }));
  cred.txs.forEach((t) => log.rec(`Credential${t === cred.createTx ? "Create" : "Accept"} VERIFIED_BUILDER`, t));
  if (!cred.txs.length) log.info("builder already holds VERIFIED_BUILDER (credential is per builder, fee is per project)");
  return { fee: fee.tx, events: [fee.event, ...cred.events] };
}

export interface PrivateSetupOptions {
  domainId: string;
  /** Seconds from "now" (ledger) until SubscriptionDate (deposit window). */
  subscriptionInS: number;
  /** RedemptionDate from SubscriptionDate (see prestageVaultDates). */
  redemptionFor: (subscriptionDate: number) => number;
  paymentTotal: number;
  paymentIntervalS: number;
  /** Assigned inspector address (on the SPV list). */
  inspector: string;
}

/**
 * Beat 2 "lock terms": SPV (v2 list platform/builder/inspector/trustee, quorum 3, master disabled) + PRIVATE closed-ended
 * vault (tfVaultPrivate + DomainID + non-transferable shares, AssetsMaximum = principal) + LoanBroker (cover rates,
 * management fee) + mandatory first-loss cover. Same steps as `setupProjectOnChain`, which has no `domainId` option yet.
 * TODO(XRPL): switch to setupProjectOnChain({ domainId, nonTransferableShares }) once it takes them.
 */
export async function setupPrivateProject(log: TxLog, project: Project, o: PrivateSetupOptions): Promise<ProjectChainSetup & { domainId: string; signers: SpvSigners }> {
  const w = loadWallets();
  const issuer = w.issuer.classicAddress;
  const rates = { coverRateMinimum: COVER_RATE_MINIMUM, coverRateLiquidation: COVER_RATE_LIQUIDATION, managementFeeRate: MANAGEMENT_FEE_RATE };
  const interest = expectedInterest({ principal: project.terms.principal, interestRate: project.terms.interestRateBps * 10, paymentTotal: o.paymentTotal, paymentIntervalS: o.paymentIntervalS });
  const coverMin = minimumCover({ principal: project.terms.principal, interest, coverRateMinimum: rates.coverRateMinimum });
  const cover = defaultCoverDeposit({ principal: project.terms.principal, interest, coverRateMinimum: rates.coverRateMinimum });
  await ensureRlusd(log, "platform", Math.ceil(Number(cover)) + 1_000);

  const signers = spvSignersFor({ inspector: o.inspector });
  const { wallet: spv, trustTx } = await createSpvAccount(issuer);
  rememberSpv(project.id, spv);
  const txs: Record<string, TxResult> = {};
  if (trustTx) txs.spvTrustSet = log.rec("TrustSet SPV RLUSD", trustTx)!;
  const lock = await lockSpv(spv, signers);
  txs.spvSignerListSet = log.rec("SignerListSet SPV {platform,builder,inspector,trustee} q3", lock.signerListSet)!;
  txs.spvDisableMaster = log.rec("AccountSet SPV disableMaster", lock.disableMaster)!;

  const now = await ledgerTime();
  const sub = now + Math.round(o.subscriptionInS);
  const red = o.redemptionFor(sub);
  const vault = await createVault({
    owner: w.platform,
    issuer,
    subscriptionDate: sub,
    redemptionDate: red,
    assetsMaximum: project.terms.principal,
    loanSchedule: { paymentTotal: o.paymentTotal, paymentIntervalS: o.paymentIntervalS },
    data: `xrlp:${project.id}`,
    domainId: o.domainId,
    nonTransferableShares: true,
  });
  txs.vaultCreate = log.rec(`VaultCreate private closed-ended (sub ${iso(sub).slice(11, 19)}, red ${iso(red).slice(0, 19)})`, vault.tx)!;
  const events: ChainEvent[] = [toChainEvent(vault.tx, { projectId: project.id, kind: "vault_created", actor: w.platform.classicAddress })];
  const broker = await createLoanBroker({ owner: w.platform, vaultId: vault.vaultId, ...rates, data: `xrlp:${project.id}` });
  txs.loanBrokerSet = log.rec("LoanBrokerSet (cover 10%/100%, mgmt fee 10%)", broker.tx)!;
  events.push(toChainEvent(broker.tx, { projectId: project.id, kind: "loan_broker_created", actor: w.platform.classicAddress }));
  txs.loanBrokerCoverDeposit = log.rec(`LoanBrokerCoverDeposit ${cover} (min ${coverMin})`, await depositBrokerCover(w.platform, broker.loanBrokerId, issuer, cover))!;
  const coverEvent = toChainEvent(txs.loanBrokerCoverDeposit, { projectId: project.id, kind: "cover_deposited", actor: w.platform.classicAddress, amount: cover });
  events.push(coverEvent);
  project.chain = { spv: spv.classicAddress, vaultId: vault.vaultId, loanBrokerId: broker.loanBrokerId, shareMptIssuanceId: vault.shareMptIssuanceId, subscriptionDate: iso(sub), redemptionDate: iso(red) };
  return {
    spv: spv.classicAddress,
    vaultId: vault.vaultId,
    loanBrokerId: broker.loanBrokerId,
    shareMptIssuanceId: vault.shareMptIssuanceId,
    vaultPseudoAccount: vault.pseudoAccount,
    subscriptionEndsAt: iso(sub),
    redemptionAt: iso(red),
    cover: { amount: cover, minimum: coverMin, ...rates, txHash: txs.loanBrokerCoverDeposit.hash },
    coverEvent,
    events,
    txs,
    spvWallet: spv,
    domainId: o.domainId,
    signers,
  };
}

/** VaultDeposit; `expectNoAuth` records the tecNO_AUTH (no KYC) as an expected on-ledger failure. */
export async function deposit(log: TxLog, project: Project, role: WalletRole, amount: string, expectNoAuth = false): Promise<{ tx?: TxResult; event?: ChainEvent }> {
  const w = loadWallets();
  await ensureRlusd(log, role, Number(amount) + 1_000);
  try {
    const tx = await depositToVaultTx(w[role], project.chain.vaultId!, w.issuer.classicAddress, amount);
    if (expectNoAuth) throw new Error(`${role} deposit SUCCEEDED but was expected to fail tecNO_AUTH (does ${role} hold KYC_INVESTOR?)`);
    log.rec(`VaultDeposit ${role} ${amount}`, tx);
    return { tx, event: toChainEvent(tx, { projectId: project.id, kind: "vault_deposit", actor: w[role].classicAddress, amount }) };
  } catch (e) {
    if (expectNoAuth && e instanceof XrplTxError && e.engineResult === "tecNO_AUTH") {
      log.expectedFailure(`VaultDeposit ${role} ${amount} (no KYC credential)`, "VaultDeposit", e);
      return {};
    }
    throw e;
  }
}

// ------------------------------------------------------------------ release-service stand-in (preimages)

/**
 * Stand-in for core's release service (CORE-12) in the scripts: one CSPRNG 32-byte preimage per escrow; only the
 * condition leaves this object. Preimages are written ONLY to a gitignored .data file (mode 600) and never printed.
 */
export class ReleaseServiceStandIn {
  private readonly file: PrestagePreimagesFile;

  constructor(readonly path: string) {
    this.file = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as PrestagePreimagesFile)
      : { version: PRESTAGE_VERSION, warning: "SECRET devnet escrow preimages (release-service stand-in). Never commit, never print.", projects: {} };
  }

  /** Conditions by milestone index (fresh preimage per escrow; refuses to reuse one). */
  conditionsFor(project: Project): string[] {
    const entry = (this.file.projects[project.id] ??= {});
    return project.milestones.map((m) => {
      if (entry[m.id]) throw new Error(`release-service stand-in: ${m.id} already has a preimage (one per escrow)`);
      const preimage = randomBytes(32);
      const condition = conditionFromPreimage(preimage);
      entry[m.id] = { condition, preimage: preimage.toString("hex"), createdAt: new Date().toISOString() };
      return condition;
    });
  }

  fulfillmentFor(projectId: string, milestoneId: string, condition: string): string {
    const e = this.file.projects[projectId]?.[milestoneId];
    if (!e || e.condition !== condition) throw new Error(`release-service stand-in: no preimage for ${milestoneId} with that condition`);
    return fulfillmentFromPreimage(Buffer.from(e.preimage, "hex"));
  }

  save() {
    writeJsonAtomic(this.path, this.file, 0o600);
  }
}

// ------------------------------------------------------------------ close (LoanSet + escrows)

/**
 * LoanSet + one EscrowCreate per milestone (XRPL-06 closeLoanAndCreateEscrows). `conditions` / `cancelAfters` (ISO) by
 * milestone index; every CancelAfter must be before loan maturity (planLoanClose rejects it otherwise, nothing submitted).
 */
export async function closeProject(
  log: TxLog,
  project: Project,
  o: { conditions: string[]; cancelAfters: string[]; paymentTotal: number; paymentIntervalS: number; onWait?: (s: number) => void },
): Promise<CloseLoanResult> {
  const w = loadWallets();
  const originationFee = originationFeeFor(project.terms.principal);
  await ensureRlusd(log, "builder", Math.ceil(Number(originationFee)) + Number(VERIFICATION_FEE_RLUSD) + 1_000);
  const close = await closeLoanAndCreateEscrows(project, {
    conditions: o.conditions,
    cancelAfters: o.cancelAfters,
    paymentTotal: o.paymentTotal,
    paymentIntervalS: o.paymentIntervalS,
    waitForInvestmentPhase: true,
    allowOverpayment: true,
    builderAddress: w.builder.classicAddress,
    ...(o.onWait ? { onWait: o.onWait } : {}),
  });
  if (o.onWait) process.stdout.write("\n");
  log.rec(`Payment builder -> SPV ${close.originationFee} (origination fee at closing)`, close.originationFeeTopUpTx);
  log.rec(`LoanSet ${project.terms.principal} (SPV multisig countersign, fee ${close.originationFee})`, close.loanSetTx);
  close.escrows.forEach((e, i) => {
    const ev = close.events.find((x) => x.kind === "escrow_created" && x.milestoneId === e.milestoneId)!;
    log.rows.push({ beat: log.beat, step: `EscrowCreate m${i + 1} ${e.amount} (CancelAfter ${e.cancelAfter.slice(0, 19)})`, type: "EscrowCreate", result: "tesSUCCESS", url: ev.explorerUrl, hash: e.createTx });
    log.info(`✓ EscrowCreate m${i + 1} ${e.amount.padEnd(6)} seq=${e.offerSequence} ${ev.explorerUrl}`);
  });
  close.escrows.forEach((e, i) => (project.milestones[i]!.cancelAfter = e.cancelAfter));
  project.chain.loanId = close.loanId;
  return close;
}

// ------------------------------------------------------------------ test suite: attestations + release

/** Inspector-app flow (INS): core prepares the unsigned attestation, the inspector's software key signs, core submits the blob. */
export async function attestAudit(
  log: TxLog,
  project: Project,
  milestoneId: string,
  inspector: Wallet,
  audit: unknown,
  decision: "pass" | "partial" | "fail" = "pass",
): Promise<{ tx: TxResult; hash: string }> {
  const hash = sha256Hex(JSON.stringify(audit));
  const memo: AttestMemo = { v: 1, kind: "audit", milestoneId, hash, decision };
  const unsigned = await prepareAttestTx({ account: inspector.classicAddress, spv: project.chain.spv!, memo });
  const { tx_blob } = inspector.sign(unsigned);
  const r = await submitSignedBlob(tx_blob, { expectSigner: inspector.classicAddress, expectSpv: project.chain.spv!, projectId: project.id });
  log.rec(`attest audit ${decision} (inspector signed blob, ${hash.slice(0, 8)}…)`, r.tx);
  return { tx: r.tx, hash };
}

export async function attestVerdict(log: TxLog, project: Project, milestoneId: string, verdict: { decision: "pass" | "fail" | "needs_human"; reason?: string } & Record<string, unknown>) {
  const hash = sha256Hex(canonicalJson(verdict));
  const r = await attest({
    signer: "aiAgent",
    spv: project.chain.spv!,
    projectId: project.id,
    memo: { v: 1, kind: "verdict", milestoneId, hash, decision: verdict.decision, ...(verdict.reason ? { reason: verdict.reason.slice(0, 200) } : {}) },
  });
  log.rec(`attest verdict ${verdict.decision} (aiAgent, ${hash.slice(0, 8)}…)`, r.tx);
  return { ...r, hash };
}

/** Sorted-key JSON (same idea as the verifier's verdictHash). */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
}

/**
 * Release-service path (CORE-12): suite passed -> preflightFinish (XRPL-14) -> `release` attestation -> EscrowFinish
 * by releaseService. Throws (nothing revealed) if preflight refuses.
 */
export async function releaseWithSuite(
  log: TxLog,
  project: Project,
  esc: MilestoneEscrowInfo,
  rs: ReleaseServiceStandIn,
  suite: { passed: string[]; attestRelease?: boolean },
): Promise<{ preflight: PreflightResult; finish: TxResult; event: ChainEvent }> {
  const w = loadWallets();
  const fulfillment = rs.fulfillmentFor(project.id, esc.milestoneId, esc.condition);
  const pf = await preflightFinish({ owner: esc.owner, offerSequence: esc.offerSequence, destination: w.builder.classicAddress, condition: esc.condition, fulfillment, submitter: w.releaseService.classicAddress });
  if (!pf.ok) throw new Error(`preflight refused ${esc.milestoneId}: ${pf.reason} ${pf.message ?? ""} — nothing submitted, preimage not revealed`);
  log.info(`preflight ok: escrow open, ${pf.details.secondsToCancelAfter}s to CancelAfter, builder trust line ok, condition matches (fee ${pf.details.recommendedFee} drops)`);
  if (suite.attestRelease !== false) {
    const rel = await attest({
      signer: "releaseService",
      spv: esc.owner,
      projectId: project.id,
      memo: { v: 1, kind: "release", milestoneId: esc.milestoneId, hash: sha256Hex(canonicalJson({ milestoneId: esc.milestoneId, suite: suite.passed, result: "pass" })), decision: "pass" },
    });
    log.rec(`attest release (releaseService: ${suite.passed.length} checks green)`, rel.tx);
  }
  // after XRPL-07 merge: releaseMilestone's default submitter is releaseService.
  const fin = await releaseMilestone({ projectId: project.id, milestoneId: esc.milestoneId, escrow: esc.escrow, fulfillment, amount: esc.amount, submitter: "releaseService" });
  log.rec(`EscrowFinish ${esc.milestoneId.split("-").slice(-2).join("-")} ${esc.amount} -> builder`, fin.tx);
  return { preflight: pf, finish: fin.tx, event: fin.event };
}

/**
 * "Ledger says no": the platform submits EscrowFinish with RANDOM bytes (never reads the preimage store).
 * Expected on-ledger tecCRYPTOCONDITION_ERROR; returns the XrplTxError instead of throwing.
 * after XRPL-07 merge: tryFinishWithWrongFulfillment(...).
 */
export async function tryWrongFulfillment(log: TxLog, esc: MilestoneEscrowInfo): Promise<XrplTxError> {
  const w = loadWallets();
  const wrong = fulfillmentFromPreimage(randomBytes(32));
  try {
    const tx = await signAndSubmit(w.platform, {
      TransactionType: "EscrowFinish",
      Account: w.platform.classicAddress,
      Owner: esc.owner,
      OfferSequence: esc.offerSequence,
      Condition: esc.condition,
      Fulfillment: wrong,
    });
    throw new Error(`EscrowFinish with a random fulfillment SUCCEEDED?! ${tx.explorerUrl}`);
  } catch (e) {
    if (e instanceof XrplTxError && e.engineResult === "tecCRYPTOCONDITION_ERROR") {
      log.expectedFailure(`EscrowFinish ${esc.milestoneId.split("-").slice(-2).join("-")} with random bytes (platform key)`, "EscrowFinish", e);
      return e;
    }
    throw e;
  }
}

/** builder -> SPV RLUSD (repayment funds). after XRPL-07 merge: builderPayToSpv(...). */
export async function builderPayToSpv(log: TxLog, spv: string, amount: string): Promise<TxResult> {
  const w = loadWallets();
  return log.rec(`Payment builder -> SPV ${amount} (repayment funds)`, await payRlusd(w.builder, spv, w.issuer.classicAddress, amount))!;
}

/** SPV LoanPay (multisig). after XRPL-07 merge: repayLoan({ ..., source }) (source = "escrow_refund" | "builder"). */
export async function spvLoanPay(log: TxLog, project: Project, o: { amount?: string; mode?: "regular" | "overpayment"; label: string }) {
  const r = await repayLoan({ projectId: project.id, spv: project.chain.spv!, loanId: project.chain.loanId!, ...(o.amount ? { amount: o.amount } : {}), ...(o.mode ? { mode: o.mode } : {}) });
  log.rec(`LoanPay ${r.amount} ${r.mode} (${o.label})`, r.tx);
  return r;
}

// ------------------------------------------------------------------ reads

export async function snapshot(project: Project) {
  const w = loadWallets();
  const [vault, loan, spvRlusd] = await Promise.all([
    retry("vault snapshot", () => getVaultSnapshot(project.chain.vaultId!)),
    project.chain.loanId ? retry("loan snapshot", () => getLoanSnapshot(project.chain.loanId!)) : Promise.resolve(undefined),
    retry("SPV balance", () => rlusdBalance(project.chain.spv!, w.issuer.classicAddress)),
  ]);
  return { vault, loan, spvRlusd };
}

export function printSnapshot(log: TxLog, label: string, s: Awaited<ReturnType<typeof snapshot>>) {
  const v = s.vault;
  const l = s.loan;
  log.info(`${label} vault: phase=${v?.phase} assetsTotal=${v?.assetsTotal} available=${v?.assetsAvailable} sharePrice=${v?.sharePrice}`);
  if (l) log.info(`${label} loan:  principal=${l.principalOutstanding} totalOutstanding=${l.totalValueOutstanding} periodic=${l.periodicPayment} remaining=${l.paymentRemaining} nextDue=${l.nextPaymentDueDate || "-"}`);
  log.info(`${label} SPV RLUSD: ${s.spvRlusd}`);
}

export async function escrowStillOpen(esc: MilestoneEscrowInfo): Promise<boolean> {
  return !!(await retry("escrow read", () => getEscrow(esc.owner, esc.offerSequence)));
}

