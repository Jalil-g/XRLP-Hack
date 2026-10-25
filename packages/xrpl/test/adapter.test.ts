// XRPL-10 adapter: offline tests (no network). Mapping helpers + the adapter's input guards (which fail before any request).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LedgerError, TooSoonError, type Builder, type LedgerPort, type Project } from "@xrlp/shared";
import { rippleTimeToISOTime, Wallet } from "xrpl";
import { XrplLedgerAdapter } from "../src/adapter.ts";
import { apiCodeOf, keyForRole, NEVER_SPV_SIGNERS, pickQuorumSigners, SIGNING_ROLES, spvSignerCandidates, toAdapterError, toPortTx, XrplLedgerError } from "../src/adapter-map.ts";
import type { TxResult } from "../src/client.ts";
import { XrplTxError } from "../src/errors.ts";
import { LoanPayAmountError } from "../src/loan.ts";
import { CloseLoanPartialError, CloseValidationError } from "../src/loan-close.ts";
import { UnsafeReleaseError, type PreflightResult } from "../src/preflight.ts";
import { toEscrowSnapshot } from "../src/reads.ts";
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

// ---------------------------------------------------------------- errors

test("toAdapterError: tecTOO_SOON -> shared TooSoonError (code too_soon) with txHash/txResult", () => {
  const e = toAdapterError(new XrplTxError("LoanSet", "tecTOO_SOON", HASH), "closeLoanAndCreateEscrows");
  assert.ok(e instanceof TooSoonError);
  assert.ok(e instanceof LedgerError);
  assert.equal(e.code, "too_soon");
  assert.equal(e.txResult, "tecTOO_SOON");
  assert.equal(e.txHash, HASH);
  assert.match(e.message, /^closeLoanAndCreateEscrows: LoanSet failed: tecTOO_SOON/);
  assert.equal(apiCodeOf(e), "too_soon");
});

test("toAdapterError: engine results -> ErrorCode (not_found / validation / ledger_error), code stays in the shared union", () => {
  const cases: [string, string][] = [
    ["tecNO_TARGET", "not_found"],
    ["tecNO_ENTRY", "not_found"],
    ["tecNO_DST", "not_found"],
    ["temMALFORMED", "validation"],
    ["temBAD_AMOUNT", "validation"],
    ["tecNO_PERMISSION", "ledger_error"],
    ["tecNO_LINE", "not_found"], // errors.ts toErrorCode
    ["tecNO_AUTH", "ledger_error"],
    ["tecINSUFFICIENT_FUNDS", "ledger_error"],
    ["tecCRYPTOCONDITION_ERROR", "ledger_error"],
    ["connection_lost", "ledger_error"],
  ];
  for (const [r, code] of cases) {
    const e = toAdapterError(new XrplTxError("X", r, HASH));
    assert.ok(e instanceof XrplLedgerError, r);
    assert.equal(apiCodeOf(e), code, r);
    assert.equal(e.code, "ledger_error", r);
    assert.equal(e.txResult, r);
    assert.equal(e.txHash, HASH);
  }
});

test("toAdapterError: UnsafeReleaseError (a shared LedgerError) passes through: unsafe_release + preflight reason, no txHash", () => {
  const result = { ok: false, reason: "no_trustline", message: "builder has no RLUSD trust line", failures: [], details: {} } as unknown as PreflightResult;
  const unsafe = new UnsafeReleaseError(result);
  const e = toAdapterError(unsafe, "finishEscrow");
  assert.equal(e, unsafe);
  assert.equal(e.code, "unsafe_release");
  assert.equal(unsafe.reason, "no_trustline");
  assert.equal(e.txHash, undefined);
  assert.equal(apiCodeOf(e), "unsafe_release");
  // a refused PreflightResult body (not an Error) -> XrplLedgerError unsafe_release, reason kept
  const body = toAdapterError({ ok: false, code: "unsafe_release", reason: "expired_or_too_close", message: "CancelAfter in 30s" });
  assert.ok(body instanceof XrplLedgerError);
  assert.equal(body.code, "unsafe_release");
  assert.equal(body.reason, "expired_or_too_close");
});

test("toAdapterError: XRPL-06/07 client-side refusals -> validation; CloseLoanPartialError passes through as ledger_error", () => {
  const close = toAdapterError(new CloseValidationError(["milestone m1 (#0): duplicate condition"]), "closeLoanAndCreateEscrows");
  assert.ok(close instanceof XrplLedgerError);
  assert.equal(apiCodeOf(close), "validation");
  assert.equal(close.code, "ledger_error");
  assert.match(close.message, /^closeLoanAndCreateEscrows: closeLoanAndCreateEscrows: invalid input, nothing submitted/);
  assert.ok(close.cause instanceof CloseValidationError);
  const pay = toAdapterError(new LoanPayAmountError("LoanPay 1000 < one periodic payment 13333.384070", "13333.384070"));
  assert.equal(apiCodeOf(pay), "validation");
  assert.equal(pay.txHash, undefined);
  const partial = new CloseLoanPartialError("LOAN", HASH, [], ["m2"], new XrplTxError("EscrowCreate", "tecUNFUNDED", "CD".repeat(32)));
  assert.equal(toAdapterError(partial), partial);
  assert.equal(apiCodeOf(partial), "ledger_error");
  assert.equal(partial.txResult, "tecUNFUNDED");
});

test("toAdapterError: shared LedgerErrors pass through unchanged", () => {
  const tooSoon = new TooSoonError("withdrawals open later");
  assert.equal(toAdapterError(tooSoon), tooSoon);
  const mine = new XrplLedgerError("not_found", "gone");
  assert.equal(toAdapterError(mine), mine);
});

test("toAdapterError: rippled RPC errors and plain package errors", () => {
  assert.equal(apiCodeOf(toAdapterError({ data: { error: "entryNotFound" }, message: "x" })), "not_found");
  assert.equal(apiCodeOf(toAdapterError({ data: { error: "actNotFound" } })), "not_found");
  const busy = toAdapterError({ data: { error: "tooBusy" } });
  assert.equal(apiCodeOf(busy), "ledger_error");
  assert.equal(busy.txResult, "tooBusy");
  assert.equal(apiCodeOf(new Error("coverDeposit 1 < protocol minimum 44 for principal 400")), "validation");
  assert.equal(apiCodeOf(new Error("RedemptionDate 1 too early for 4 x 86400s")), "validation");
  assert.equal(apiCodeOf(new Error("no demo wallet for rXYZ (role name or address from .data/wallets.json expected)")), "validation");
  assert.equal(apiCodeOf(new Error("fulfillment does not match escrow condition")), "validation");
  assert.equal(apiCodeOf(new Error("socket hang up")), "ledger_error");
  const wrapped = toAdapterError(new Error("socket hang up"), "deposit");
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

// ---------------------------------------------------------------- reads

test("getEscrow: reads.ts toEscrowSnapshot maps EscrowView to the shared EscrowSnapshot", () => {
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

// ---------------------------------------------------------------- security review M4 / M6: which key signs what

test("M4 keyForRole: a role's key never signs for another role; unknown address → validation", () => {
  const { wallets } = tempWallets();
  assert.equal(keyForRole(wallets, wallets.investor2!.classicAddress, SIGNING_ROLES.investor, "investor"), wallets.investor2);
  for (const role of ["issuer", "platform", "releaseService", "aiAgent", "trustee", "builder", "inspector1"]) {
    assert.throws(
      () => keyForRole(wallets, wallets[role]!.classicAddress, SIGNING_ROLES.investor, "investor"),
      (e: unknown) => e instanceof XrplLedgerError && e.apiCode === "validation" && new RegExp(`is the demo ${role} key; refusing to sign as investor`).test(e.message),
    );
  }
  assert.throws(() => keyForRole(wallets, Wallet.generate().classicAddress, SIGNING_ROLES.builder, "builder"), /no key for builder/);
  assert.deepEqual([...SIGNING_ROLES.KYC_INVESTOR], ["investor1", "investor2", "investor3"]);
  assert.deepEqual([...SIGNING_ROLES.VERIFIED_INSPECTOR], ["inspector1", "inspector2", "inspector3"]);
});

test("M4 adapter: core-supplied addresses of platform-held keys are refused before any request", async () => {
  const { file, wallets } = tempWallets();
  const ledger = new XrplLedgerAdapter({ walletsFile: file });
  const isValidation = (re: RegExp) => (e: unknown) => e instanceof LedgerError && apiCodeOf(e) === "validation" && re.test((e as Error).message);
  await assert.rejects(ledger.deposit({ project: project({ vaultId: "V" }), investor: wallets.issuer!.classicAddress, amount: "1" }), isValidation(/demo issuer key; refusing to sign as investor/));
  await assert.rejects(ledger.issueCredential({ subject: wallets.platform!.classicAddress, type: "KYC_INVESTOR" }), isValidation(/demo platform key; refusing to sign as KYC_INVESTOR subject/));
  await assert.rejects(ledger.issueCredential({ subject: wallets.investor1!.classicAddress, type: "VERIFIED_INSPECTOR" }), isValidation(/demo investor1 key/));
  await assert.rejects(ledger.payVerificationFee({ builder: wallets.releaseService!.classicAddress, amount: "250" }), isValidation(/demo releaseService key; refusing to sign as builder/));
  await assert.rejects(ledger.attest({ signer: "issuer" as never, spv: wallets.trustee!.classicAddress, memo: { v: 1, kind: "verdict", milestoneId: "m1", hash: "ab".repeat(32) } }), isValidation(/signer must be one of aiAgent, platform, releaseService/));
});

test("M6: the AI / releaseService / issuer key can't become an SPV signer or be picked for a quorum", async () => {
  const { file, wallets } = tempWallets();
  const ledger = new XrplLedgerAdapter({ walletsFile: file });
  const builder: Builder = { id: "b1", name: "B", address: wallets.builder!.classicAddress, licenseNumber: "L", insurancePolicy: "I", completedProjects: 0, riskTier: "low", verified: true };
  for (const role of ["aiAgent", "releaseService", "issuer"]) {
    await assert.rejects(
      ledger.setupProjectOnChain({ project: project(), builder, inspectors: [wallets[role]!.classicAddress], subscriptionDate: "2026-10-25T00:00:00Z", redemptionDate: "2026-10-30T00:00:00Z" }),
      (e: unknown) => e instanceof LedgerError && apiCodeOf(e) === "validation" && new RegExp(`inspector .* is the ${role} key, which must never be an SPV signer`).test((e as Error).message),
    );
  }
  const candidates = spvSignerCandidates(wallets).map((w) => w.classicAddress);
  for (const role of NEVER_SPV_SIGNERS) assert.ok(!candidates.includes(wallets[role]!.classicAddress), `${role} is never a candidate`);
  assert.ok(candidates.includes(wallets.platform!.classicAddress) && candidates.includes(wallets.trustee!.classicAddress));
  // Even an on-ledger list that (wrongly) names the AI key can't make us sign with it.
  const list = { quorum: 3, signers: [wallets.aiAgent!, wallets.platform!, wallets.builder!, wallets.trustee!].map((w) => ({ account: w.classicAddress, weight: 1 })) };
  const byAddress = new Map(spvSignerCandidates(wallets).map((w) => [w.classicAddress, w]));
  const picked = pickQuorumSigners(list, (a) => byAddress.get(a));
  assert.ok(!picked.includes(wallets.aiAgent!));
  assert.equal(picked.length, 3);
});
