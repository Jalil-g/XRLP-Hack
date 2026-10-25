// pnpm --filter @xrlp/xrpl demo              CLI backup of the live demo (docs/04-demo-script.md beats 1-6), ~5 min
// pnpm --filter @xrlp/xrpl demo --prestage   = pnpm --filter @xrlp/xrpl prestage (Projects A/B/C -> .data/prestage.json)
//
// Whole v2 story on devnet with real txs, one fresh project per run (wallets reused from WALLETS_FILE):
//   builder pays the 250 RLUSD verification fee -> VERIFIED_BUILDER -> lock terms (SPV 4 signers q3, private closed-ended
//   vault, broker + cover) -> KYC'd investors deposit, investor3 (no KYC) -> tecNO_AUTH -> close (LoanSet + 3 escrows,
//   conditions from the release-service stand-in) -> M1: inspector audit + AI verdict attestations -> preflight ->
//   release attestation -> EscrowFinish to the builder -> M2: verdict FAIL, escrow stays locked -> "ledger says no":
//   random fulfillment -> tecCRYPTOCONDITION_ERROR -> M3 stalls: CancelAfter passes -> EscrowCancel -> refund LoanPay
//   (overpayment) -> vault/loan snapshots.
//
// Env knobs (seconds):
//   DEMO_SUBSCRIPTION_S=60       deposit window after VaultCreate (then the close waits for SubscriptionDate).
//   DEMO_PAYMENT_INTERVAL_S=300  loan PaymentInterval. The refund LoanPay must land before the first due date
//                                (LoanSet + interval), so keep it > DEMO_M3_CANCEL_S + ~60.
//   DEMO_PAYMENT_TOTAL=4         payments. The 9000 refund must cover one periodic payment (~principal/total): keep >= 4.
//   DEMO_M3_CANCEL_S=150         milestone 3 CancelAfter, seconds after the close.
//   DEMO_WITHDRAW=1              after the story, wait for the vault's RedemptionDate and VaultWithdraw (investor1).
//                                RedemptionDate = SubscriptionDate + 120 (close window) + interval x total + 60 s:
//                                ~25 min after start with the defaults, ~18 min with DEMO_PAYMENT_INTERVAL_S=200
//                                DEMO_M3_CANCEL_S=100. (The old "~10 min" was wrong.) For a withdrawal on stage use
//                                prestage Project C, which is already past RedemptionDate.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isoTimeToRippleTime } from "xrpl";
import { bootstrapWallets, cancelExpiredMilestone, disconnect, getShareBalance, getSpvInfo, ledgerTime, rlusdBalance, waitForLedgerTimeAfter, withdrawFromVault } from "../src/index.ts";
import { config, REPO_ROOT } from "../src/config.ts";
import { prestageVaultDates } from "../src/prestage-types.ts";
import {
  attestAudit,
  attestVerdict,
  closeProject,
  dataPath,
  deposit,
  ensureParticipants,
  envNum,
  escrowStillOpen,
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
  tryWrongFulfillment,
  TxLog,
  verifyBuilder,
  writeJsonAtomic,
} from "./demo-lib.ts";

if (process.argv.includes("--prestage")) {
  await import("./prestage.ts");
} else {
  await runDemo();
}

async function runDemo() {
  const SUBSCRIPTION_S = envNum("DEMO_SUBSCRIPTION_S", 60);
  const PAYMENT_INTERVAL_S = envNum("DEMO_PAYMENT_INTERVAL_S", 300);
  const PAYMENT_TOTAL = envNum("DEMO_PAYMENT_TOTAL", 4);
  const M3_CANCEL_S = envNum("DEMO_M3_CANCEL_S", 150);
  const CLOSE_WINDOW_S = 120;
  const DO_WITHDRAW = process.env.DEMO_WITHDRAW === "1";
  if (M3_CANCEL_S + 45 >= PAYMENT_INTERVAL_S) {
    console.warn(`WARN DEMO_M3_CANCEL_S=${M3_CANCEL_S} is too close to DEMO_PAYMENT_INTERVAL_S=${PAYMENT_INTERVAL_S}: the refund LoanPay may be late.`);
  }

  const log = new TxLog();
  const startedAt = new Date().toISOString();
  const projectId = `demo-${Date.now().toString(36)}`;
  const rs = new ReleaseServiceStandIn(dataPath("demo-preimages.json"));
  try {
    log.say("0. wallets + participants (idempotent)");
    const { wallets: w, txs } = await bootstrapWallets({ log: (s) => log.info(s) });
    txs.forEach((t, i) => log.rec(`bootstrap #${i + 1} ${String(t.tx.TransactionType)}`, t));
    const { domainId } = await ensureParticipants(log);
    const issuer = w.issuer.classicAddress;

    const project = makeProject(
      {
        id: projectId,
        name: "Maple St duplex",
        siteAddress: "48 Maple St, Beacon, NY 12508",
        siteGeo: { lat: 41.5048, lng: -73.9696, radiusM: 150 },
        description: "Two-family new build (CLI demo, XRPL-11)",
        principal: "30000",
        interestRateBps: 1000,
        milestones: [
          ["foundation", "Foundation", "9000"],
          ["framing", "Framing", "12000"],
          ["dry_in", "Roof & Dry-in", "9000"],
        ],
        paymentTotal: PAYMENT_TOTAL,
        paymentIntervalS: PAYMENT_INTERVAL_S,
      },
      new Date(Date.now() + SUBSCRIPTION_S * 1000).toISOString(),
    );
    const [m1, m2, m3] = project.milestones as [(typeof project.milestones)[0], (typeof project.milestones)[0], (typeof project.milestones)[0]];

    log.say(
      "1. Verified project",
      "The builder pays to be checked. Our AI verifies identity, feasibility and capability, and the result is a credential on the ledger.",
    );
    await verifyBuilder(log, projectId);

    log.say("2. Lock terms: SPV (4 signers, quorum 3) + private closed-ended vault + broker + first-loss cover", "Investors fund this project's vault. Only KYC'd investors can get in.");
    const setup = await setupPrivateProject(log, project, {
      domainId,
      subscriptionInS: SUBSCRIPTION_S,
      redemptionFor: (sub) => prestageVaultDates({ subscriptionDate: sub, paymentTotal: PAYMENT_TOTAL, paymentIntervalS: PAYMENT_INTERVAL_S, closeWindowS: CLOSE_WINDOW_S }).redemptionDate,
      paymentTotal: PAYMENT_TOTAL,
      paymentIntervalS: PAYMENT_INTERVAL_S,
      inspector: w.inspector1.classicAddress,
    });
    const spvInfo = await getSpvInfo(setup.spv);
    log.info(`SPV ${setup.spv}: masterDisabled=${spvInfo.masterDisabled} quorum=${spvInfo.signerQuorum} signers=${spvInfo.signers.map((s) => s.account).join(",")}`);
    log.info(`vault ${setup.vaultId} (domain ${domainId})\n    broker ${setup.loanBrokerId}  cover ${setup.cover.amount}  subscription ends ${setup.subscriptionEndsAt}  redemption ${setup.redemptionAt}`);

    log.say("2b. KYC'd investors deposit; investor3 has no KYC credential");
    await deposit(log, project, "investor1", "18000");
    await deposit(log, project, "investor2", "12000");
    await deposit(log, project, "investor3", "8000", true);
    for (const inv of ["investor1", "investor2"] as const) log.info(`${inv} shares: ${await getShareBalance(w[inv].classicAddress, setup.shareMptIssuanceId)}`);

    log.say(
      "2c. Close: LoanSet to the SPV + one escrow per milestone (conditions from the release service)",
      "The Lending Protocol lent to a project account no single party controls. It locked every milestone into its own escrow. Two futures: this builder, or back.",
    );
    const conditions = rs.conditionsFor(project);
    rs.save();
    log.info(`release-service stand-in: 3 fresh preimages -> ${repoRel(rs.path)} (never printed); only conditions go on-ledger`);
    const subRipple = isoTimeToRippleTime(setup.subscriptionEndsAt);
    await waitForLedgerTimeAfter(subRipple, tick("SubscriptionDate"));
    process.stdout.write("\n");
    const now = await ledgerTime();
    const close = await closeProject(log, project, {
      conditions,
      // CancelAfter must be before loan maturity (XRPL-06): M1/M2 one interval before it, M3 stalls after M3_CANCEL_S.
      cancelAfters: [iso(now + (PAYMENT_TOTAL - 1) * PAYMENT_INTERVAL_S), iso(now + (PAYMENT_TOTAL - 1) * PAYMENT_INTERVAL_S), iso(now + M3_CANCEL_S)],
      paymentTotal: PAYMENT_TOTAL,
      paymentIntervalS: PAYMENT_INTERVAL_S,
    });
    const [e1, e2, e3] = close.escrows as [(typeof close.escrows)[0], (typeof close.escrows)[0], (typeof close.escrows)[0]];
    printSnapshot(log, "after close", await snapshot(project));

    log.say(
      "3. Money shot: milestone 1 test suite passes -> release",
      "Every milestone has a test suite. The inspector audited the site and signed her report. The AI runs the checks over her audit and the builder's evidence. All green, so the escrow releases.",
    );
    await attestAudit(log, project, m1.id, w.inspector1, auditFixture("foundation.json", m1.id, w.inspector1.classicAddress));
    const checks = ["required_evidence_present", "gps_within_site", "photo_fresh", "no_duplicate_photo", "invoice_matches_budget", "inspector_audit_present", "audit_checklist_complete", "stage_visually_consistent"];
    await attestVerdict(log, project, m1.id, { milestoneId: m1.id, decision: "pass", confidence: 0.93, model: "mock", checks });
    const builderBefore = await rlusdBalance(w.builder.classicAddress, issuer);
    await releaseWithSuite(log, project, e1, rs, { passed: checks });
    log.info(`builder RLUSD ${builderBefore} -> ${await rlusdBalance(w.builder.classicAddress, issuer)}`);

    log.say(
      "4. Fraud held: milestone 2 reuses a photo from another project",
      "Reused framing photo from another job. One red check, the suite fails, the money stays locked.",
    );
    await attestAudit(log, project, m2.id, w.inspector1, auditFixture("framing.json", m2.id, w.inspector1.classicAddress), "partial"); // sheathing marked partial
    await attestVerdict(log, project, m2.id, {
      milestoneId: m2.id,
      decision: "fail",
      confidence: 0.97,
      model: "mock",
      failing: ["no_duplicate_photo"],
      reason: "no_duplicate_photo: matches Oak Ave project photo, distance 3/64",
    });
    log.info(`M2 escrow seq ${e2.offerSequence} still on-ledger: ${(await escrowStillOpen(e2)) ? "yes, locked" : "NO?!"}`);

    log.say("5. Ledger says no: the platform tries to release M2 anyway", "Here's us trying to release it anyway. The ledger refuses.");
    await tryWrongFulfillment(log, e2);
    log.info(`M2 escrow still on-ledger: ${(await escrowStillOpen(e2)) ? "yes" : "NO?!"}`);

    log.say(
      `6. Stall: milestone 3 CancelAfter (${e3.cancelAfter}) passes -> EscrowCancel -> refund LoanPay`,
      "If a project stalls, the escrow expires, the money can only go back to the project account, which repays the vault.",
    );
    // after XRPL-07 merge: cancelExpiredMilestone keeps this shape.
    const can = await cancelExpiredMilestone({ projectId, milestoneId: m3.id, escrow: e3.escrow, cancelAfter: e3.cancelAfter, wait: true, amount: m3.amount, onWait: tick("CancelAfter") });
    process.stdout.write("\n");
    log.rec(`EscrowCancel m3 ${m3.amount} -> SPV`, can.tx);
    const before = await snapshot(project);
    printSnapshot(log, "before refund", before);
    const periodic = Number(before.loan?.periodicPayment ?? "0");
    if (Number(before.spvRlusd) + 1e-6 < periodic) {
      log.note(`refund ${before.spvRlusd} < periodic payment ${periodic}: an overpayment LoanPay would fail tecINSUFFICIENT_PAYMENT; skipping (raise DEMO_PAYMENT_TOTAL)`);
    } else {
      await spvLoanPay(log, project, { amount: before.spvRlusd, mode: "overpayment", label: "escrow refund" });
    }

    log.say("7. Snapshots", "Share value rises as interest is repaid; repayments turn principal back into withdrawable liquidity.");
    const after = await snapshot(project);
    printSnapshot(log, "final", after);
    log.note(`refund LoanPay: principalOutstanding ${before.loan?.principalOutstanding} -> ${after.loan?.principalOutstanding}, vault assetsAvailable ${before.vault?.assetsAvailable} -> ${after.vault?.assetsAvailable}`);

    if (DO_WITHDRAW) {
      log.say(`8. Wait for RedemptionDate (${setup.redemptionAt}), investor1 VaultWithdraw`);
      await waitForLedgerTimeAfter(isoTimeToRippleTime(setup.redemptionAt) - 1, tick("RedemptionDate"));
      process.stdout.write("\n");
      const amt = Math.min(1000, Math.floor(Number(after.vault?.assetsAvailable ?? 0))).toString();
      // after XRPL-07 merge: withdrawFromVault throws TooSoonError before RedemptionDate.
      const wd = await withdrawFromVault({ projectId, vaultId: setup.vaultId, investor: "investor1", amount: amt });
      log.rec(`VaultWithdraw investor1 ${amt}`, wd.tx);
    } else {
      log.note(`VaultWithdraw skipped: closed-ended vault reopens at RedemptionDate ${setup.redemptionAt}. DEMO_WITHDRAW=1 waits for it; prestage Project C is already withdrawable.`);
    }

    log.say("SUMMARY");
    console.log(log.table(`pnpm demo — ${projectId} (${startedAt})`));
    for (const n of log.notes) console.log(`NOTE: ${n}`);
    const out = dataPath(`demo-run-${projectId}.json`);
    writeJsonAtomic(out, {
      startedAt,
      finishedAt: new Date().toISOString(),
      project,
      setup: { ...setup, spvWallet: undefined, txs: undefined },
      loanId: close.loanId,
      escrows: close.escrows,
      rows: log.rows,
      notes: log.notes,
    });
    console.log(`\nrun record: ${repoRel(out)}  (wallets: ${repoRel(config.walletsFile)})`);
  } catch (e) {
    console.error("\nDEMO FAILED:", e);
    if (log.rows.length) {
      console.error("txs so far:");
      log.rows.forEach((r) => console.error(`  ${r.step}: ${r.result} ${r.url}`));
    }
    process.exitCode = 1;
  } finally {
    await disconnect();
  }
}

/** The verifier's Maple St audit fixture (VER-01), re-pointed at this run's milestone + inspector. Inline fallback. */
function auditFixture(file: string, milestoneId: string, inspector: string): unknown {
  const p = join(REPO_ROOT, "packages/verifier/fixtures/evidence/maple-st/audits", file);
  const base = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>) : { checklist: [{ sovCode: "F-01", status: "done" }] };
  return { ...base, milestoneId, inspector };
}
