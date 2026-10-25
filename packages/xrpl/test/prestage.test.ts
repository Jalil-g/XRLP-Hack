import assert from "node:assert/strict";
import { test } from "node:test";
import { validateVaultDates } from "../src/lending-math.ts";
import { FINISH_LLS_MARGIN } from "../src/escrow.ts";
import { DEFAULT_MARGIN_S, releaseMarginS } from "../src/preflight.ts";
import {
  parsePrestageFile,
  PRESTAGE_C_FINISH_LLS_MARGIN,
  PRESTAGE_C_MIN_SLACK_S,
  PRESTAGE_VERSION,
  prestageCCancelAfterS,
  prestageCReleaseSlackS,
  prestageVaultDates,
  type PrestageFile,
  type PrestageProject,
} from "../src/prestage-types.ts";

const project = (key: "A" | "B" | "C"): PrestageProject => ({
  key,
  scenario: key === "A" ? "ready" : key === "B" ? "stalled" : "repaid",
  projectId: `ps-x-${key.toLowerCase()}`,
  name: "Maple St duplex",
  type: "residential_new",
  siteAddress: "48 Maple St",
  siteGeo: { lat: 41.5, lng: -73.97, radiusM: 150 },
  status: "escrowed",
  builder: "rBuilder",
  assignedInspector: "rInspector",
  terms: { principal: "30000", interestRateBps: 1000, paymentTotal: 6, paymentIntervalS: 2_592_000, originationFee: "450" },
  milestones: [{ id: "m1", index: 0, templateKey: "foundation", title: "Foundation", amount: "9000", status: "pending" }],
  chain: { spv: "rSpv", vaultId: "V", vaultPseudoAccount: "rV", shareMptIssuanceId: "S", loanBrokerId: "B", loanId: "L", domainId: "D" },
  spv: { address: "rSpv", signers: { platform: "rP", builder: "rB", inspector: "rI", trustee: "rT" }, quorum: 3 },
  cover: { amount: "3300", minimum: "3000", txHash: "H" },
  verificationFee: { amount: "250", txHash: "F" },
  investments: [],
  escrows: [
    { milestoneId: "m1", index: 0, owner: "rSpv", offerSequence: 7, condition: "A025", cancelAfter: "2026-11-24T00:00:00.000Z", amount: "9000", destination: "rB", createTx: "E", state: "open" },
  ],
  dates: { subscriptionDate: "2026-10-25T00:00:00.000Z", redemptionDate: "2027-05-01T00:00:00.000Z", loanSetAt: "2026-10-25T00:01:00.000Z", nextPaymentDueDate: "" },
  snapshot: { spvRlusd: "0" },
  txs: [],
});

const file = (): PrestageFile => ({
  version: PRESTAGE_VERSION,
  network: "devnet",
  createdAt: "2026-10-25T00:00:00.000Z",
  finishedAt: "2026-10-25T00:10:00.000Z",
  rlusd: { currency: "524C555344000000000000000000000000000000", issuer: "rIssuer" },
  domainId: "D",
  accounts: { platform: "rP" },
  preimagesFile: ".data/prestage-preimages.json",
  projects: { A: project("A"), B: project("B"), C: project("C") },
});

test("parsePrestageFile accepts a well-formed file (round-trip through JSON)", () => {
  const f = parsePrestageFile(JSON.parse(JSON.stringify(file())));
  assert.equal(f.projects.A?.escrows[0]?.offerSequence, 7);
  assert.deepEqual(Object.keys(f.projects), ["A", "B", "C"]);
});

test("parsePrestageFile rejects secrets, wrong versions and malformed projects", () => {
  const withSecret = file() as unknown as { projects: { A: { escrows: Record<string, unknown>[] } } };
  withSecret.projects.A.escrows[0]!.preimage = "00".repeat(32);
  assert.throws(() => parsePrestageFile(withSecret), /secret-looking/);
  const withSeed = { ...file(), accounts: { platform: { seed: "sEd..." } } };
  assert.throws(() => parsePrestageFile(withSeed), /secret-looking/);
  assert.throws(() => parsePrestageFile({ ...file(), version: 2 }), /unsupported version/);
  assert.throws(() => parsePrestageFile({ ...file(), projects: { D: project("A") } }), /unknown project key D/);
  assert.throws(() => parsePrestageFile({ ...file(), projects: { A: project("B") } }), /has key B/);
  const badEscrow = file();
  (badEscrow.projects.A!.escrows[0] as unknown as Record<string, unknown>).offerSequence = "7";
  assert.throws(() => parsePrestageFile(badEscrow), /malformed escrow/);
});

test("prestageVaultDates: LoanSet anywhere in the close window still fits the schedule before RedemptionDate", () => {
  for (const [paymentTotal, paymentIntervalS, closeWindowS] of [
    [1, 240, 240],
    [6, 2_592_000, 86_400],
    [12, 2_592_000, 86_400],
    [4, 300, 120],
  ] as const) {
    const sub = 815_000_000;
    const d = prestageVaultDates({ subscriptionDate: sub, paymentTotal, paymentIntervalS, closeWindowS });
    // XLS-66: LoanSet at t needs t + interval x total + 60 <= RedemptionDate; worst case t = loanSetDeadline.
    assert.ok(d.loanSetDeadline + paymentInterval(paymentTotal, paymentIntervalS) + 60 <= d.redemptionDate);
    // And createVault's own validation (>= 180s investment period, schedule + 60 + 60s window) passes.
    assert.doesNotThrow(() => validateVaultDates({ subscriptionDate: sub, redemptionDate: d.redemptionDate, paymentTotal, paymentIntervalS }));
  }
});

test("prestageVaultDates: Project C defaults stay short (~9 min after SubscriptionDate)", () => {
  const d = prestageVaultDates({ subscriptionDate: 0, paymentTotal: 1, paymentIntervalS: 240, closeWindowS: 240 });
  assert.equal(d.redemptionDate, 540);
  assert.throws(() => prestageVaultDates({ subscriptionDate: 0, paymentTotal: 0, paymentIntervalS: 240, closeWindowS: 240 }), />= 1/);
});

const paymentInterval = (total: number, interval: number) => total * interval;

test("releaseMarginS: preflight's release margin per LastLedgerSequence margin", () => {
  assert.equal(releaseMarginS(), DEFAULT_MARGIN_S); // 20 ledgers x 5 s = 100 < 120
  assert.equal(releaseMarginS(FINISH_LLS_MARGIN), 300); // releaseMilestone's default: 60 ledgers x 5 s
  assert.equal(releaseMarginS(PRESTAGE_C_FINISH_LLS_MARGIN), 120);
  assert.equal(releaseMarginS(10, 30), 50);
});

test("Project C: finishes keep >= PRESTAGE_C_MIN_SLACK_S before the release margin (devnet 2026-10-25 regression)", () => {
  const intervalS = 240; // PRESTAGE_C_INTERVAL_S default
  const cancelAfterS = prestageCCancelAfterS(intervalS);
  assert.equal(cancelAfterS, 360);
  assert.ok(cancelAfterS < 2 * intervalS, "CancelAfter must be before maturity (2 intervals)");
  const slack = prestageCReleaseSlackS({ intervalS, releaseMarginS: releaseMarginS(PRESTAGE_C_FINISH_LLS_MARGIN) });
  assert.equal(slack, 240);
  assert.ok(slack >= PRESTAGE_C_MIN_SLACK_S);
  // The old schedule: C finished with the default 60-ledger margin (300 s) -> 60 s of slack; a one-minute devnet stall
  // after LoanSet left "only 280s to CancelAfter (< 300s margin)" and failed the whole prestage. Prestage now refuses it.
  assert.ok(prestageCReleaseSlackS({ intervalS, releaseMarginS: releaseMarginS(FINISH_LLS_MARGIN) }) < PRESTAGE_C_MIN_SLACK_S);
  // A shorter interval that can't hold the slack is refused up front.
  assert.ok(prestageCReleaseSlackS({ intervalS: 180, releaseMarginS: releaseMarginS(PRESTAGE_C_FINISH_LLS_MARGIN) }) < PRESTAGE_C_MIN_SLACK_S);
});
