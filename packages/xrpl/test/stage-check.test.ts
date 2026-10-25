import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { isoTimeToRippleTime, rippleTimeToISOTime, rippleTimeToUnixTime } from "xrpl";
import { conditionFromPreimage, fulfillmentFromPreimage } from "../src/condition.ts";
import { LSF_LOAN_OVERPAYMENT, type LoanEntry } from "../src/loan.ts";
import { PRESTAGE_VERSION, type PrestageEscrow, type PrestageEscrowState, type PrestageFile, type PrestageKey, type PrestageProject } from "../src/prestage-types.ts";
import type { EscrowNode, VaultNode } from "../src/reads.ts";
import {
  amendmentId,
  evaluateStage,
  fmtDuration,
  lockTermsCover,
  mergeFixes,
  RELEASE_MARGIN_S,
  renderFix,
  renderStageReport,
  REQUIRED_AMENDMENTS,
  STAGE_BEATS,
  summarizePreimages,
  walletAddresses,
  type StageBeat,
  type StageNow,
  type StageOptions,
  type StageReport,
  type StageRole,
  type StageSnapshot,
} from "../src/stage-check.ts";
import { WALLET_ROLES, type WalletRole } from "../src/wallets.ts";

// ------------------------------------------------------------------ fixture: a stage that is GO everywhere

const T = 815_000_000; // validated ledger close time (Ripple epoch)
const DAY = 86_400;
const iso = (t: number) => rippleTimeToISOTime(t);
const RLUSD_HEX = "524C555344000000000000000000000000000000";
const ADDR = Object.fromEntries(WALLET_ROLES.map((r) => [r, `r${r[0]!.toUpperCase()}${r.slice(1)}Test`])) as Record<WalletRole, string>;
const SEED = (r: WalletRole) => `sEdTESTSEED${r}0123456789`;
const rl = (value: string) => ({ currency: RLUSD_HEX, issuer: ADDR.issuer, value });

interface Fixture {
  snap: StageSnapshot;
  now: StageNow;
  file: PrestageFile;
  /** Secrets that must never show up in a report. */
  preimages: string[];
  fulfillments: string[];
  seeds: string[];
  walletJson: unknown;
  preimagesJson: { projects: Record<string, Record<string, { condition: string; preimage: string; createdAt: string }>> };
}

const AMOUNTS = ["9000", "12000", "9000"];

function fixture(): Fixture {
  const preimagesJson: Fixture["preimagesJson"] = { projects: {} };
  const preimages: string[] = [];
  const fulfillments: string[] = [];
  const nodes: Partial<Record<PrestageKey, (EscrowNode | null)[]>> = {};

  const project = (
    key: PrestageKey,
    o: {
      escrows: { cancelAfter: number; state: PrestageEscrowState }[];
      terms: PrestageProject["terms"];
      amounts?: string[];
    },
  ): PrestageProject => {
    const projectId = `ps-test-${key.toLowerCase()}`;
    const spv = `rSpv${key}Test`;
    const amounts = o.amounts ?? AMOUNTS;
    const escrows: PrestageEscrow[] = o.escrows.map((e, i) => {
      const milestoneId = `${projectId}-m${i + 1}`;
      const pre = randomBytes(32);
      const condition = conditionFromPreimage(pre);
      preimages.push(pre.toString("hex"));
      fulfillments.push(fulfillmentFromPreimage(pre));
      (preimagesJson.projects[projectId] ??= {})[milestoneId] = { condition, preimage: pre.toString("hex"), createdAt: iso(T - 900) };
      const offerSequence = 6_395_000 + (key === "A" ? 0 : key === "B" ? 10 : 20) + i;
      return { milestoneId, index: i, owner: spv, offerSequence, condition, cancelAfter: iso(e.cancelAfter), amount: amounts[i]!, destination: ADDR.builder, createTx: "E".repeat(64), createdAt: iso(T - 900), state: e.state };
    });
    nodes[key] = escrows.map((e) =>
      e.state === "finished" || e.state === "cancelled"
        ? null
        : { index: `ESC${e.offerSequence}`, Account: e.owner, Destination: e.destination, Amount: rl(e.amount), Condition: e.condition, CancelAfter: isoTimeToRippleTime(e.cancelAfter), Sequence: e.offerSequence },
    );
    return {
      key,
      scenario: key === "A" ? "ready" : key === "B" ? "stalled" : "repaid",
      projectId,
      name: `Project ${key}`,
      type: "residential_new",
      siteAddress: "48 Maple St",
      siteGeo: { lat: 41.5, lng: -73.97, radiusM: 150 },
      status: key === "C" ? "completed" : "escrowed",
      builder: ADDR.builder,
      assignedInspector: ADDR.inspector1,
      terms: o.terms,
      milestones: escrows.map((e, i) => ({ id: e.milestoneId, index: i, templateKey: "foundation", title: `M${i + 1}`, amount: e.amount, status: e.state === "finished" ? "released" : "pending" })),
      chain: { spv, vaultId: `VAULT${key}`.padEnd(64, "0"), vaultPseudoAccount: `rVault${key}`, shareMptIssuanceId: `SHARES${key}`, loanBrokerId: `BROKER${key}`, loanId: `LOAN${key}`.padEnd(64, "0"), domainId: "D".repeat(64) },
      spv: { address: spv, signers: { platform: ADDR.platform, builder: ADDR.builder, inspector: ADDR.inspector1, trustee: ADDR.trustee }, quorum: 3 },
      cover: { amount: "3395.579039", minimum: "3086.890035", txHash: "C".repeat(64) },
      verificationFee: { amount: "250", txHash: "F".repeat(64) },
      investments: [
        { role: "investor1", investor: ADDR.investor1, amount: String(Number(o.terms.principal) * 0.6), txHash: "1".repeat(64) },
        { role: "investor2", investor: ADDR.investor2, amount: String(Number(o.terms.principal) * 0.4), txHash: "2".repeat(64) },
      ],
      escrows,
      dates: { subscriptionDate: iso(T - 3_600), redemptionDate: iso(T + 182 * DAY), loanSetAt: iso(T - 3_000), nextPaymentDueDate: iso(T + 29 * DAY) },
      snapshot: { spvRlusd: "0" },
      txs: [],
    };
  };

  const A = project("A", {
    escrows: [29.9, 59.9, 89.9].map((d) => ({ cancelAfter: T + Math.round(d * DAY), state: "open" as const })),
    terms: { principal: "30000", interestRateBps: 1000, paymentTotal: 6, paymentIntervalS: 30 * DAY, originationFee: "450" },
  });
  const B = project("B", {
    escrows: [
      { cancelAfter: T + 29 * DAY, state: "finished" },
      { cancelAfter: T - 600, state: "expired" },
      { cancelAfter: T + 59 * DAY, state: "open" },
    ],
    terms: { principal: "30000", interestRateBps: 1000, paymentTotal: 12, paymentIntervalS: 30 * DAY, originationFee: "450" },
  });
  const C = project("C", {
    escrows: [0, 1, 2].map(() => ({ cancelAfter: T - 300, state: "finished" as const })),
    terms: { principal: "12000", interestRateBps: 1000, paymentTotal: 2, paymentIntervalS: 240, originationFee: "180" },
    amounts: ["3000", "5000", "4000"],
  });
  const file: PrestageFile = {
    version: PRESTAGE_VERSION,
    network: "devnet",
    createdAt: iso(T - 1_200),
    finishedAt: iso(T - 300),
    rlusd: { currency: RLUSD_HEX, issuer: ADDR.issuer },
    domainId: "D".repeat(64),
    accounts: { ...ADDR },
    preimagesFile: ".data/prestage-preimages.json",
    projects: { A, B, C },
  };

  const vault = (key: PrestageKey, sub: number, red: number, total: string, available: string): VaultNode => ({
    index: `VAULT${key}`,
    Owner: ADDR.platform,
    Account: `rVault${key}`,
    Asset: { currency: RLUSD_HEX, issuer: ADDR.issuer },
    AssetsTotal: total,
    AssetsAvailable: available,
    ShareMPTID: `SHARES${key}`,
    VaultKind: 1,
    SubscriptionDate: sub,
    RedemptionDate: red,
  });
  const loan = (key: PrestageKey, o: Partial<LoanEntry>): LoanEntry => ({ index: `LOAN${key}`, Borrower: `rSpv${key}Test`, LoanBrokerID: `BROKER${key}`, Flags: LSF_LOAN_OVERPAYMENT, GracePeriod: 60, ...o });
  const spvAccount = { balance: "97000000", ownerCount: 6, flags: 0 };

  const walletJson = { network: "devnet", createdAt: iso(T - DAY), wallets: Object.fromEntries(WALLET_ROLES.map((r) => [r, { address: ADDR[r], seed: SEED(r) }])), spvs: {} };
  const w = walletAddresses(walletJson);
  const roles: Partial<Record<WalletRole, StageRole>> = {};
  for (const role of WALLET_ROLES) {
    roles[role] = { address: w.roles[role]!, account: { balance: "99000000", ownerCount: 5, flags: role === "issuer" ? 0x00800000 | 0x40000000 : 0 } };
  }
  const line = (balance: string) => ({ balance, limit: "1000000000" });
  roles.platform!.rlusdLine = line("18635.474143");
  roles.builder!.rlusdLine = line("9800");
  for (const r of ["investor1", "investor2", "investor3"] as const) roles[r]!.rlusdLine = line("1000");
  roles.builder!.credentials = { VERIFIED_BUILDER: "accepted" };
  roles.investor1!.credentials = { KYC_INVESTOR: "accepted" };
  roles.investor2!.credentials = { KYC_INVESTOR: "accepted" };
  roles.investor3!.credentials = { KYC_INVESTOR: "none" };
  for (const r of ["inspector1", "inspector2", "inspector3"] as const) roles[r]!.credentials = { VERIFIED_INSPECTOR: "accepted" };

  const wanted = (["A", "B"] as const).map((k) => ({ projectId: file.projects[k]!.projectId, milestoneIds: file.projects[k]!.escrows.map((e) => e.milestoneId) }));
  const snap: StageSnapshot = {
    files: { wallets: ".data/wallets.test.json", prestage: ".data/prestage.json", preimages: ".data/prestage-preimages.json" },
    config: { network: "devnet", wsUrl: "wss://s.devnet.rippletest.net:51233", faucetHost: "faucet.devnet.rippletest.net", commandEnv: "" },
    devnet: {
      reachable: true,
      networkId: 2,
      buildVersion: "3.4.1",
      serverState: "full",
      validatedAgeS: 2,
      reserveBaseXrp: 1,
      reserveIncXrp: 0.2,
      amendments: Object.fromEntries([...REQUIRED_AMENDMENTS, "fixCleanup3_4_0"].map((a) => [a, true])),
    },
    faucet: { ok: true, status: 404, ms: 380 },
    wallets: { exists: true, network: "devnet", roles, missingRoles: [] },
    prestage: { exists: true, file },
    preimages: { exists: true, mode: 0o600, entries: summarizePreimages(preimagesJson, wanted) },
    ledger: {
      baseFeeDrops: 10,
      projects: {
        A: {
          vault: vault("A", T - 3_600, T + 182 * DAY, "30000", "0"),
          loan: loan("A", { PrincipalOutstanding: "30000", TotalValueOutstanding: "30775.917", PeriodicPayment: "5129.319524", PaymentRemaining: 6, NextPaymentDueDate: T + 29 * DAY }),
          escrows: nodes.A!,
          spvAccount,
          spvRlusd: "0",
          shares: { investor1: "18000000000", investor2: "12000000000" },
        },
        B: {
          vault: vault("B", T - 3_600, T + 365 * DAY, "30000", "0"),
          loan: loan("B", { PrincipalOutstanding: "30000", TotalValueOutstanding: "31626.788", PeriodicPayment: "2635.565667", PaymentRemaining: 12, NextPaymentDueDate: T + 29 * DAY }),
          escrows: nodes.B!,
          spvAccount,
          spvRlusd: "0",
          shares: { investor1: "18000000000", investor2: "12000000000" },
        },
        C: {
          vault: vault("C", T - 900, T - 240, "12000.012328", "12000.012328"),
          loan: loan("C", { PrincipalOutstanding: "0", TotalValueOutstanding: "0", PeriodicPayment: "6000.00685", PaymentRemaining: 0 }),
          escrows: nodes.C!,
          spvAccount,
          spvRlusd: "1.00630136037",
          shares: { investor1: "7200000000", investor2: "4800000000" },
        },
      },
    },
  };
  return {
    snap,
    now: { ledger: { ledgerIndex: 6_395_587, closeTime: T }, wallMs: rippleTimeToUnixTime(T) },
    file,
    preimages,
    fulfillments,
    seeds: WALLET_ROLES.map(SEED),
    walletJson,
    preimagesJson,
  };
}

const run = (mut?: (f: Fixture) => void, opts?: StageOptions): StageReport => {
  const f = fixture();
  mut?.(f);
  return evaluateStage(f.snap, f.now, opts);
};
const beatOf = (r: StageReport, b: StageBeat) => r.beats.find((x) => x.beat === b)!;
const checkOf = (r: StageReport, id: string) => r.checks.find((c) => c.id === id);
const dev = (f: Fixture) => {
  if (!f.snap.devnet.reachable) throw new Error("fixture devnet unreachable");
  return f.snap.devnet;
};
const led = (f: Fixture, k: PrestageKey) => f.snap.ledger!.projects[k]!;
const role = (f: Fixture, r: WalletRole) => f.snap.wallets.roles[r]!;
const ALL = [...STAGE_BEATS];

// ------------------------------------------------------------------ GO baseline

test("baseline: a freshly pre-staged devnet is GO on every beat, exit 0", () => {
  const r = run();
  assert.equal(r.status, "GO", JSON.stringify(r.checks.filter((c) => c.status !== "GO"), null, 2));
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.beats.map((b) => [b.beat, b.status]),
    ALL.map((b) => [b, "GO"]),
  );
  assert.deepEqual(r.fixes, []);
  assert.deepEqual(r.suggestions, []);
  assert.equal(r.ledger?.index, 6_395_587);
  assert.equal(r.prestage?.ageMin, 5);
  // GO details say what was verified.
  assert.match(beatOf(r, "D3").details.join(" | "), /A m1 seq 6395000: release preflight ok \(29\.9 d to CancelAfter, needs ≥ 300 s\)/);
  assert.match(beatOf(r, "D3").details.join(" | "), /preimage matches the on-ledger Condition/);
  assert.match(beatOf(r, "D6").details.join(" | "), /refund 12000 ≥ one periodic payment 2635\.565667 \(LoanPay overpayment\)/);
  assert.match(beatOf(r, "withdraw").details.join(" | "), /investor1 7200 shares, investor2 4800 shares/);
  assert.match(beatOf(r, "D2").details[0]!, /^A vault in Investment/);
  assert.equal(RELEASE_MARGIN_S, 300);
});

test("time gates use the ledger close time, not the wall clock (a skewed clock only ages prestage.json)", () => {
  const r = run((f) => (f.now.wallMs += 365 * DAY * 1000));
  assert.equal(r.ok, true);
  assert.equal(checkOf(r, "prestage.age")?.status, "WARN");
  assert.ok(r.beats.every((b) => b.status === "GO"));
});

// ------------------------------------------------------------------ one fixture per NO-GO reason

interface NoGoCase {
  name: string;
  mut: (f: Fixture) => void;
  /** Beats that must be NO-GO. */
  beats: StageBeat[];
  /** The check that says why. */
  id: string;
  msg?: RegExp;
  fix?: RegExp;
}

const NO_GO: NoGoCase[] = [
  // devnet
  {
    name: "devnet unreachable",
    mut: (f) => {
      f.snap.devnet = { reachable: false, error: "connect ECONNREFUSED" };
      delete f.snap.ledger;
      delete f.now.ledger;
    },
    beats: ALL,
    id: "devnet.reachable",
    msg: /ECONNREFUSED/,
    fix: /XRPL_WS_URL/,
  },
  { name: "not devnet (network_id 1)", mut: (f) => (dev(f).networkId = 1), beats: ALL, id: "devnet.network", msg: /network_id 1, expected 2/ },
  { name: "an amendment is off", mut: (f) => (dev(f).amendments.LendingProtocolV1_1 = false), beats: ALL, id: "devnet.amendments", msg: /LendingProtocolV1_1/ },
  { name: "an amendment is unknown to the server", mut: (f) => delete dev(f).amendments.BatchV1_1, beats: ALL, id: "devnet.amendments", msg: /BatchV1_1/ },
  { name: "devnet stopped closing ledgers", mut: (f) => (dev(f).validatedAgeS = 600), beats: ALL, id: "devnet.ledger_age", msg: /600 s old/ },
  { name: "the pinned reads failed", mut: (f) => (f.snap.ledger!.error = "socket hang up"), beats: ALL, id: "devnet.reads", msg: /socket hang up/ },
  // wallet file
  { name: "no wallet file", mut: (f) => (f.snap.wallets = { exists: false, roles: {}, missingRoles: [...WALLET_ROLES] }), beats: ALL, id: "wallets.file", fix: /^pnpm --filter @xrlp\/xrpl bootstrap$/ },
  { name: "unreadable wallet file", mut: (f) => (f.snap.wallets = { exists: true, error: "not valid JSON", roles: {}, missingRoles: [...WALLET_ROLES] }), beats: ALL, id: "wallets.file", fix: /restore/ },
  {
    name: "a role is missing",
    mut: (f) => {
      delete f.snap.wallets.roles.trustee;
      f.snap.wallets.missingRoles = ["trustee"];
    },
    beats: ALL,
    id: "wallets.file",
    msg: /lacks trustee/,
    fix: /bootstrap/,
  },
  { name: "releaseService unfunded", mut: (f) => (role(f, "releaseService").account = null), beats: ["D3", "D6"], id: "wallets.releaseService.xrp", fix: /bootstrap/ },
  { name: "platform XRP below reserve + fees", mut: (f) => (role(f, "platform").account = { balance: "6000000", ownerCount: 20, flags: 0 }), beats: ["D1", "D2", "D5"], id: "wallets.platform.xrp", msg: /can spend 1\.00 XRP/ },
  { name: "issuer gone (devnet reset)", mut: (f) => (role(f, "issuer").account = null), beats: ALL, id: "wallets.issuer.xrp" },
  // credentials + RLUSD
  { name: "investor1 KYC pending", mut: (f) => (role(f, "investor1").credentials = { KYC_INVESTOR: "pending" }), beats: ["D2"], id: "wallets.investor1.kyc", fix: /bootstrap/ },
  { name: "investor2 has no KYC", mut: (f) => (role(f, "investor2").credentials = { KYC_INVESTOR: "none" }), beats: ["D2"], id: "wallets.investor2.kyc" },
  { name: "investor3 holds KYC", mut: (f) => (role(f, "investor3").credentials = { KYC_INVESTOR: "accepted" }), beats: ["D2"], id: "wallets.investor3.no_kyc", msg: /tecNO_AUTH/, fix: /bootstrap/ },
  { name: "assigned inspector not verified", mut: (f) => (role(f, "inspector1").credentials = { VERIFIED_INSPECTOR: "none" }), beats: ["D3", "D4"], id: "wallets.inspector1.verified" },
  { name: "builder lacks VERIFIED_BUILDER", mut: (f) => (role(f, "builder").credentials = { VERIFIED_BUILDER: "none" }), beats: ["D1"], id: "wallets.builder.verified", fix: /bootstrap --pre-verify-builder$/ },
  { name: "builder RLUSD below the fee", mut: (f) => (role(f, "builder").rlusdLine = { balance: "100", limit: "1000000000" }), beats: ["D1"], id: "wallets.builder.rlusd", msg: /100 RLUSD < the 250/ },
  {
    name: "platform RLUSD below a live lock-terms cover",
    mut: (f) => (role(f, "platform").rlusdLine = { balance: "3000", limit: "1000000000" }),
    beats: ["D2"],
    id: "wallets.platform.rlusd",
    msg: /3000 RLUSD < 3395\.579039/,
    fix: /bootstrap/,
  },
  // prestage.json
  { name: "no prestage.json", mut: (f) => (f.snap.prestage = { exists: false }), beats: ALL, id: "prestage.file", fix: /^pnpm --filter @xrlp\/xrpl prestage$/ },
  { name: "invalid prestage.json", mut: (f) => (f.snap.prestage = { exists: true, error: "prestage: unsupported version 2" }), beats: ALL, id: "prestage.file", msg: /unsupported version/ },
  { name: "prestage.json staged with another wallet file", mut: (f) => (f.file.rlusd.issuer = "rSomeoneElse"), beats: ALL, id: "prestage.file", msg: /another RLUSD issuer/ },
  { name: "prestage.json staged with other accounts", mut: (f) => (f.file.accounts.builder = "rOtherBuilder"), beats: ALL, id: "prestage.file", msg: /other accounts for builder/ },
  { name: "Project B missing", mut: (f) => delete f.file.projects.B, beats: ["D6"], id: "prestage.B", fix: /prestage --only B$/ },
  { name: "Project C missing", mut: (f) => delete f.file.projects.C, beats: ["withdraw"], id: "prestage.C", fix: /prestage --only C$/ },
  // Project A
  { name: "A vault gone", mut: (f) => (led(f, "A").vault = null), beats: ["D2", "D3", "D4", "D5"], id: "A.vault", fix: /prestage --only A$/ },
  { name: "A vault past RedemptionDate", mut: (f) => (led(f, "A").vault!.RedemptionDate = T - 1), beats: ["D2"], id: "A.vault", msg: /past RedemptionDate/ },
  { name: "A loan repaid", mut: (f) => (led(f, "A").loan!.PaymentRemaining = 0), beats: ["D2"], id: "A.loan" },
  { name: "A loan gone", mut: (f) => (led(f, "A").loan = null), beats: ["D2", "D3", "D4", "D5"], id: "A.loan" },
  { name: "A m1 consumed in a rehearsal: 2/3 open", mut: (f) => (led(f, "A").escrows[0] = null), beats: ["D2", "D3"], id: "A.escrows", msg: /2\/3 escrows open \(A m1 gone/, fix: /prestage --only A$/ },
  { name: "A m1 consumed: the release preflight refuses", mut: (f) => (led(f, "A").escrows[0] = null), beats: ["D3"], id: "A.m1.release", msg: /escrow_not_found/ },
  { name: "A m1 inside the release margin", mut: (f) => (led(f, "A").escrows[0]!.CancelAfter = T + 200), beats: ["D3"], id: "A.m1.release", msg: /expired_or_too_close/ },
  { name: "A m1 condition differs from prestage.json", mut: (f) => (led(f, "A").escrows[0]!.Condition = conditionFromPreimage(randomBytes(32))), beats: ["D3"], id: "A.m1.release", msg: /condition_mismatch/ },
  { name: "builder has no RLUSD line (preflight no_trustline)", mut: (f) => (role(f, "builder").rlusdLine = null), beats: ["D1", "D3"], id: "A.m1.release", msg: /no_trustline/, fix: /bootstrap/ },
  { name: "builder line frozen", mut: (f) => (role(f, "builder").rlusdLine = { balance: "9800", limit: "1000000000", freeze_peer: true }), beats: ["D3", "D5"], id: "A.m1.release", msg: /frozen/, fix: /trust line/ },
  { name: "A m2 consumed", mut: (f) => (led(f, "A").escrows[1] = null), beats: ["D2", "D4", "D5"], id: "A.m2.locked", msg: /gone from the ledger/ },
  { name: "A m2 consumed: nothing for the wrong finish to hit", mut: (f) => (led(f, "A").escrows[1] = null), beats: ["D5"], id: "A.m2.wrong_finish", msg: /escrow_not_found/ },
  { name: "A m2 expired", mut: (f) => (led(f, "A").escrows[1]!.CancelAfter = T - 10), beats: ["D4", "D5"], id: "A.m2.locked", msg: /expired 10 s ago/ },
  { name: "A's assigned inspector is not ours", mut: (f) => (f.file.projects.A!.assignedInspector = "rStranger"), beats: ["D3", "D4"], id: "A.inspector" },
  // preimages
  { name: "A m1 preimage missing", mut: (f) => delete f.snap.preimages.entries["ps-test-a"]!["ps-test-a-m1"], beats: ["D3"], id: "preimages.A.m1", msg: /no preimage/, fix: /prestage --only A$/ },
  {
    name: "A m1 preimage mangled",
    mut: (f) => (f.snap.preimages.entries["ps-test-a"]!["ps-test-a-m1"]!.derivedCondition = conditionFromPreimage(randomBytes(32))),
    beats: ["D3"],
    id: "preimages.A.m1",
    msg: /does not match the on-ledger escrow Condition/,
  },
  { name: "A m1 preimage malformed", mut: (f) => delete f.snap.preimages.entries["ps-test-a"]!["ps-test-a-m1"]!.derivedCondition, beats: ["D3"], id: "preimages.A.m1", msg: /malformed/ },
  { name: "A m1 stored condition differs", mut: (f) => (f.snap.preimages.entries["ps-test-a"]!["ps-test-a-m1"]!.storedCondition = "A0258020" + "0".repeat(64) + "810120"), beats: ["D3"], id: "preimages.A.m1" },
  { name: "no preimages file", mut: (f) => (f.snap.preimages = { exists: false, entries: {} }), beats: ["D3"], id: "preimages.file", fix: /prestage --only A,B$/ },
  { name: "unreadable preimages file", mut: (f) => (f.snap.preimages = { exists: true, mode: 0o600, error: "not valid JSON", entries: {} }), beats: ["D3"], id: "preimages.file", fix: /^mv \S+ \S+\.bad && pnpm --filter @xrlp\/xrpl prestage --only A,B$/ },
  // Project B
  { name: "B stall escrow already cancelled", mut: (f) => (led(f, "B").escrows[1] = null), beats: ["D6"], id: "B.stall", msg: /already gone/, fix: /prestage --only B$/ },
  { name: "B stall escrow not expired (2 h left)", mut: (f) => (led(f, "B").escrows[1]!.CancelAfter = T + 7_200), beats: ["D6"], id: "B.stall", msg: /not passed/ },
  { name: "prestage.json B has no expired escrow", mut: (f) => (f.file.projects.B!.escrows[1]!.state = "open"), beats: ["D6"], id: "B.stall" },
  { name: "B refund LoanPay would be late", mut: (f) => (led(f, "B").loan!.NextPaymentDueDate = T - 10), beats: ["D6"], id: "B.refund", msg: /tecEXPIRED/ },
  { name: "B refund below one periodic payment", mut: (f) => (led(f, "B").loan!.PeriodicPayment = "15000"), beats: ["D6"], id: "B.refund", msg: /< one periodic payment 15000/ },
  { name: "B loan gone", mut: (f) => (led(f, "B").loan = null), beats: ["D6"], id: "B.refund" },
  { name: "B SPV can't pay the LoanPay fee", mut: (f) => (led(f, "B").spvAccount = { balance: "2000000", ownerCount: 6, flags: 0 }), beats: ["D6"], id: "B.spv" },
  // Project C
  { name: "C not yet in Redemption", mut: (f) => (led(f, "C").vault!.RedemptionDate = T + 7_200), beats: ["withdraw"], id: "C.vault", msg: /in Investment until/, fix: /prestage --only C$/ },
  { name: "C vault gone", mut: (f) => (led(f, "C").vault = null), beats: ["withdraw"], id: "C.vault" },
  { name: "C has nothing withdrawable", mut: (f) => delete led(f, "C").vault!.AssetsAvailable, beats: ["withdraw"], id: "C.liquidity" },
  { name: "C investors hold no shares", mut: (f) => (led(f, "C").shares = { investor1: "0", investor2: "0" }), beats: ["withdraw"], id: "C.shares", msg: /hold no shares/ },
  { name: "C reads failed", mut: (f) => (f.snap.ledger!.projectErrors = { C: "ledger_entry VAULTC00…: malformedRequest" }), beats: ["withdraw"], id: "C.reads" },
];

for (const c of NO_GO) {
  test(`NO-GO: ${c.name}`, () => {
    const r = run(c.mut);
    assert.equal(r.ok, false, `expected NO-GO; non-GO: ${JSON.stringify(r.checks.filter((x) => x.status !== "GO"))}`);
    assert.equal(r.status, "NO-GO");
    const chk = checkOf(r, c.id);
    assert.ok(chk, `no check ${c.id}; have ${r.checks.map((x) => x.id).join(", ")}`);
    assert.equal(chk.status, "NO-GO", chk.message);
    if (c.msg) assert.match(chk.message, c.msg);
    if (c.fix) assert.match(chk.fix ?? "", c.fix);
    for (const b of c.beats) assert.equal(beatOf(r, b).status, "NO-GO", `${b} should be NO-GO`);
    for (const b of c.beats) assert.ok(beatOf(r, b).details.length, `${b} explains why`);
    // Every NO-GO gates at least one beat and comes with a fix; the merged fix list is non-empty.
    for (const x of r.checks.filter((x) => x.status === "NO-GO")) {
      assert.ok(x.beats.length, `${x.id} is NO-GO but gates no beat`);
      assert.ok(x.fix, `${x.id} is NO-GO without a fix`);
    }
    assert.ok(r.fixes.length);
    assert.match(renderStageReport(r), /VERDICT: NO-GO .* · exit 1$/);
  });
}

test("B: a consumed stall escrow is not counted twice in the refund (its money is already in the SPV)", () => {
  const cancelled = run((f) => {
    led(f, "B").escrows[1] = null;
    led(f, "B").spvRlusd = "12000";
  });
  assert.match(checkOf(cancelled, "B.refund")!.message, /^refund 12000 ≥/);
  const finished = run((f) => (led(f, "B").escrows[1] = null));
  assert.equal(checkOf(finished, "B.refund"), undefined, "nothing to refund: only B.stall speaks");
  assert.equal(checkOf(finished, "B.stall")?.status, "NO-GO");
});

test("NO-GO beats leave the unaffected beats GO (B consumed: only D6)", () => {
  const r = run((f) => (led(f, "B").escrows[1] = null));
  assert.deepEqual(
    r.beats.filter((b) => b.status !== "GO").map((b) => b.beat),
    ["D6"],
  );
  assert.deepEqual(r.fixes, [{ command: "pnpm --filter @xrlp/xrpl prestage --only B", eta: "~3-5 min" }]);
});

// ------------------------------------------------------------------ WARN (exit 0)

const WARN: { name: string; mut: (f: Fixture) => void; id: string; beat?: StageBeat; msg?: RegExp; opts?: StageOptions }[] = [
  { name: "prestage.json is old", mut: (f) => (f.file.finishedAt = iso(T - 2 * 3_600)), id: "prestage.age", msg: /2\.0 h ago/ },
  { name: "preimages file is not mode 600", mut: (f) => (f.snap.preimages.mode = 0o644), id: "preimages.mode", msg: /mode 644/ },
  { name: "faucet down", mut: (f) => (f.snap.faucet = { ok: false, error: "fetch failed" }), id: "devnet.faucet", beat: "D2" },
  { name: "another rippled build", mut: (f) => (dev(f).buildVersion = "3.5.0"), id: "devnet.rippled" },
  { name: "slow devnet", mut: (f) => (dev(f).validatedAgeS = 45), id: "devnet.ledger_age" },
  { name: "A m1 expires inside the window", mut: (f) => (led(f, "A").escrows[0]!.CancelAfter = T + 1_800), id: "A.m1.release", beat: "D3", msg: /release before/ },
  { name: "A m2 expires inside the window (D4)", mut: (f) => (led(f, "A").escrows[1]!.CancelAfter = T + 1_800), id: "A.m2.locked", beat: "D4" },
  { name: "A m2 expires inside the window (D5)", mut: (f) => (led(f, "A").escrows[1]!.CancelAfter = T + 1_800), id: "A.m2.wrong_finish", beat: "D5", msg: /expires in 30 min: run the random-fulfillment try before/ },
  { name: "A m3 CancelAfter inside the release margin + window", mut: (f) => (led(f, "A").escrows[2]!.CancelAfter = T + 1_800), id: "A.escrows", beat: "D2", msg: /A m3 CancelAfter in 30 min \(< 300 s release margin/ },
  { name: "A SPV holds liquid RLUSD", mut: (f) => (led(f, "A").spvRlusd = "9000"), id: "A.spv", beat: "D2", msg: /9000 RLUSD liquid/ },
  { name: "B stall escrow cancellable within the window", mut: (f) => (led(f, "B").escrows[1]!.CancelAfter = T + 600), id: "B.stall", beat: "D6", msg: /cancellable in 10 min/ },
  { name: "B payment due inside the window", mut: (f) => (led(f, "B").loan!.NextPaymentDueDate = T + 1_800), id: "B.refund", beat: "D6" },
  { name: "B loan without lsfLoanOverpayment", mut: (f) => (led(f, "B").loan!.Flags = 0), id: "B.refund", beat: "D6", msg: /lsfLoanOverpayment/ },
  { name: "C opens for withdrawals inside the window", mut: (f) => (led(f, "C").vault!.RedemptionDate = T + 600), id: "C.vault", beat: "withdraw" },
  { name: "one C investor already withdrew", mut: (f) => (led(f, "C").shares.investor2 = "0"), id: "C.shares", beat: "withdraw", msg: /withdraw as investor1/ },
  { name: "B m3 preimage missing (not used on stage)", mut: (f) => delete f.snap.preimages.entries["ps-test-b"]!["ps-test-b-m3"], id: "preimages.B.m3" },
  { name: "an unassigned inspector lost VERIFIED_INSPECTOR", mut: (f) => (role(f, "inspector2").credentials = { VERIFIED_INSPECTOR: "none" }), id: "wallets.inspector2.verified" },
  { name: "trustee unfunded (multisig signers need no account)", mut: (f) => (role(f, "trustee").account = null), id: "wallets.trustee.xrp", beat: "D6" },
  { name: "investor3's KYC is only pending (deposit still tecNO_AUTH)", mut: (f) => (role(f, "investor3").credentials = { KYC_INVESTOR: "pending" }), id: "wallets.investor3.no_kyc", beat: "D2" },
  { name: "a role below the bootstrap top-up line", mut: (f) => (role(f, "aiAgent").account = { balance: "20000000", ownerCount: 0, flags: 0 }), id: "wallets.aiAgent.xrp", beat: "D3" },
];

for (const c of WARN) {
  test(`WARN (still exit 0): ${c.name}`, () => {
    const r = run(c.mut, c.opts);
    assert.equal(r.ok, true, JSON.stringify(r.checks.filter((x) => x.status === "NO-GO")));
    assert.equal(r.status, "WARN");
    const chk = checkOf(r, c.id);
    assert.equal(chk?.status, "WARN", `${c.id}: ${chk?.message}`);
    if (c.msg) assert.match(chk.message, c.msg);
    if (c.beat) assert.equal(beatOf(r, c.beat).status, "WARN");
    else assert.ok(r.beats.every((b) => b.status === "GO"), "advisory warnings don't color a beat");
    assert.match(renderStageReport(r), /VERDICT: GO with \d+ warnings? .*· exit 0$/);
  });
}

test("windowS: a gate that holds for the (shorter) window is GO", () => {
  const close = (f: Fixture) => (led(f, "A").escrows[0]!.CancelAfter = T + 1_800);
  assert.equal(checkOf(run(close), "A.m1.release")?.status, "WARN");
  assert.equal(checkOf(run(close, { windowS: 600 }), "A.m1.release")?.status, "GO");
});

// ------------------------------------------------------------------ fixes

test("fixes merge into one bootstrap and one prestage (union of projects), in order", () => {
  const r = run((f) => {
    led(f, "A").escrows[0] = null; // rehearsal consumed A m1 ...
    led(f, "B").escrows[1] = null; // ... and B's stall escrow
    role(f, "builder").credentials = { VERIFIED_BUILDER: "none" };
    role(f, "platform").rlusdLine = { balance: "10", limit: "1000000000" };
  });
  assert.deepEqual(r.fixes, [
    { command: "pnpm --filter @xrlp/xrpl bootstrap --pre-verify-builder", eta: "~1 min" },
    { command: "pnpm --filter @xrlp/xrpl prestage --only A,B", eta: "~3-5 min" },
  ]);
  const text = renderStageReport(r);
  assert.match(text, /Fix before the slot, in order \(then re-run stage:check\):\n {2}1\. pnpm --filter @xrlp\/xrpl bootstrap --pre-verify-builder {3}# ~1 min\n {2}2\. pnpm --filter @xrlp\/xrpl prestage --only A,B {3}# ~3-5 min/);
});

test("fix commands carry the env that selects the same files; all three projects = plain prestage", () => {
  const r = run((f) => {
    f.snap.config.commandEnv = "WALLETS_FILE=.data/wallets.jalil.json ";
    f.snap.prestage = { exists: false };
  });
  assert.deepEqual(r.fixes, [{ command: "WALLETS_FILE=.data/wallets.jalil.json pnpm --filter @xrlp/xrpl prestage", eta: "~13 min" }]);
  assert.equal(checkOf(r, "prestage.file")?.fix, "WALLETS_FILE=.data/wallets.jalil.json pnpm --filter @xrlp/xrpl prestage");
});

test("warnings already covered by a required fix are not suggested twice", () => {
  const r = run((f) => {
    led(f, "A").escrows[0] = null; // NO-GO: prestage --only A
    f.file.finishedAt = iso(T - 3 * 3_600); // WARN: prestage --only A,B
    f.snap.preimages.mode = 0o644; // WARN: chmod
  });
  assert.deepEqual(
    r.fixes.map((x) => x.command),
    ["pnpm --filter @xrlp/xrpl prestage --only A"],
  );
  assert.deepEqual(
    r.suggestions.map((x) => x.command),
    ["pnpm --filter @xrlp/xrpl prestage --only A,B", "chmod 600 .data/prestage-preimages.json"],
  );
});

test("renderFix / mergeFixes", () => {
  assert.equal(renderFix({ kind: "prestage", only: ["B", "A"] }), "pnpm --filter @xrlp/xrpl prestage --only A,B");
  assert.equal(renderFix({ kind: "prestage", only: ["C", "A", "B"] }), "pnpm --filter @xrlp/xrpl prestage");
  assert.equal(renderFix({ kind: "bootstrap" }, "DATA_DIR=/tmp/x "), "DATA_DIR=/tmp/x pnpm --filter @xrlp/xrpl bootstrap");
  assert.deepEqual(
    mergeFixes([{ kind: "prestage", only: ["C"] }, { kind: "manual", text: "check the network" }, { kind: "bootstrap" }, { kind: "prestage", only: ["C"] }]),
    [{ command: "check the network" }, { command: "pnpm --filter @xrlp/xrpl bootstrap", eta: "~1 min" }, { command: "pnpm --filter @xrlp/xrpl prestage --only C", eta: "~10 min" }],
  );
});

// ------------------------------------------------------------------ secrets

test("no preimage, fulfillment or seed in the snapshot, the table or the JSON (GO and NO-GO reports)", () => {
  const f = fixture();
  const reports = [
    evaluateStage(f.snap, f.now),
    run((g) => (g.snap.preimages.entries["ps-test-a"]!["ps-test-a-m1"]!.derivedCondition = conditionFromPreimage(randomBytes(32)))),
    run((g) => (led(g, "A").escrows[0] = null)),
    run((g) => (g.snap.wallets = { exists: true, error: "not valid JSON", roles: {}, missingRoles: [...WALLET_ROLES] })),
  ];
  const outputs = [JSON.stringify(f.snap), ...reports.flatMap((r) => [JSON.stringify(r), renderStageReport(r, { verbose: true })])];
  const secrets = [...f.preimages, ...f.preimages.map((p) => p.toUpperCase()), ...f.fulfillments, ...f.fulfillments.map((x) => x.toLowerCase()), ...f.seeds];
  for (const out of outputs) for (const s of secrets) assert.ok(!out.includes(s), "a secret leaked into the output");
  // ... while the inputs really did contain them (the test is not vacuous).
  assert.ok(JSON.stringify(f.preimagesJson).includes(f.preimages[0]!));
  assert.ok(JSON.stringify(f.walletJson).includes(f.seeds[0]!));
});

test("summarizePreimages: derived conditions only; malformed and unknown entries; content-free errors", () => {
  const pre = randomBytes(32);
  const json = {
    version: 1,
    projects: {
      p1: { m1: { condition: "X", preimage: pre.toString("hex") }, m2: { condition: "Y", preimage: "zz".repeat(32) }, m3: { condition: "Z", preimage: pre.toString("hex").slice(2) } },
      other: { m1: { condition: "Q", preimage: pre.toString("hex") } },
    },
  };
  const s = summarizePreimages(json, [{ projectId: "p1", milestoneIds: ["m1", "m2", "m3", "missing"] }]);
  assert.deepEqual(s, {
    p1: { m1: { storedCondition: "X", derivedCondition: conditionFromPreimage(pre) }, m2: { storedCondition: "Y" }, m3: { storedCondition: "Z" } },
  });
  assert.ok(!JSON.stringify(s).includes(pre.toString("hex")));
  const secretish = { sEdSECRET: 1 };
  assert.throws(
    () => summarizePreimages(secretish, []),
    (e: Error) => /not a PrestagePreimagesFile/.test(e.message) && !e.message.includes("sEdSECRET"),
  );
});

test("walletAddresses: addresses only; a role without a seed counts as missing", () => {
  const f = fixture();
  const json = f.walletJson as { wallets: Record<string, { address: string; seed?: string }> };
  delete json.wallets.trustee!.seed;
  const w = walletAddresses(json);
  assert.equal(w.network, "devnet");
  assert.equal(w.roles.platform, ADDR.platform);
  assert.deepEqual(w.missingRoles, ["trustee"]);
  assert.ok(!JSON.stringify(w).includes("sEdTESTSEED"));
  assert.throws(() => walletAddresses("sEdNOTJSON"), (e: Error) => !e.message.includes("sEdNOTJSON"));
});

// ------------------------------------------------------------------ helpers + rendering

test("lockTermsCover = the cover prestage A posted on devnet (30000 @ 10%, 6 × 30 d)", () => {
  assert.equal(lockTermsCover({ principal: "30000", interestRateBps: 1000, paymentTotal: 6, paymentIntervalS: 30 * DAY }), "3395.579039");
});

test("amendmentId = SHA-512Half of the name (rippled feature keys)", () => {
  assert.equal(amendmentId("RequireFullyCanonicalSig"), "00C1FC4A53E60AB02C864641002B3172F38677E29C26C5406685179B37E1EDAC");
});

test("fmtDuration", () => {
  assert.deepEqual([45, 600, 7_200, 30 * DAY, -90].map(fmtDuration), ["45 s", "10 min", "2.0 h", "30.0 d", "90 s"]);
});

test("renderStageReport: one row per beat, check counts, verdict", () => {
  const go = renderStageReport(run());
  for (const label of ["D1 verified builder", "D2 locked state", "D3 release", "D4 fraud held", "D5 ledger says no", "D6 stall → refund", "| withdraw (C) |"]) assert.ok(go.includes(label), label);
  assert.match(go, /^== Stage check \(read-only, nothing submitted\) · devnet ledger 6395587 @ /);
  assert.match(go, /checks: \d+ GO · 0 WARN · 0 NO-GO\n/);
  assert.match(go, /VERDICT: GO, all 7 beats ready · exit 0$/);
  const nogo = renderStageReport(run((f) => (led(f, "B").escrows[1] = null)));
  assert.match(nogo, /\| D6 stall → refund \| \*\*NO-GO\*\* \| B m2 seq 6395011 is already gone .* \| `pnpm --filter @xrlp\/xrpl prestage --only B` \|/);
  assert.match(nogo, /NO-GO {2}B\.stall {2}B m2 seq 6395011 is already gone/);
  assert.match(nogo, /VERDICT: NO-GO \(D6 not ready\) · exit 1$/);
});
