// XRPL-10 adapter: offline tests (no network). Mapping helpers + the adapter's input guards (which fail before any request).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LedgerError, TooSoonError, type Builder, type LedgerPort, type Project } from "@xrlp/shared";
import { isoTimeToRippleTime, rippleTimeToISOTime, Wallet } from "xrpl";
import { XrplLedgerAdapter } from "../src/adapter.ts";
import {
  apiCodeOf,
  pickQuorumSigners,
  repayMode,
  tecToPortTx,
  toEscrowSnapshot,
  toLedgerError,
  toPortTx,
  validateCloseInputs,
  XrplLedgerError,
} from "../src/adapter-map.ts";
import type { TxResult } from "../src/client.ts";
import { generateMilestoneCondition } from "../src/condition.ts";
import { XrplTxError } from "../src/errors.ts";
import { UnsafeReleaseError, type PreflightResult } from "../src/preflight.ts";
import { WALLET_ROLES, type WalletFile } from "../src/wallets.ts";

const HASH = "AB".repeat(32);
const tx = (over: Partial<TxResult> = {}): TxResult => ({
  hash: HASH,
  explorerUrl: `https://devnet.xrpl.org/transactions/${HASH}`,
  result: "tesSUCCESS",
  tx: {},
  meta: {},
  ...over,
});

// ---------------------------------------------------------------- tx results

test("toPortTx keeps hash/explorerUrl/result, adds kind and ledger close time", () => {
  const date = 815_000_000;
  const t = toPortTx(tx({ tx: { date } }), "vault_deposit");
  assert.deepEqual(t, { hash: HASH, explorerUrl: `https://devnet.xrpl.org/transactions/${HASH}`, result: "tesSUCCESS", kind: "vault_deposit", at: rippleTimeToISOTime(date) });
  assert.match(t.explorerUrl, /^https:\/\/devnet\.xrpl\.org\/transactions\/[0-9A-F]{64}$/);
});

test("toPortTx omits kind/at when unknown", () => {
  const t = toPortTx(tx());
  assert.equal("kind" in t, false);
  assert.equal("at" in t, false);
});

test("tecToPortTx: on-ledger tec -> TxResult with the tec result; off-ledger -> undefined", () => {
  const onLedger = new XrplTxError("EscrowFinish", "tecCRYPTOCONDITION_ERROR", HASH);
  assert.deepEqual(tecToPortTx(onLedger, "release_refused"), {
    hash: HASH,
    explorerUrl: `https://devnet.xrpl.org/transactions/${HASH}`,
    result: "tecCRYPTOCONDITION_ERROR",
    kind: "release_refused",
  });
  assert.equal(tecToPortTx(new XrplTxError("EscrowFinish", "tefPAST_SEQ", HASH)), undefined);
  assert.equal(tecToPortTx(new XrplTxError("EscrowFinish", "tecNO_PERMISSION")), undefined);
});

// ---------------------------------------------------------------- errors

test("toLedgerError: tecTOO_SOON -> shared TooSoonError (code too_soon) with txHash/txResult", () => {
  const e = toLedgerError(new XrplTxError("LoanSet", "tecTOO_SOON", HASH), "closeLoanAndCreateEscrows");
  assert.ok(e instanceof TooSoonError);
  assert.ok(e instanceof LedgerError);
  assert.equal(e.code, "too_soon");
  assert.equal(e.txResult, "tecTOO_SOON");
  assert.equal(e.txHash, HASH);
  assert.match(e.message, /^closeLoanAndCreateEscrows: LoanSet failed: tecTOO_SOON/);
  assert.equal(apiCodeOf(e), "too_soon");
});

test("toLedgerError: engine results -> ErrorCode (not_found / validation / ledger_error), code stays in the shared union", () => {
  const cases: [string, string][] = [
    ["tecNO_TARGET", "not_found"],
    ["tecNO_ENTRY", "not_found"],
    ["tecNO_DST", "not_found"],
    ["temMALFORMED", "validation"],
    ["temBAD_AMOUNT", "validation"],
    ["tecNO_PERMISSION", "ledger_error"],
    ["tecNO_LINE", "ledger_error"],
    ["tecNO_AUTH", "ledger_error"],
    ["tecINSUFFICIENT_FUNDS", "ledger_error"],
    ["tecCRYPTOCONDITION_ERROR", "ledger_error"],
    ["connection_lost", "ledger_error"],
  ];
  for (const [r, code] of cases) {
    const e = toLedgerError(new XrplTxError("X", r, HASH));
    assert.ok(e instanceof XrplLedgerError, r);
    assert.equal(apiCodeOf(e), code, r);
    assert.equal(e.code, "ledger_error", r);
    assert.equal(e.txResult, r);
    assert.equal(e.txHash, HASH);
  }
});

test("toLedgerError: UnsafeReleaseError -> code unsafe_release with the preflight reason, no txHash", () => {
  const result = { ok: false, reason: "no_trustline", message: "builder has no RLUSD trust line", failures: [], details: {} } as unknown as PreflightResult;
  const e = toLedgerError(new UnsafeReleaseError(result), "finishEscrow");
  assert.ok(e instanceof XrplLedgerError);
  assert.equal(e.code, "unsafe_release");
  assert.equal(e.reason, "no_trustline");
  assert.equal(e.txHash, undefined);
  assert.equal(apiCodeOf(e), "unsafe_release");
});

test("toLedgerError: shared LedgerErrors pass through unchanged", () => {
  const tooSoon = new TooSoonError("withdrawals open later");
  assert.equal(toLedgerError(tooSoon), tooSoon);
  const mine = new XrplLedgerError("not_found", "gone");
  assert.equal(toLedgerError(mine), mine);
});

test("toLedgerError: rippled RPC errors and plain package errors", () => {
  assert.equal(apiCodeOf(toLedgerError({ data: { error: "entryNotFound" }, message: "x" })), "not_found");
  assert.equal(apiCodeOf(toLedgerError({ data: { error: "actNotFound" } })), "not_found");
  assert.equal(apiCodeOf(toLedgerError({ data: { error: "tooBusy" } })), "ledger_error");
  assert.equal(apiCodeOf(new Error("coverDeposit 1 < protocol minimum 44 for principal 400")), "validation");
  assert.equal(apiCodeOf(new Error("RedemptionDate 1 too early for 4 x 86400s")), "validation");
  assert.equal(apiCodeOf(new Error("no demo wallet for rXYZ (role name or address from .data/wallets.json expected)")), "validation");
  assert.equal(apiCodeOf(new Error("fulfillment does not match escrow condition")), "validation");
  assert.equal(apiCodeOf(new Error("socket hang up")), "ledger_error");
  const wrapped = toLedgerError(new Error("socket hang up"), "deposit");
  assert.equal(wrapped.message, "deposit: socket hang up");
  assert.ok((wrapped as { cause?: unknown }).cause instanceof Error);
});

// ---------------------------------------------------------------- SPV signers

const W = (a: string) => ({ classicAddress: a });
const LIST = { quorum: 3, signers: ["rPlatform", "rBuilder", "rInspector", "rTrustee"].map((account) => ({ account, weight: 1 })) };

test("pickQuorumSigners: preferred signers first, stops at quorum", () => {
  const held = new Map(LIST.signers.map((s) => [s.account, W(s.account)]));
  const got = pickQuorumSigners(LIST, (a) => held.get(a), ["rBuilder", "rPlatform", "rTrustee"]);
  assert.deepEqual(got.map((w) => w.classicAddress), ["rBuilder", "rPlatform", "rTrustee"]);
});

test("pickQuorumSigners: skips keys we don't hold (falls back to the inspector)", () => {
  const held = new Map(["rPlatform", "rInspector", "rTrustee"].map((a) => [a, W(a)]));
  const got = pickQuorumSigners(LIST, (a) => held.get(a), ["rBuilder", "rPlatform", "rTrustee"]);
  assert.deepEqual(got.map((w) => w.classicAddress), ["rPlatform", "rTrustee", "rInspector"]);
});

test("pickQuorumSigners: throws validation when held keys cannot reach quorum", () => {
  const held = new Map(["rPlatform", "rTrustee"].map((a) => [a, W(a)]));
  assert.throws(
    () => pickQuorumSigners(LIST, (a) => held.get(a)),
    (e: unknown) => e instanceof XrplLedgerError && e.apiCode === "validation" && /quorum 3 not reachable/.test(e.message),
  );
});

// ---------------------------------------------------------------- close inputs

const NOW = 815_000_000;
const iso = (r: number) => rippleTimeToISOTime(r);
const conds = (n: number) => Array.from({ length: n }, () => generateMilestoneCondition().condition);
const base = (over: Partial<Parameters<typeof validateCloseInputs>[0]> = {}) => ({
  milestoneCount: 3,
  conditions: conds(3),
  cancelAfters: [iso(NOW + 3600), iso(NOW + 7200), iso(NOW + 90)],
  nowRipple: NOW,
  maturityFloorRipple: NOW + 4 * 86_400,
  ...over,
});

test("validateCloseInputs: valid inputs -> CancelAfters as Ripple seconds, by milestone index", () => {
  assert.deepEqual(validateCloseInputs(base()), [NOW + 3600, NOW + 7200, NOW + 90]);
  // lower-case hex conditions are accepted too
  assert.doesNotThrow(() => validateCloseInputs(base({ conditions: conds(3).map((c) => c.toLowerCase()) })));
});

test("validateCloseInputs: rejects bad shapes, duplicates, past and post-maturity CancelAfter", () => {
  const bad = (over: Partial<Parameters<typeof validateCloseInputs>[0]>, re: RegExp) =>
    assert.throws(() => validateCloseInputs(base(over)), (e: unknown) => e instanceof XrplLedgerError && e.apiCode === "validation" && re.test(e.message));
  bad({ conditions: conds(2) }, /2 conditions for 3 milestones/);
  bad({ cancelAfters: [iso(NOW + 60)] }, /1 cancelAfters for 3 milestones/);
  bad({ milestoneCount: 0, conditions: [], cancelAfters: [] }, /no milestones/);
  const [a, b] = conds(2);
  bad({ conditions: [a!, b!, a!.toLowerCase()] }, /conditions\[2\] duplicates/);
  bad({ conditions: [a!, b!, "A0228020" + "00".repeat(32)] }, /conditions\[2\] is not a PREIMAGE-SHA-256 condition/);
  bad({ cancelAfters: [iso(NOW + 60), iso(NOW), iso(NOW + 60)] }, /cancelAfters\[1\] .* is not after ledger now/);
  bad({ cancelAfters: [iso(NOW + 60), iso(NOW + 60), iso(NOW + 4 * 86_400)] }, /cancelAfters\[2\] .* is not before loan maturity/);
  bad({ cancelAfters: [iso(NOW + 60), "soon", iso(NOW + 60)] }, /cancelAfters\[1\] is not an ISO date/);
});

test("validateCloseInputs matches xrpl.js isoTimeToRippleTime", () => {
  const at = "2026-10-25T12:00:00.000Z";
  assert.deepEqual(validateCloseInputs(base({ cancelAfters: [at, at, at], nowRipple: isoTimeToRippleTime(at) - 1, maturityFloorRipple: isoTimeToRippleTime(at) + 1 })), [
    isoTimeToRippleTime(at),
    isoTimeToRippleTime(at),
    isoTimeToRippleTime(at),
  ]);
});

// ---------------------------------------------------------------- repay

test("repayMode: > one periodic payment -> overpayment; late after due date; else regular", () => {
  assert.equal(repayMode({ amount: "200", periodicPayment: "100.1", nowRipple: NOW }), "overpayment");
  assert.equal(repayMode({ amount: "100.1", periodicPayment: "100.1", nowRipple: NOW, nextPaymentDueRipple: NOW + 10 }), "regular");
  assert.equal(repayMode({ amount: "100.2", periodicPayment: "100.1", serviceFee: "0.1", nowRipple: NOW }), "regular");
  assert.equal(repayMode({ amount: "100.1", periodicPayment: "100.1", nowRipple: NOW, nextPaymentDueRipple: NOW - 1 }), "late");
});

// ---------------------------------------------------------------- reads

test("toEscrowSnapshot maps reads.ts EscrowView to the shared EscrowSnapshot", () => {
  const view = {
    index: "IDX",
    owner: "rSpv",
    offerSequence: 7,
    destination: "rBuilder",
    currency: "RLUSD",
    issuer: "rIssuer",
    amount: "100",
    condition: "A025",
    cancelAfter: "2026-10-25T00:00:00.000Z",
    cancelAfterRipple: 1,
    status: "open" as const,
    finishable: true,
    cancellable: false,
  };
  assert.deepEqual(toEscrowSnapshot(view, 7), { owner: "rSpv", offerSequence: 7, destination: "rBuilder", amount: "100", condition: "A025", cancelAfter: "2026-10-25T00:00:00.000Z" });
  assert.deepEqual(toEscrowSnapshot({ ...view, offerSequence: undefined, condition: undefined, cancelAfter: undefined }, 9), { owner: "rSpv", offerSequence: 9, destination: "rBuilder", amount: "100" });
});

// ---------------------------------------------------------------- adapter guards (no network: they throw first)

function tempWallets(): { file: string; wallets: Record<string, Wallet> } {
  const wallets: Record<string, Wallet> = {};
  const stored = {} as WalletFile["wallets"];
  for (const role of WALLET_ROLES) {
    const w = Wallet.generate();
    wallets[role] = w;
    stored[role] = { address: w.classicAddress, seed: w.seed! };
  }
  const file = join(mkdtempSync(join(tmpdir(), "xrlp-adapter-")), "wallets.json");
  writeFileSync(file, JSON.stringify({ network: "devnet", createdAt: new Date().toISOString(), wallets: stored, spvs: {} } satisfies WalletFile));
  return { file, wallets };
}

const project = (chain: Project["chain"] = {}): Project => ({
  id: "p-test",
  name: "Test",
  type: "residential_new",
  builderId: "b1",
  siteAddress: "1 Test St",
  siteGeo: { lat: 0, lng: 0, radiusM: 50 },
  description: "",
  terms: { principal: "400", interestRateBps: 1000, termDays: 4, paymentIntervalDays: 1, fundingDeadline: "2026-10-25T00:00:00.000Z" },
  status: "funding",
  milestones: [],
  chain,
});

test("XrplLedgerAdapter: mode devnet, implements LedgerPort, guards fail with typed errors before any request", async () => {
  const { file, wallets } = tempWallets();
  const logs: string[] = [];
  const ledger: LedgerPort = new XrplLedgerAdapter({ walletsFile: file, log: (l) => logs.push(l) });
  assert.equal(ledger.mode, "devnet");
  const builder: Builder = {
    id: "b1",
    name: "B",
    address: wallets.builder!.classicAddress,
    licenseNumber: "L",
    insurancePolicy: "I",
    completedProjects: 0,
    riskTier: "low",
    verified: true,
  };
  const isCode = (code: string) => (e: unknown) => e instanceof LedgerError && apiCodeOf(e) === code;

  await assert.rejects(
    ledger.setupProjectOnChain({ project: project(), builder, inspectors: [], subscriptionDate: "2026-10-25T00:00:00Z", redemptionDate: "2026-10-30T00:00:00Z" }),
    isCode("validation"),
  );
  await assert.rejects(
    ledger.setupProjectOnChain({ project: project(), builder, inspectors: [builder.address], subscriptionDate: "2026-10-25T00:00:00Z", redemptionDate: "2026-10-30T00:00:00Z" }),
    (e: unknown) => isCode("validation")(e) && /4 distinct accounts/.test((e as Error).message),
  );
  await assert.rejects(ledger.deposit({ project: project(), investor: wallets.investor1!.classicAddress, amount: "1" }), (e: unknown) => isCode("validation")(e) && /chain\.vaultId/.test((e as Error).message));
  await assert.rejects(ledger.withdraw({ project: project(), investor: wallets.investor1!.classicAddress, amount: "1" }), isCode("validation"));
  await assert.rejects(ledger.closeLoanAndCreateEscrows({ project: project({ vaultId: "V" }), builder, conditions: [], cancelAfters: [] }), (e: unknown) => isCode("validation")(e) && /chain\.spv/.test((e as Error).message));
  await assert.rejects(ledger.repayLoan({ project: project({ spv: wallets.platform!.classicAddress }), amount: "1", source: "escrow_refund" }), (e: unknown) => isCode("validation")(e) && /chain\.loanId/.test((e as Error).message));
  // unknown key: the address is not in the wallet store
  await assert.rejects(
    ledger.payVerificationFee({ builder: Wallet.generate().classicAddress, amount: "250" }),
    (e: unknown) => isCode("validation")(e) && /no key for builder/.test((e as Error).message),
  );
  assert.ok(logs.every((l) => /failed \[validation\]/.test(l)));
  assert.equal(logs.length, 7);
});
