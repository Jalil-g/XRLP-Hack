// pnpm --filter @xrlp/xrpl prestage [--only A,B]     (also: pnpm --filter @xrlp/xrpl demo --prestage)
// Pre-stages the three demo projects on devnet so nothing on stage waits on a ledger time gate (docs/04-demo-script.md):
//   A "ready"   Maple St duplex: verified + funded + closed, 3 escrows open (CancelAfter 30/60/90 days), 6 x 30-day
//               loan, generous RedemptionDate. On stage: release M1, fraud on M2, try-steal M2.
//   B "stalled" M1 released; M2's CancelAfter already PAST (EscrowCancel ready); 12 x 30-day loan so the refund LoanPay
//               is on time and >= one periodic payment. On stage: keeper tick -> EscrowCancel -> refund LoanPay.
//   C "repaid"  2 x 240 s loan; all escrows released, builder pays the SPV, two SPV LoanPays pay it off; vault past
//               RedemptionDate.
//               On stage: investors can VaultWithdraw.
// Writes .data/prestage.json (shape: src/prestage-types.ts PrestageFile; read by core, CORE-07) and the escrow
// preimages to .data/prestage-preimages.json (release-service stand-in, mode 600, never printed).
// Re-runs reuse wallets/credentials/domain and create fresh projects. `--only A,B` re-stages a subset and keeps the
// other projects of the existing prestage.json (e.g. after a rehearsal consumed A's M1 and B's expired escrow: ~4 min).
//
// Timing: ~13 min for A+B+C (dominated by C waiting for its RedemptionDate), ~3-5 min for --only A,B.
// Env knobs (seconds):
//   PRESTAGE_SUBSCRIPTION_S=60      deposit window per project.
//   PRESTAGE_B_STALL_CANCEL_S=90    B's M2 CancelAfter after B's close (>= 60 + a few s: planLoanClose floor; prestage
//                                   waits until it has passed).
//   PRESTAGE_C_INTERVAL_S=240       C's PaymentInterval (2 payments; escrow CancelAfter = 1.5 intervals after the close,
//                                   so it is before maturity and > 120 s preflight margin when the finishes run).
//   PRESTAGE_C_CLOSE_WINDOW_S=180   C's LoanSet must land within this after C's SubscriptionDate.
import { existsSync, readFileSync } from "node:fs";
import { isoTimeToRippleTime } from "xrpl";
import { bootstrapWallets, disconnect, getShareBalance, ledgerTime, rlusdBalance, waitForLedgerTimeAfter } from "../src/index.ts";
import type { CloseLoanResult, MilestoneEscrowInfo } from "../src/api.ts";
import { config, RLUSD_CURRENCY } from "../src/config.ts";
import { originationFeeFor } from "../src/lending-math.ts";
import {
  parsePrestageFile,
  PRESTAGE_KEYS,
  PRESTAGE_PREIMAGES_FILE,
  PRESTAGE_VERSION,
  prestageVaultDates,
  type PrestageEscrowState,
  type PrestageFile,
  type PrestageKey,
  type PrestageProject,
  type PrestageScenario,
} from "../src/prestage-types.ts";
import { loadWallets, WALLET_ROLES } from "../src/wallets.ts";
import type { Project } from "@xrlp/shared";
import {
  attestAudit,
  attestVerdict,
  builderPayToSpv,
  closeProject,
  dataPath,
  DAY_S,
  deposit,
  ensureParticipants,
  ensureRlusd,
  envNum,
  iso,
  makeProject,
  printSnapshot,
  ReleaseServiceStandIn,
  releaseWithSuite,
  repoRel,
  setupPrivateProject,
  snapshot,
  spvLoanPay,
  tick,
  TxLog,
  verifyBuilder,
  writeJsonAtomic,
  type ProjectSpec,
} from "./demo-lib.ts";

const SUBSCRIPTION_S = envNum("PRESTAGE_SUBSCRIPTION_S", 60);
const B_STALL_CANCEL_S = envNum("PRESTAGE_B_STALL_CANCEL_S", 90);
const C_INTERVAL_S = envNum("PRESTAGE_C_INTERVAL_S", 240);
const C_CLOSE_WINDOW_S = envNum("PRESTAGE_C_CLOSE_WINDOW_S", 180);
const MONTH_S = 30 * DAY_S;
const CHECKS = ["required_evidence_present", "gps_within_site", "photo_fresh", "no_duplicate_photo", "invoice_matches_budget", "inspector_audit_present", "audit_checklist_complete", "stage_visually_consistent"];

interface Plan {
  key: PrestageKey;
  scenario: PrestageScenario;
  spec: Omit<ProjectSpec, "id">;
  closeWindowS: number;
  bufferS: number;
  /** CancelAfter per milestone, seconds after the close. */
  cancelAfterS: number[];
}

const PLANS: Record<PrestageKey, Plan> = {
  A: {
    key: "A",
    scenario: "ready",
    spec: {
      name: "Maple St duplex",
      siteAddress: "48 Maple St, Beacon, NY 12508",
      siteGeo: { lat: 41.5048, lng: -73.9696, radiusM: 150 },
      description: "Two-family new build on an infill lot. 2 x 3BR/2BA, ~2,600 sq ft. Permits issued.",
      principal: "30000",
      interestRateBps: 1000,
      milestones: [
        ["foundation", "Foundation", "9000"],
        ["framing", "Framing", "12000"],
        ["dry_in", "Roof & Dry-in", "9000"],
      ],
      paymentTotal: 6,
      paymentIntervalS: MONTH_S,
    },
    closeWindowS: DAY_S,
    bufferS: 2 * DAY_S,
    cancelAfterS: [30 * DAY_S, 60 * DAY_S, 90 * DAY_S],
  },
  B: {
    key: "B",
    scenario: "stalled",
    spec: {
      name: "Birch Rd townhouse",
      siteAddress: "17 Birch Rd, Newburgh, NY 12550",
      siteGeo: { lat: 41.5034, lng: -74.0104, radiusM: 150 },
      description: "Single-family townhouse. Builder stopped after the foundation.",
      principal: "30000",
      interestRateBps: 1000,
      milestones: [
        ["foundation", "Foundation", "9000"],
        ["framing", "Framing", "12000"],
        ["dry_in", "Roof & Dry-in", "9000"],
      ],
      // Long interval: the refund LoanPay on stage is on time; 12 payments: periodic (~2.6k) <= the 12k refund.
      paymentTotal: 12,
      paymentIntervalS: MONTH_S,
    },
    closeWindowS: DAY_S,
    bufferS: 2 * DAY_S,
    cancelAfterS: [30 * DAY_S, B_STALL_CANCEL_S, 60 * DAY_S],
  },
  C: {
    key: "C",
    scenario: "repaid",
    spec: {
      name: "Elm St ADU",
      siteAddress: "5 Elm St, Cold Spring, NY 10516",
      siteGeo: { lat: 41.4201, lng: -73.9546, radiusM: 120 },
      description: "Accessory dwelling unit. Completed and repaid.",
      principal: "12000",
      interestRateBps: 1000,
      milestones: [
        ["foundation", "Foundation", "3000"],
        ["framing", "Framing", "5000"],
        ["dry_in", "Roof & Dry-in", "4000"],
      ],
      paymentTotal: 2, // XRPL-06 planLoanClose: PaymentTotal >= 2
      paymentIntervalS: C_INTERVAL_S,
    },
    closeWindowS: C_CLOSE_WINDOW_S,
    bufferS: 0,
    // Before maturity (2 intervals) and far enough out for the 120 s preflight margin at finish time.
    cancelAfterS: [1.5, 1.5, 1.5].map((f) => Math.round(f * C_INTERVAL_S)),
  },
};

interface Staged {
  plan: Plan;
  log: TxLog;
  project: Project;
  setup?: Awaited<ReturnType<typeof setupPrivateProject>>;
  fee?: { amount: string; txHash: string };
  investments: PrestageProject["investments"];
  close?: CloseLoanResult;
  loanSetAt?: string;
  closedAt?: number;
  finished: Record<string, string>;
}

function parseOnly(): PrestageKey[] {
  const i = process.argv.indexOf("--only");
  const raw = (i >= 0 ? process.argv[i + 1] : process.argv.find((a) => a.startsWith("--only="))?.slice(7)) ?? process.env.PRESTAGE_ONLY ?? "A,B,C";
  const keys = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  for (const k of keys) if (!(PRESTAGE_KEYS as readonly string[]).includes(k)) throw new Error(`--only: unknown project ${k} (use A,B,C)`);
  return keys as PrestageKey[];
}

const runId = Date.now().toString(36);
const rs = new ReleaseServiceStandIn(dataPath("prestage-preimages.json"));
const common = new TxLog("[*] ");
const only = parseOnly();
const staged = new Map<PrestageKey, Staged>();

async function stageSetup(s: Staged, domainId: string, inspector: string) {
  const { log, project, plan } = s;
  log.say(`${plan.key} setup: verification fee, SPV, private vault, broker, cover, deposits`);
  await ensureRlusd(log, "builder", 1_000);
  const v = await verifyBuilder(log, project.id);
  s.fee = { amount: "250", txHash: v.fee.hash };
  s.setup = await setupPrivateProject(log, project, {
    domainId,
    subscriptionInS: SUBSCRIPTION_S,
    redemptionFor: (sub) =>
      prestageVaultDates({ subscriptionDate: sub, paymentTotal: plan.spec.paymentTotal, paymentIntervalS: plan.spec.paymentIntervalS, closeWindowS: plan.closeWindowS, bufferS: plan.bufferS }).redemptionDate,
    paymentTotal: plan.spec.paymentTotal,
    paymentIntervalS: plan.spec.paymentIntervalS,
    inspector,
  });
  const w = loadWallets();
  const p = Number(plan.spec.principal);
  for (const [role, amount] of [["investor1", String(p * 0.6)], ["investor2", String(p * 0.4)]] as const) {
    const d = await deposit(log, project, role, amount);
    s.investments.push({ role, investor: w[role].classicAddress, amount, txHash: d.tx!.hash });
  }
  // Project A keeps the "no KYC -> tecNO_AUTH" tx for the UI's audit trail.
  if (plan.key === "A") await deposit(log, project, "investor3", "8000", true);
}

async function stageClose(s: Staged) {
  const { log, project, plan, setup } = s;
  if (!setup) throw new Error(`${plan.key}: setup missing`);
  log.say(`${plan.key} close: LoanSet + ${project.milestones.length} escrows`);
  const sub = isoTimeToRippleTime(setup.subscriptionEndsAt);
  await waitForLedgerTimeAfter(sub, tick(`${plan.key} SubscriptionDate`));
  const red = isoTimeToRippleTime(setup.redemptionAt);
  if ((await ledgerTime()) + plan.spec.paymentTotal * plan.spec.paymentIntervalS + 60 > red) {
    throw new Error(
      `${plan.key}: too late for LoanSet (ledger now + schedule + 60s > RedemptionDate ${setup.redemptionAt}); the close window was missed. ` +
        `Re-run (or raise PRESTAGE_C_CLOSE_WINDOW_S).`,
    );
  }
  await ensureRlusd(log, "builder", Math.ceil(Number(originationFeeFor(project.terms.principal))) + 1_250);
  const conditions = rs.conditionsFor(project);
  rs.save();
  const now = await ledgerTime(); // right before planning: short CancelAfters (B's M2) stay > now + 60 s
  s.close = await closeProject(log, project, {
    conditions,
    cancelAfters: plan.cancelAfterS.map((d) => iso(now + d)),
    paymentTotal: plan.spec.paymentTotal,
    paymentIntervalS: plan.spec.paymentIntervalS,
  });
  s.closedAt = await ledgerTime();
  s.loanSetAt = iso(s.closedAt);
}

/** withSuite: audit + verdict + release attestations (B's M1, shown in the UI); C: finish only (history, saves ledgers). */
async function releaseM(s: Staged, esc: MilestoneEscrowInfo, withSuite: boolean) {
  const w = loadWallets();
  if (withSuite) {
    await attestAudit(s.log, s.project, esc.milestoneId, w.inspector1, { milestoneId: esc.milestoneId, inspector: w.inspector1.classicAddress, checklist: [{ sovCode: "F-01", status: "done" }] });
    await attestVerdict(s.log, s.project, esc.milestoneId, { milestoneId: esc.milestoneId, decision: "pass", confidence: 0.93, model: "mock", checks: CHECKS });
  }
  const r = await releaseWithSuite(s.log, s.project, esc, rs, { passed: CHECKS, attestRelease: withSuite });
  s.finished[esc.milestoneId] = r.finish.hash;
}

async function stageB(s: Staged) {
  s.log.say("B: milestone 1 passes its suite and is released; milestone 2 is left to expire (stall)");
  await releaseM(s, s.close!.escrows[0]!, true);
}

async function stageC(s: Staged) {
  const { log, project } = s;
  log.say("C: all milestones released, builder repays the SPV, SPV LoanPays pay the loan off");
  for (const esc of s.close!.escrows) await releaseM(s, esc, false);
  const w = loadWallets();
  const snap = await snapshot(project);
  const total = snap.loan?.paymentRemaining ?? 0;
  // Every remaining installment (early payments are on time) + headroom for rounding / a late one.
  const due = Number(snap.loan?.periodicPayment ?? "0") * total;
  const short = Math.ceil((due - Number(snap.spvRlusd)) * 100) / 100 + 1;
  if (short > 0) {
    await ensureRlusd(log, "builder", Math.ceil(short) + 1_000);
    await builderPayToSpv(log, project.chain.spv!, short.toFixed(2));
  }
  for (let i = 1; i <= total; i++) await spvLoanPay(log, project, { label: `repayment ${i} of ${total}` });
  const after = await snapshot(project);
  if (!after.loan || after.loan.paymentRemaining !== 0) {
    throw new Error(`C: loan not paid off after LoanPay (paymentRemaining=${after.loan?.paymentRemaining}, totalOutstanding=${after.loan?.totalValueOutstanding})`);
  }
  log.info(`C loan paid off; builder RLUSD ${await rlusdBalance(w.builder.classicAddress, w.issuer.classicAddress)}`);
}

function escrowState(s: Staged, e: MilestoneEscrowInfo, nowRipple: number): PrestageEscrowState {
  if (s.finished[e.milestoneId]) return "finished";
  return isoTimeToRippleTime(e.cancelAfter) < nowRipple ? "expired" : "open";
}

async function toPrestageProject(s: Staged, nowRipple: number): Promise<PrestageProject> {
  const { plan, project, setup, close, log } = s;
  if (!setup || !close) throw new Error(`${plan.key}: incomplete`);
  const w = loadWallets();
  const snap = await snapshot(project);
  printSnapshot(log, plan.key, snap);
  return {
    key: plan.key,
    scenario: plan.scenario,
    projectId: project.id,
    name: project.name,
    type: project.type,
    siteAddress: project.siteAddress,
    siteGeo: project.siteGeo,
    status: plan.scenario === "repaid" ? "completed" : "escrowed",
    builder: w.builder.classicAddress,
    assignedInspector: setup.signers.inspector,
    terms: {
      principal: project.terms.principal,
      interestRateBps: project.terms.interestRateBps,
      paymentTotal: plan.spec.paymentTotal,
      paymentIntervalS: plan.spec.paymentIntervalS,
      originationFee: close.originationFee || originationFeeFor(project.terms.principal),
    },
    milestones: project.milestones.map((m) => ({
      id: m.id,
      index: m.index,
      templateKey: m.templateKey,
      title: m.title,
      amount: m.amount,
      status: s.finished[m.id] ? "released" : "pending",
    })),
    chain: {
      spv: setup.spv,
      vaultId: setup.vaultId,
      vaultPseudoAccount: setup.vaultPseudoAccount,
      shareMptIssuanceId: setup.shareMptIssuanceId,
      loanBrokerId: setup.loanBrokerId,
      loanId: close.loanId,
      domainId: setup.domainId,
    },
    spv: { address: setup.spv, signers: setup.signers, quorum: 3 },
    cover: { amount: setup.cover.amount, minimum: setup.cover.minimum, txHash: setup.cover.txHash },
    verificationFee: s.fee!,
    investments: s.investments,
    escrows: close.escrows.map((e, index) => ({
      milestoneId: e.milestoneId,
      index,
      owner: e.owner,
      offerSequence: e.offerSequence,
      condition: e.condition,
      cancelAfter: e.cancelAfter,
      amount: e.amount,
      destination: w.builder.classicAddress,
      createTx: e.createTx,
      createdAt: s.loanSetAt!,
      state: escrowState(s, e, nowRipple),
      ...(s.finished[e.milestoneId] ? { finishTx: s.finished[e.milestoneId] } : {}),
    })),
    dates: {
      subscriptionDate: setup.subscriptionEndsAt,
      redemptionDate: setup.redemptionAt,
      loanSetAt: s.loanSetAt!,
      nextPaymentDueDate: snap.loan?.nextPaymentDueDate ?? "",
    },
    snapshot: {
      ...(snap.vault ? { vault: { assetsTotal: snap.vault.assetsTotal, assetsAvailable: snap.vault.assetsAvailable, sharesOutstanding: snap.vault.sharesOutstanding, sharePrice: snap.vault.sharePrice, phase: snap.vault.phase } } : {}),
      ...(snap.loan ? { loan: snap.loan } : {}),
      spvRlusd: snap.spvRlusd,
    },
    txs: log.asPrestageTxs(),
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`prestage ${runId}: projects ${only.join(",")}  (wallets ${repoRel(config.walletsFile)})`);
  console.log(`  expected duration: ${only.includes("C") ? "~13 min (C waits for its RedemptionDate)" : "~3-5 min"}`);

  common.say("common: wallets, credentials, domain (idempotent)");
  const { wallets: w, txs } = await bootstrapWallets({ log: (s) => common.info(s) });
  txs.forEach((t, i) => common.rec(`bootstrap #${i + 1} ${String(t.tx.TransactionType)}`, t));
  const { domainId } = await ensureParticipants(common);

  for (const key of only) {
    const plan = PLANS[key];
    const project = makeProject({ ...plan.spec, id: `ps-${runId}-${key.toLowerCase()}` }, new Date(Date.now() + SUBSCRIPTION_S * 1000).toISOString());
    staged.set(key, { plan, log: new TxLog(`[${key}] `), project, investments: [], finished: {} });
  }
  const S = (k: PrestageKey) => staged.get(k);
  const inspector = w.inspector1.classicAddress;
  // Pipelined so ledger time gates overlap: C first (longest wait), its close while A sets up, etc.
  const order: [PrestageKey, (s: Staged) => Promise<void>][] = [
    ["C", (s) => stageSetup(s, domainId, inspector)],
    ["B", (s) => stageSetup(s, domainId, inspector)],
    ["C", (s) => stageClose(s).then(() => stageC(s))],
    ["A", (s) => stageSetup(s, domainId, inspector)],
    ["B", (s) => stageClose(s).then(() => stageB(s))],
    ["A", stageClose],
  ];
  for (const [k, fn] of order) {
    const s = S(k);
    if (!s) continue;
    try {
      await fn(s);
    } catch (e) {
      throw new Error(`project ${k} (${s.project.id}) failed during "${s.log.beat}": ${(e as Error).message}`, { cause: e });
    }
  }

  // Ledger gates must be past before core imports the file.
  const gates: [string, number][] = [];
  const b = S("B");
  if (b?.close) gates.push(["B M2 CancelAfter", isoTimeToRippleTime(b.close.escrows[1]!.cancelAfter)]);
  const c = S("C");
  if (c?.setup) gates.push(["C RedemptionDate", isoTimeToRippleTime(c.setup.redemptionAt) - 1]);
  for (const [label, t] of gates.sort((x, y) => x[1] - y[1])) {
    common.say(`waiting: ${label} (${iso(t + 1)})`);
    await waitForLedgerTimeAfter(t, tick(label));
    process.stdout.write("\n");
  }
  if (c?.setup) {
    for (const inv of ["investor1", "investor2"] as const) common.info(`C ${inv} shares (withdrawable now): ${await getShareBalance(w[inv].classicAddress, c.setup.shareMptIssuanceId)}`);
  }

  const now = await ledgerTime();
  const out = dataPath("prestage.json");
  const prev = existsSync(out) ? safeParse(out) : undefined;
  const keepPrev = prev && prev.rlusd.issuer === w.issuer.classicAddress && prev.network === config.network;
  const projects: PrestageFile["projects"] = keepPrev ? { ...prev.projects } : {};
  for (const s of staged.values()) projects[s.plan.key] = await toPrestageProject(s, now);
  const file: PrestageFile = {
    version: PRESTAGE_VERSION,
    network: config.network,
    createdAt: startedAt,
    finishedAt: new Date().toISOString(),
    rlusd: { currency: RLUSD_CURRENCY, issuer: w.issuer.classicAddress },
    domainId,
    accounts: Object.fromEntries(WALLET_ROLES.map((r) => [r, w[r].classicAddress])),
    preimagesFile: repoRel(rs.path) || PRESTAGE_PREIMAGES_FILE,
    projects,
  };
  parsePrestageFile(JSON.parse(JSON.stringify(file))); // never write a file core can't read (or one carrying a secret)
  writeJsonAtomic(out, file);

  console.log("\n== SUMMARY");
  console.log(common.table("prestage common"));
  for (const s of staged.values()) {
    console.log("\n" + s.log.table(`Project ${s.plan.key} (${s.plan.scenario}) — ${s.project.id}`));
    for (const n of s.log.notes) console.log(`NOTE [${s.plan.key}] ${n}`);
  }
  for (const s of staged.values()) {
    const e = s.close!.escrows;
    console.log(`\n${s.plan.key} ${s.project.id}: SPV ${s.setup!.spv} vault ${s.setup!.vaultId} loan ${s.close!.loanId}`);
    console.log(`   escrows: ${e.map((x, i) => `m${i + 1} seq ${x.offerSequence} ${projects[s.plan.key]!.escrows[i]!.state} (cancel ${x.cancelAfter.slice(0, 19)})`).join(" | ")}`);
    console.log(`   redemption ${s.setup!.redemptionAt}`);
  }
  if (keepPrev) for (const k of PRESTAGE_KEYS) if (!staged.has(k) && projects[k]) console.log(`\n${k}: kept from the previous prestage.json (${projects[k]!.projectId})`);
  console.log(`\nwrote ${repoRel(out)} (for core, CORE-07) and ${repoRel(rs.path)} (preimages, SECRET, mode 600)`);
}

function safeParse(path: string): PrestageFile | undefined {
  try {
    return parsePrestageFile(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
}

try {
  await main();
} catch (e) {
  console.error("\nPRESTAGE FAILED:", (e as Error).message);
  if ((e as Error).cause) console.error("  cause:", (e as Error).cause);
  for (const l of [common, ...[...staged.values()].map((s) => s.log)]) {
    for (const r of l.rows) console.error(`  ${r.step}: ${r.result} ${r.url}`);
  }
  console.error("prestage.json NOT written (the previous file, if any, is untouched). Preimages of escrows created so far are in", repoRel(rs.path));
  process.exitCode = 1;
} finally {
  await disconnect();
}
