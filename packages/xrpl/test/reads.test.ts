// XRPL-09 read-model parsers on RECORDED devnet JSON (test/fixtures/, captured by scripts/capture-read-fixtures.ts).
// Offline: no client is created.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Rlusd } from "@xrlp/shared";
import {
  divDecimal,
  parseEscrow,
  parseEscrowList,
  parseHasRlusdTrustline,
  parseLoanSnapshot,
  parseRlusdBalance,
  parseRlusdTrustline,
  parseVaultSnapshot,
  parseXrpBalance,
  toPlainDecimal,
  toRlusd,
  type RawResult,
} from "../src/reads.ts";

// Recorded JSON; the tests assert its shape.
type Fixture = { ledger: RawResult; [k: string]: any };
const fixture = (name: string): Fixture => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", `${name}.json`), "utf8")) as Fixture;
const closeTime = (f: Fixture) => Number(f.ledger.close_time);
const isRlusd = (v: string) => Rlusd.safeParse(v).success;

test("toPlainDecimal expands rippled scientific notation", () => {
  assert.equal(toPlainDecimal("1.5e-7"), "0.00000015");
  assert.equal(toPlainDecimal("-2E3"), "-2000");
  assert.equal(toPlainDecimal("1234500000"), "1234500000");
  assert.equal(toPlainDecimal("12.3400"), "12.34");
  assert.equal(toPlainDecimal("0.000"), "0");
  assert.equal(toPlainDecimal("9999999999999999e80").length, 96);
  assert.throws(() => toPlainDecimal("abc"));
});

test("toRlusd truncates to <= 6 decimals and maps omitted fields to 0", () => {
  assert.equal(toRlusd(undefined), "0");
  assert.equal(toRlusd("1000.0002853880939045"), "1000.000285");
  assert.equal(toRlusd("100.1234567"), "100.123456");
  assert.equal(toRlusd("5e-7"), "0");
  assert.equal(toRlusd("1.5"), "1.5");
  assert.throws(() => toRlusd("-1"));
});

test("divDecimal truncates", () => {
  assert.equal(divDecimal("1234.501426940925", "1234.5", 6), "1.000001");
  assert.equal(divDecimal("1", "3", 6), "0.333333");
  assert.equal(divDecimal("1000", "1000", 6), "1");
});

test("vault snapshot: Subscription phase, one deposit", () => {
  const f = fixture("vault-subscription");
  const s = parseVaultSnapshot({ ledger: f.ledger, vault: f.vault, shareIssuance: f.shareIssuance })!;
  assert.deepEqual(s, {
    assetsTotal: "1234.5",
    assetsAvailable: "1234.5",
    sharesOutstanding: "1234500000",
    sharePrice: "1",
    subscriptionDate: "2026-10-24T22:59:27.000Z",
    redemptionDate: "2026-10-24T23:04:27.000Z",
    phase: "subscription",
  });
});

test("vault snapshot: Investment phase after LoanSet (AssetsAvailable drops by the principal)", () => {
  const f = fixture("vault-investment");
  const s = parseVaultSnapshot({ ledger: f.ledger, vault: f.vault, shareIssuance: f.shareIssuance })!;
  assert.equal(s.phase, "investment");
  assert.equal(s.assetsTotal, "1234.5");
  assert.equal(s.assetsAvailable, "234.5");
  assert.equal(s.sharePrice, "1");
});

test("vault snapshot: after repayment the share price reflects the booked interest", () => {
  const f = fixture("vault-repaid");
  const s = parseVaultSnapshot({ ledger: f.ledger, vault: f.vault, shareIssuance: f.shareIssuance })!;
  assert.equal(s.assetsTotal, "1234.501426"); // raw 1234.501426940925, truncated
  assert.equal(s.assetsAvailable, "1234.501426");
  assert.equal(s.sharesOutstanding, "1234500000");
  assert.equal(s.sharePrice, "1.000001");
  for (const v of [s.assetsTotal, s.assetsAvailable]) assert.ok(isRlusd(v), v);
});

test("vault snapshot: XRPL-01 vault with AssetsAvailable omitted (=0); phase follows ledger time", () => {
  const f = fixture("vault-xrpl01");
  assert.equal((f.vault.node as Record<string, unknown>).AssetsAvailable, undefined);
  const raw = { ledger: f.ledger, vault: f.vault, shareIssuance: f.shareIssuance };
  const s = parseVaultSnapshot(raw)!;
  assert.equal(s.assetsAvailable, "0");
  assert.equal(s.assetsTotal, "1000");
  assert.equal(s.phase, "investment");
  const red = (f.vault.node as { RedemptionDate: number }).RedemptionDate;
  const sub = (f.vault.node as { SubscriptionDate: number }).SubscriptionDate;
  assert.equal(parseVaultSnapshot({ ...raw, ledger: { ...f.ledger, close_time: red } })!.phase, "redemption");
  assert.equal(parseVaultSnapshot({ ...raw, ledger: { ...f.ledger, close_time: red - 1 } })!.phase, "investment");
  assert.equal(parseVaultSnapshot({ ...raw, ledger: { ...f.ledger, close_time: sub } })!.phase, "subscription");
});

test("vault snapshot: missing share issuance / zero shares → price 1; missing vault → undefined", () => {
  const f = fixture("vault-subscription");
  assert.equal(parseVaultSnapshot({ ledger: f.ledger, vault: f.vault })!.sharePrice, "1");
  assert.equal(parseVaultSnapshot({ ledger: f.ledger, vault: f.vault })!.sharesOutstanding, "0");
  const notFound = fixture("escrows").finished; // a recorded entryNotFound payload
  assert.equal(parseVaultSnapshot({ ledger: f.ledger, vault: notFound }), undefined);
});

test("loan snapshot: active loan", () => {
  const s = parseLoanSnapshot(fixture("loan-active").loan)!;
  assert.deepEqual(s, {
    principalOutstanding: "1000",
    totalValueOutstanding: "1000.001426",
    periodicPayment: "1000.001426",
    paymentRemaining: 1,
    nextPaymentDueDate: "2026-10-24T23:01:11.000Z",
  });
});

test("loan snapshot: XRPL-01 multisig loan (2 payments, 18-digit periodic payment)", () => {
  const s = parseLoanSnapshot(fixture("loan-xrpl01").loan)!;
  assert.equal(s.paymentRemaining, 2);
  assert.equal(s.periodicPayment, "500.000285");
  assert.equal(s.totalValueOutstanding, "1000.00057");
  for (const v of [s.principalOutstanding, s.totalValueOutstanding, s.periodicPayment]) assert.ok(isRlusd(v), v);
});

test("loan snapshot: paid-off loan (rippled omits outstanding fields and NextPaymentDueDate)", () => {
  const f = fixture("loan-paid");
  assert.equal((f.loan.node as Record<string, unknown>).PaymentRemaining, undefined);
  assert.deepEqual(parseLoanSnapshot(f.loan), {
    principalOutstanding: "0",
    totalValueOutstanding: "0",
    periodicPayment: "1000.001426",
    paymentRemaining: 0,
    nextPaymentDueDate: "",
  });
  assert.equal(parseLoanSnapshot(fixture("escrows").finished), undefined);
});

test("escrow: open RLUSD escrow (7-decimal amount truncated), sequence from the node", () => {
  const f = fixture("escrows");
  const seq = (f.sequences as { open: number }).open;
  const e = parseEscrow(f.open, closeTime(f))!;
  assert.equal(e.status, "open");
  assert.equal(e.finishable, true);
  assert.equal(e.cancellable, false);
  assert.equal(e.offerSequence, seq);
  assert.equal(e.owner, f.owner);
  assert.equal(e.destination, f.destination);
  assert.equal(e.currency, "RLUSD");
  assert.equal(e.amount, "100.123456");
  assert.match(e.condition!, /^A0258020[0-9A-F]{64}810120$/);
  assert.equal(e.cancelAfter, "2026-10-24T23:59:32.000Z");
  assert.equal(e.finishAfter, undefined);
});

test("escrow: past CancelAfter → expired (not finishable, cancellable); boundary is strict", () => {
  const f = fixture("escrows");
  const e = parseEscrow(f.expired, closeTime(f))!;
  assert.equal(e.status, "expired");
  assert.equal(e.finishable, false);
  assert.equal(e.cancellable, true);
  assert.equal(e.amount, "50");
  const atMark = parseEscrow(f.expired, e.cancelAfterRipple!)!;
  assert.equal(atMark.status, "open");
});

test("escrow: finished → entryNotFound → undefined", () => {
  const f = fixture("escrows");
  assert.equal(f.finished.error, "entryNotFound");
  assert.equal(parseEscrow(f.finished, closeTime(f)), undefined);
});

test("escrow list: account_objects → both remaining escrows, with sequences", () => {
  const f = fixture("escrows");
  const list = parseEscrowList(f.accountObjects, closeTime(f));
  const seqs = f.sequences as { open: number; expired: number };
  assert.deepEqual(
    list.map((e) => [e.offerSequence, e.status, e.amount]).sort(),
    [
      [seqs.open, "open", "100.123456"],
      [seqs.expired, "expired", "50"],
    ].sort(),
  );
});

test("balances: RLUSD trust lines and XRP", () => {
  const f = fixture("balances");
  const issuer = f.issuer;
  // investor deposited everything: line exists, balance 0
  assert.equal(parseRlusdBalance(f.investorLines), "0");
  assert.equal(parseHasRlusdTrustline(f.investorLines), true);
  assert.equal(parseHasRlusdTrustline(f.investorLines, issuer), true);
  assert.equal(parseHasRlusdTrustline(f.investorLines, "rNotTheIssuer"), false);
  // no lines at all
  assert.equal(parseRlusdBalance(f.noTrustLines), "0");
  assert.equal(parseHasRlusdTrustline(f.noTrustLines), false);
  // issuer side: negative balances, own limit 0 → no holding, no opt-in
  const issuerLine = parseRlusdTrustline(f.issuerLines)!;
  assert.equal(issuerLine.balance, "0");
  assert.equal(issuerLine.limit, "0");
  assert.equal(parseHasRlusdTrustline(f.issuerLines), false);
  // unfunded account: actNotFound
  assert.equal(f.unfundedLines.error, "actNotFound");
  assert.equal(parseRlusdBalance(f.unfundedLines), "0");
  assert.equal(parseHasRlusdTrustline(f.unfundedLines), false);
  assert.equal(parseXrpBalance(f.unfundedInfo), "0");
  // XRP: drops → decimal
  assert.equal(parseXrpBalance(f.investorInfo), "99.999998");
});

test("balances: builder holding RLUSD from a finished escrow", () => {
  const f = fixture("escrows");
  assert.equal(parseRlusdBalance(f.builderLines), "25");
  assert.equal(parseHasRlusdTrustline(f.builderLines), true);
});

test("balances: frozen line is not usable", () => {
  const f = fixture("escrows");
  const lines = (f.builderLines.lines as Record<string, unknown>[]).map((l) => ({ ...l, freeze_peer: true }));
  assert.equal(parseHasRlusdTrustline({ ...f.builderLines, lines }), false);
});
