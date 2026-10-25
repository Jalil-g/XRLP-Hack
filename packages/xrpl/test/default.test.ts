// XRPL-15: LoanManage guards (timing, rippled check order), first-loss cover math, outcome parsing from tx metadata.
// Offline: synthetic metadata shaped like rippled 3.4.1's, plus the recorded devnet txs in test/fixtures/devnet-loan-*.json
// (captured by `SPIKE_WRITE_FIXTURES=1 pnpm --filter @xrlp/xrpl spike:default`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LedgerError, TooSoonError } from "@xrlp/shared";
import {
  canDefaultAt,
  canImpairAt,
  checkLoanManage,
  defaultableAfter,
  expectedDefaultCovered,
  impairableAfter,
  LOAN_MANAGE_FLAG,
  loanExposure,
  LoanManageRefusedError,
  LoanManageTooSoonError,
  parseDefaultOutcome,
  parseImpairOutcome,
  vaultAccounting,
  type LoanManageLoan,
} from "../src/default.ts";
import { toErrorCode, toLedgerError } from "../src/errors.ts";
import { COVER_RATE_LIQUIDATION, COVER_RATE_MINIMUM } from "../src/lending-math.ts";
import { parseVaultSnapshot, type RawResult } from "../src/reads.ts";

const LSF_OVERPAYMENT = 0x40000;
const LSF_IMPAIRED = 0x20000;
const LSF_DEFAULT = 0x10000;
const LOAN_ID = "A".repeat(64);
const OWNER = "rPlatformXXXXXXXXXXXXXXXXXXXXXXXX";
const OUTSIDER = "rOutsiderXXXXXXXXXXXXXXXXXXXXXXXX";

/** 1000 RLUSD, payments remaining, next due at Ripple t=1000, 60 s grace. */
const loan = (o: Partial<LoanManageLoan> = {}): LoanManageLoan => ({
  Flags: LSF_OVERPAYMENT,
  NextPaymentDueDate: 1000,
  GracePeriod: 60,
  PaymentRemaining: 3,
  PrincipalOutstanding: "1000",
  TotalValueOutstanding: "1000.000571",
  ManagementFeeOutstanding: "0.000057",
  ...o,
});

// ---------------------------------------------------------------- cover math

test("expectedDefaultCovered: Drawproof rates (10% / 100%) liquidate 10% of DebtTotal", () => {
  assert.equal(COVER_RATE_MINIMUM, 10_000);
  assert.equal(COVER_RATE_LIQUIDATION, 100_000);
  const base = { coverRateMinimum: COVER_RATE_MINIMUM, coverRateLiquidation: COVER_RATE_LIQUIDATION };
  assert.equal(expectedDefaultCovered({ ...base, debtTotal: "1000", defaultAmount: "1000", coverAvailable: "110.000064" }), "100");
  assert.equal(expectedDefaultCovered({ ...base, debtTotal: "30000", defaultAmount: "30000", coverAvailable: "3300.007849" }), "3000");
  assert.equal(expectedDefaultCovered({ ...base, debtTotal: "1e3", defaultAmount: "1000", coverAvailable: "500" }), "100");
});

test("expectedDefaultCovered: XLS-66 §3.1.11 Example 1 (10% x 10% of 1090 = 10.9)", () => {
  assert.equal(expectedDefaultCovered({ debtTotal: "1090", coverRateMinimum: 10_000, coverRateLiquidation: 10_000, defaultAmount: "1090", coverAvailable: "1000" }), "10.9");
});

test("expectedDefaultCovered: capped by CoverAvailable, then by the defaulted exposure", () => {
  const base = { coverRateMinimum: 10_000, coverRateLiquidation: 100_000 };
  assert.equal(expectedDefaultCovered({ ...base, debtTotal: "1000", defaultAmount: "1000", coverAvailable: "50" }), "50");
  // The broker owes 10000 across loans; this loan's exposure is only 300.
  assert.equal(expectedDefaultCovered({ ...base, debtTotal: "10000", defaultAmount: "300", coverAvailable: "2000" }), "300");
  // Partially repaid before the default (stall path: refunds LoanPay'd first): 10% of what is still owed.
  assert.equal(expectedDefaultCovered({ ...base, debtTotal: "400", defaultAmount: "400", coverAvailable: "110" }), "40");
  assert.equal(expectedDefaultCovered({ debtTotal: "1000", coverRateMinimum: 0, coverRateLiquidation: 0, defaultAmount: "1000", coverAvailable: "0" }), "0");
});

test("expectedDefaultCovered: exact decimals, rounded UP to 10^LoanScale like rippled", () => {
  const base = { coverRateMinimum: 10_000, coverRateLiquidation: 100_000, defaultAmount: "1000", coverAvailable: "1000" };
  assert.equal(expectedDefaultCovered({ ...base, debtTotal: "333.333333333333" }), "33.3333333333333");
  assert.equal(expectedDefaultCovered({ ...base, debtTotal: "333.333333333333", loanScale: -12 }), "33.333333333334");
  assert.equal(expectedDefaultCovered({ ...base, debtTotal: "333.333333333333", loanScale: 0 }), "34");
  // Already at the scale: unchanged.
  assert.equal(expectedDefaultCovered({ ...base, debtTotal: "1000", loanScale: -12 }), "100");
  // The cap applies after the rounding: rounding never pushes DefaultCovered above CoverAvailable.
  assert.equal(expectedDefaultCovered({ ...base, debtTotal: "333.333333333333", coverAvailable: "33.3333333333345", loanScale: -12 }), "33.333333333334");
  assert.equal(expectedDefaultCovered({ ...base, debtTotal: "333.333333333333", coverAvailable: "33.3333333333331", loanScale: -12 }), "33.3333333333331");
});

test("expectedDefaultCovered rejects bad rates and negative amounts", () => {
  const ok = { debtTotal: "1000", coverRateMinimum: 10_000, coverRateLiquidation: 100_000, defaultAmount: "1000", coverAvailable: "100" };
  assert.throws(() => expectedDefaultCovered({ ...ok, coverRateMinimum: 100_001 }), /CoverRateMinimum/);
  assert.throws(() => expectedDefaultCovered({ ...ok, coverRateLiquidation: 1.5 }), /CoverRateLiquidation/);
  assert.throws(() => expectedDefaultCovered({ ...ok, coverRateMinimum: -1 }), /CoverRateMinimum/);
  assert.throws(() => expectedDefaultCovered({ ...ok, coverAvailable: "-1" }), /coverAvailable/);
  assert.throws(() => expectedDefaultCovered({ ...ok, debtTotal: "abc" }));
});

// ---------------------------------------------------------------- accounting + exposure

test("vault accounting: LEVersion 1 = cash basis (principal only), absent = accrual (TVO - management fee)", () => {
  assert.equal(vaultAccounting({ LEVersion: 1 }), "cash_basis");
  assert.equal(vaultAccounting({}), "accrual");
  assert.equal(vaultAccounting(undefined), "accrual");
  assert.equal(loanExposure(loan(), "cash_basis"), "1000");
  assert.equal(loanExposure(loan(), "accrual"), "1000.000514");
  assert.equal(loanExposure(loan({ PrincipalOutstanding: "5e-7" }), "cash_basis"), "0.0000005");
  assert.equal(loanExposure({}, "cash_basis"), "0");
});

// ---------------------------------------------------------------- timing (fixCleanup3_4_0: exclusive boundaries)

test("default is allowed only once ledger time > NextPaymentDueDate + GracePeriod (equality is not late)", () => {
  const l = loan();
  assert.equal(defaultableAfter(l), 1060);
  assert.equal(canDefaultAt(l, 999), false);
  assert.equal(canDefaultAt(l, 1000), false);
  assert.equal(canDefaultAt(l, 1060), false);
  assert.equal(canDefaultAt(l, 1061), true);
  const c = checkLoanManage({ action: "default", loan: l, now: 1030 });
  assert.equal(c.ok, false);
  if (!c.ok) {
    assert.equal(c.reason, "too_soon");
    assert.equal(c.expectedResult, "tecTOO_SOON");
    assert.equal(c.allowedAfter, 1060);
    assert.match(c.message, /31s to go/);
  }
});

test("impair is allowed only once the payment is overdue (now > NextPaymentDueDate); unimpair has no timing rule", () => {
  const l = loan();
  assert.equal(impairableAfter(l), 1000);
  assert.equal(canImpairAt(l, 1000), false);
  assert.equal(canImpairAt(l, 1001), true);
  assert.equal(checkLoanManage({ action: "unimpair", loan: loan({ Flags: LSF_OVERPAYMENT | LSF_IMPAIRED }), now: 10 }).ok, true);
  // Impairing doesn't open the default early: due + grace still rules.
  assert.equal(canDefaultAt(loan({ Flags: LSF_OVERPAYMENT | LSF_IMPAIRED }), 1030), false);
});

test("defaulted and paid-off loans can't be managed at all", () => {
  const defaulted = loan({ Flags: LSF_OVERPAYMENT | LSF_IMPAIRED | LSF_DEFAULT, PaymentRemaining: 0 });
  for (const action of ["impair", "unimpair", "default"] as const) {
    const c = checkLoanManage({ action, loan: defaulted, now: 5000 });
    assert.equal(c.ok, false);
    if (!c.ok) assert.deepEqual([c.reason, c.expectedResult], ["already_defaulted", "tecNO_PERMISSION"]);
  }
  assert.equal(canDefaultAt(defaulted, 5000), false);
  const paid = checkLoanManage({ action: "default", loan: loan({ PaymentRemaining: 0 }), now: 5000 });
  assert.equal(paid.ok, false);
  if (!paid.ok) assert.deepEqual([paid.reason, paid.expectedResult], ["paid_off", "tecNO_PERMISSION"]);
});

// ---------------------------------------------------------------- rippled 3.4.1 check order

test("checks run in rippled's order, so the reason is the code the ledger would return", () => {
  const reason = (c: ReturnType<typeof checkLoanManage>) => (c.ok ? "ok" : `${c.reason}/${c.expectedResult}`);
  assert.equal(reason(checkLoanManage({ action: "default", loan: undefined, now: 0 })), "loan_not_found/tecNO_ENTRY");
  // A non-owner defaulting too early gets tecTOO_SOON: preclaim checks the timing before the owner.
  assert.equal(reason(checkLoanManage({ action: "default", loan: loan(), now: 1030, submitter: OUTSIDER, brokerOwner: OWNER })), "too_soon/tecTOO_SOON");
  assert.equal(reason(checkLoanManage({ action: "default", loan: loan(), now: 1061, submitter: OUTSIDER, brokerOwner: OWNER })), "not_broker_owner/tecNO_PERMISSION");
  assert.equal(reason(checkLoanManage({ action: "default", loan: loan(), now: 1061, submitter: OWNER, brokerOwner: OWNER })), "ok");
  // Impair timing is a doApply check, after the preclaim owner check.
  assert.equal(reason(checkLoanManage({ action: "impair", loan: loan(), now: 900, submitter: OUTSIDER, brokerOwner: OWNER })), "not_broker_owner/tecNO_PERMISSION");
  assert.equal(reason(checkLoanManage({ action: "impair", loan: loan(), now: 900, submitter: OWNER, brokerOwner: OWNER })), "too_soon/tecTOO_SOON");
  assert.equal(reason(checkLoanManage({ action: "impair", loan: loan({ Flags: LSF_IMPAIRED }), now: 1001 })), "already_impaired/tecNO_PERMISSION");
  assert.equal(reason(checkLoanManage({ action: "unimpair", loan: loan(), now: 1001 })), "not_impaired/tecNO_PERMISSION");
});

test("impair refuses a paper loss above the vault's lent-out assets (tecLIMIT_EXCEEDED); equality is fine", () => {
  const base = { action: "impair" as const, loan: loan(), now: 1001 };
  assert.equal(checkLoanManage({ ...base, vault: { AssetsTotal: "1000", LEVersion: 1 } }).ok, true); // AssetsAvailable 0: 1000 <= 1000
  const over = checkLoanManage({ ...base, vault: { AssetsTotal: "1000", AssetsAvailable: "500", LEVersion: 1 } });
  assert.equal(over.ok, false);
  if (!over.ok) assert.deepEqual([over.reason, over.expectedResult], ["loss_exceeds_vault", "tecLIMIT_EXCEEDED"]);
  // Another loan's paper loss already on the vault counts too.
  assert.equal(checkLoanManage({ ...base, vault: { AssetsTotal: "2000", LossUnrealized: "1000.5", LEVersion: 1 } }).ok, false);
});

test("LoanManage flags are the XLS-66 values", () => {
  assert.deepEqual(LOAN_MANAGE_FLAG, { default: 0x00010000, impair: 0x00020000, unimpair: 0x00040000 });
});

// ---------------------------------------------------------------- errors

test("LoanManageTooSoonError is the shared TooSoonError (code too_soon) and says when to retry", () => {
  const e = new LoanManageTooSoonError("default", LOAN_ID, 1030, 846_200_000, "too early");
  assert.ok(e instanceof TooSoonError);
  assert.ok(e instanceof LedgerError);
  assert.equal(e.code, "too_soon");
  assert.equal(e.name, "LoanManageTooSoonError");
  assert.equal(e.allowedAfterIso, "2026-10-24T23:33:20.000Z");
  assert.equal(toLedgerError(e), e);
  assert.equal(toErrorCode(e), "too_soon");
  assert.equal(e.txHash, undefined); // nothing submitted
});

test("LoanManageRefusedError is a shared LedgerError (ledger_error) carrying the reason and the ledger's code", () => {
  const c = checkLoanManage({ action: "default", loan: loan(), now: 1061, submitter: OUTSIDER, brokerOwner: OWNER });
  assert.equal(c.ok, false);
  if (c.ok) return;
  const e = new LoanManageRefusedError("default", LOAN_ID, c);
  assert.ok(e instanceof LedgerError);
  assert.ok(!(e instanceof TooSoonError));
  assert.equal(e.code, "ledger_error");
  assert.equal(e.reason, "not_broker_owner");
  assert.equal(e.expectedResult, "tecNO_PERMISSION");
  assert.match(e.message, /refused before submit/);
  assert.equal(toLedgerError(e), e);
});

// ---------------------------------------------------------------- outcomes from metadata (synthetic, rippled-shaped)

const SHARES = "1000000000"; // 1000 RLUSD deposited at scale 6

/** Impaired 1000 RLUSD loan defaulted on a cash-basis vault: everything lent out, cover 110.000064. */
const defaultMeta = {
  TransactionResult: "tesSUCCESS",
  AffectedNodes: [
    {
      ModifiedNode: {
        LedgerEntryType: "Loan",
        LedgerIndex: LOAN_ID,
        PreviousFields: {
          Flags: LSF_OVERPAYMENT | LSF_IMPAIRED,
          PrincipalOutstanding: "1000",
          TotalValueOutstanding: "1000.000571",
          ManagementFeeOutstanding: "0.000057",
          PaymentRemaining: 3,
          NextPaymentDueDate: 1000,
        },
        FinalFields: { Flags: LSF_OVERPAYMENT | LSF_IMPAIRED | LSF_DEFAULT, GracePeriod: 60, LoanScale: -12 },
      },
    },
    {
      ModifiedNode: {
        LedgerEntryType: "LoanBroker",
        LedgerIndex: "B".repeat(64),
        PreviousFields: { DebtTotal: "1000", CoverAvailable: "110.000064" },
        FinalFields: { CoverAvailable: "10.000064", CoverRateMinimum: 10_000, CoverRateLiquidation: 100_000 },
      },
    },
    {
      ModifiedNode: {
        LedgerEntryType: "Vault",
        LedgerIndex: "C".repeat(64),
        PreviousFields: { AssetsTotal: "1000", LossUnrealized: "1000" },
        FinalFields: { AssetsTotal: "100", AssetsAvailable: "100", LEVersion: 1, Scale: 6 },
      },
    },
    { ModifiedNode: { LedgerEntryType: "RippleState", LedgerIndex: "D".repeat(64), PreviousFields: { Balance: { value: "-110.000064" } } } },
  ],
};

test("parseDefaultOutcome: cover returned, vault write-down, share price, from rippled-shaped metadata", () => {
  const o = parseDefaultOutcome(defaultMeta, { loanId: LOAN_ID, sharesOutstanding: SHARES });
  assert.equal(o.accounting, "cash_basis");
  assert.equal(o.wasImpaired, true);
  assert.equal(o.defaultAmount, "1000");
  assert.equal(o.defaultCovered, "100");
  assert.equal(o.expectedDefaultCovered, "100");
  assert.equal(o.vaultLoss, "900");
  assert.deepEqual(o.debtTotal, { before: "1000", after: "0" });
  assert.deepEqual(o.coverAvailable, { before: "110.000064", after: "10.000064" });
  // AssetsAvailable was absent (0) before: it shows up in FinalFields only.
  assert.deepEqual(o.vault.before, { assetsTotal: "1000", assetsAvailable: "0", lossUnrealized: "1000", sharePrice: "1", netSharePrice: "0" });
  assert.deepEqual(o.vault.after, { assetsTotal: "100", assetsAvailable: "100", lossUnrealized: "0", sharePrice: "0.1", netSharePrice: "0.1" });
  assert.deepEqual(o.exact, { defaultAmount: "1000", defaultCovered: "100", expectedDefaultCovered: "100", vaultLoss: "900" });
});

test("parseDefaultOutcome: unimpaired default with liquidity already in the vault (fields present before)", () => {
  const meta = structuredClone(defaultMeta);
  const [loanNode, , vaultNode] = meta.AffectedNodes as Array<{ ModifiedNode: { PreviousFields: Record<string, unknown>; FinalFields: Record<string, unknown> } }>;
  loanNode!.ModifiedNode.PreviousFields.Flags = LSF_OVERPAYMENT;
  loanNode!.ModifiedNode.FinalFields.Flags = LSF_OVERPAYMENT | LSF_DEFAULT;
  vaultNode!.ModifiedNode.PreviousFields = { AssetsTotal: "1000", AssetsAvailable: "250" };
  vaultNode!.ModifiedNode.FinalFields = { AssetsTotal: "100", AssetsAvailable: "350", LEVersion: 1, Scale: 6 };
  const o = parseDefaultOutcome(meta, { loanId: LOAN_ID, sharesOutstanding: SHARES });
  assert.equal(o.wasImpaired, false);
  assert.deepEqual([o.vault.before.assetsAvailable, o.vault.after.assetsAvailable], ["250", "350"]);
  assert.deepEqual([o.vault.before.lossUnrealized, o.vault.after.lossUnrealized], ["0", "0"]);
  assert.deepEqual([o.vault.before.netSharePrice, o.vault.after.netSharePrice], ["1", "0.1"]);
});

test("parseDefaultOutcome throws on metadata that isn't a default of this loan", () => {
  assert.throws(() => parseDefaultOutcome(defaultMeta, { loanId: "F".repeat(64), sharesOutstanding: SHARES }), /no modified Loan/);
  assert.throws(() => parseDefaultOutcome({ AffectedNodes: [] }, { loanId: LOAN_ID, sharesOutstanding: SHARES }), /no modified Loan/);
});

test("parseImpairOutcome: impair books the exposure as LossUnrealized (net share price drops, book price doesn't)", () => {
  const meta = {
    AffectedNodes: [
      { ModifiedNode: { LedgerEntryType: "Vault", LedgerIndex: "C".repeat(64), FinalFields: { AssetsTotal: "1000", LossUnrealized: "1000", LEVersion: 1, Scale: 6 } } },
      {
        ModifiedNode: {
          LedgerEntryType: "Loan",
          LedgerIndex: LOAN_ID,
          PreviousFields: { Flags: LSF_OVERPAYMENT },
          FinalFields: { Flags: LSF_OVERPAYMENT | LSF_IMPAIRED, NextPaymentDueDate: 846_200_000 },
        },
      },
    ],
  };
  const o = parseImpairOutcome(meta, { loanId: LOAN_ID, action: "impair", sharesOutstanding: SHARES });
  assert.equal(o.exposure, "1000");
  assert.deepEqual([o.vault.before.lossUnrealized, o.vault.after.lossUnrealized], ["0", "1000"]);
  assert.deepEqual([o.vault.before.netSharePrice, o.vault.after.netSharePrice], ["1", "0"]);
  assert.deepEqual([o.vault.before.sharePrice, o.vault.after.sharePrice], ["1", "1"]);
  assert.equal(o.nextPaymentDueDate, "2026-10-24T23:33:20.000Z");

  const undo = {
    AffectedNodes: [
      { ModifiedNode: { LedgerEntryType: "Vault", PreviousFields: { LossUnrealized: "1000" }, FinalFields: { AssetsTotal: "1000", LEVersion: 1, Scale: 6 } } },
      { ModifiedNode: { LedgerEntryType: "Loan", LedgerIndex: LOAN_ID, PreviousFields: { Flags: LSF_OVERPAYMENT | LSF_IMPAIRED }, FinalFields: { Flags: LSF_OVERPAYMENT, NextPaymentDueDate: 846_200_000 } } },
    ],
  };
  const u = parseImpairOutcome(undo, { loanId: LOAN_ID, action: "unimpair", sharesOutstanding: SHARES });
  assert.equal(u.exposure, "1000");
  assert.deepEqual([u.vault.before.netSharePrice, u.vault.after.netSharePrice], ["0", "1"]);
});

test("outcome share price uses the reads.ts formula (same number the UI shows)", () => {
  const f = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "vault-repaid.json"), "utf8")) as { ledger: RawResult; vault: RawResult; shareIssuance: RawResult };
  const v = f.vault.node as Record<string, unknown>;
  const shares = String((f.shareIssuance.node as Record<string, unknown>).OutstandingAmount);
  const meta = {
    AffectedNodes: [
      { ModifiedNode: { LedgerEntryType: "Vault", FinalFields: { AssetsTotal: v.AssetsTotal, AssetsAvailable: v.AssetsAvailable, LossUnrealized: "1", LEVersion: 1, Scale: v.Scale } } },
      { ModifiedNode: { LedgerEntryType: "Loan", LedgerIndex: LOAN_ID, PreviousFields: { Flags: 0 }, FinalFields: { Flags: LSF_IMPAIRED } } },
    ],
  };
  const o = parseImpairOutcome(meta, { loanId: LOAN_ID, action: "impair", sharesOutstanding: shares });
  assert.equal(o.vault.after.sharePrice, parseVaultSnapshot(f)!.sharePrice);
  assert.equal(o.vault.after.sharePrice, "1.000001");
  assert.equal(o.vault.after.netSharePrice, "0.999191"); // (1234.501426940925 - 1) / 1234.5, truncated
});

// ---------------------------------------------------------------- recorded devnet txs (spike:default, 2026-10-25)

interface TxFixture {
  loanId: string;
  sharesOutstanding: string;
  expectedDefaultCovered?: string;
  tx: { hash: string; result: string; tx_json: Record<string, unknown>; meta: Record<string, unknown> };
}
const txFixture = (name: string): TxFixture => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", `${name}.json`), "utf8")) as TxFixture;

test("devnet default tx: DefaultCovered = 10% of DebtTotal = expectedDefaultCovered, vault 1000 -> 100, share price 1 -> 0.1", () => {
  const f = txFixture("devnet-loan-default-tx");
  assert.equal(f.tx.result, "tesSUCCESS");
  assert.equal(f.tx.tx_json.TransactionType, "LoanManage");
  assert.equal(f.tx.tx_json.Flags, LOAN_MANAGE_FLAG.default);
  const o = parseDefaultOutcome(f.tx.meta, { loanId: f.loanId, sharesOutstanding: f.sharesOutstanding });
  assert.equal(o.accounting, "cash_basis");
  assert.equal(o.wasImpaired, true);
  // Cash basis: the exposure is the principal (1000), not TVO - management fee (1000.000342464116).
  assert.equal(o.defaultAmount, "1000");
  assert.equal(o.defaultCovered, "100");
  assert.equal(o.expectedDefaultCovered, "100");
  assert.equal(o.exact.defaultCovered, f.expectedDefaultCovered); // the spike's independent pre-default read
  assert.equal(o.vaultLoss, "900");
  assert.deepEqual(o.debtTotal, { before: "1000", after: "0" });
  assert.deepEqual(o.coverAvailable, { before: "110.000043", after: "10.000043" });
  assert.deepEqual(o.vault.before, { assetsTotal: "1000", assetsAvailable: "0", lossUnrealized: "1000", sharePrice: "1", netSharePrice: "0" });
  assert.deepEqual(o.vault.after, { assetsTotal: "100", assetsAvailable: "100", lossUnrealized: "0", sharePrice: "0.1", netSharePrice: "0.1" });
  // Loss + cover returned = exposure (XLS-66 §3.1.11 note).
  assert.equal(Number(o.exact.vaultLoss) + Number(o.exact.defaultCovered), Number(o.exact.defaultAmount));
});

test("devnet impair / unimpair txs: LossUnrealized 0 <-> 1000, net share price 1 <-> 0, NextPaymentDueDate unchanged", () => {
  const imp = txFixture("devnet-loan-impair-tx");
  const unimp = txFixture("devnet-loan-unimpair-tx");
  assert.equal(imp.tx.tx_json.Flags, LOAN_MANAGE_FLAG.impair);
  assert.equal(unimp.tx.tx_json.Flags, LOAN_MANAGE_FLAG.unimpair);
  const a = parseImpairOutcome(imp.tx.meta, { loanId: imp.loanId, action: "impair", sharesOutstanding: imp.sharesOutstanding });
  const b = parseImpairOutcome(unimp.tx.meta, { loanId: unimp.loanId, action: "unimpair", sharesOutstanding: unimp.sharesOutstanding });
  assert.equal(a.accounting, "cash_basis");
  assert.equal(a.exposure, "1000");
  assert.deepEqual([a.vault.before.lossUnrealized, a.vault.after.lossUnrealized], ["0", "1000"]);
  assert.deepEqual([a.vault.before.netSharePrice, a.vault.after.netSharePrice], ["1", "0"]);
  assert.deepEqual([a.vault.before.sharePrice, a.vault.after.sharePrice], ["1", "1"]); // getVaultSnapshot ignores the paper loss
  assert.equal(b.exposure, "1000");
  assert.deepEqual([b.vault.before.netSharePrice, b.vault.after.netSharePrice], ["0", "1"]);
  // fixCleanup3_4_0: neither moves the due date (pre-fix, impair pulled it forward to "now").
  assert.equal(a.nextPaymentDueDate, "2026-10-25T01:08:11.000Z");
  assert.equal(b.nextPaymentDueDate, a.nextPaymentDueDate);
});

test("devnet stall-path variant (600 repaid first): 10% of the 400.000190257666 still owed, rounded UP at LoanScale -12", () => {
  // spike:default with SPIKE_PREPAY=600, default tx 6FE6525D…: the ledger moved exactly 40.000019025767 (CoverAvailable
  // 110.000043 -> 70.000023974233). Unrounded, 10% is 40.0000190257666.
  const p = { debtTotal: "400.000190257666", coverRateMinimum: 10_000, coverRateLiquidation: 100_000, defaultAmount: "400.000190257666", coverAvailable: "110.000043" };
  assert.equal(expectedDefaultCovered({ ...p, loanScale: -12 }), "40.000019025767");
  assert.equal(expectedDefaultCovered(p), "40.0000190257666");
});
