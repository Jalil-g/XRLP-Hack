// Shared v2 contract alignment (#53): error mapping onto ErrorCode / LedgerError, ChainEvent kinds + result,
// shared snapshot shapes. Offline: no client is created.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ChainEvent, ErrorCode, LedgerError, TooSoonError, type ChainEventKind, type EscrowSnapshot, type VaultSnapshot } from "@xrlp/shared";
import { ATTEST_EVENT_KIND } from "../src/compliance.ts";
import { RLUSD_CURRENCY } from "../src/config.ts";
import { XrplTxError, toErrorCode, toLedgerError, withLedgerErrors } from "../src/errors.ts";
import { toChainEvent } from "../src/events.ts";
import { UnsafeReleaseError, evaluatePreflight, unsafeReleaseError, type PreflightResult } from "../src/preflight.ts";
import { findTrustLine, parseEscrow, parseVaultSnapshot, toEscrowSnapshot, type RawResult } from "../src/reads.ts";

type Fixture = { ledger: RawResult; [k: string]: any };
const fixture = (name: string): Fixture => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", `${name}.json`), "utf8")) as Fixture;

const HASH = "A".repeat(64);
const tx = (result = "tesSUCCESS") => ({ hash: HASH, explorerUrl: `https://devnet.xrpl.org/transactions/${HASH}`, result });

/** A refused preflight (escrow gone). */
const refused = (): PreflightResult =>
  evaluatePreflight({ request: { owner: "rSpv", offerSequence: 7 }, escrow: null, baseFeeDrops: 10 }, { ledgerIndex: 1, closeTime: 1 });

// ---------------------------------------------------------------- errors

test("toErrorCode returns shared ErrorCode values", () => {
  const cases: unknown[] = [
    new XrplTxError("LoanSet", "tecTOO_SOON", "H"),
    new XrplTxError("EscrowFinish", "tecNO_TARGET", "H"),
    new XrplTxError("Payment", "temBAD_AMOUNT"),
    new XrplTxError("Payment", "tecUNFUNDED_PAYMENT", "H"),
    new UnsafeReleaseError(refused()),
    refused(),
    unsafeReleaseError(refused()),
    new TooSoonError("wait"),
    { data: { error: "objectNotFound" } },
    new Error("boom"),
  ];
  for (const e of cases) assert.equal(ErrorCode.safeParse(toErrorCode(e)).success, true);
});

test("toErrorCode: preflight refusals → unsafe_release; shared LedgerError keeps its code", () => {
  assert.equal(toErrorCode(new UnsafeReleaseError(refused())), "unsafe_release");
  assert.equal(toErrorCode(refused()), "unsafe_release");
  assert.equal(toErrorCode(unsafeReleaseError(refused())), "unsafe_release");
  assert.equal(toErrorCode(new TooSoonError("wait")), "too_soon");
  assert.equal(toErrorCode(new LedgerError("ledger_error", "x")), "ledger_error");
  // An ok preflight result is not a refusal.
  assert.equal(toErrorCode({ ok: true, failures: [] }), "ledger_error");
});

test("UnsafeReleaseError is a shared LedgerError (code unsafe_release)", () => {
  const e = new UnsafeReleaseError(refused());
  assert.ok(e instanceof LedgerError);
  assert.equal(e.code, "unsafe_release");
  assert.equal(e.name, "UnsafeReleaseError");
  assert.equal(e.reason, "escrow_not_found");
  assert.equal(toLedgerError(e), e);
});

test("toLedgerError: tecTOO_SOON → TooSoonError with tx details", () => {
  const src = new XrplTxError("LoanSet", "tecTOO_SOON", HASH);
  const e = toLedgerError(src);
  assert.ok(e instanceof TooSoonError);
  assert.equal(e.code, "too_soon");
  assert.equal(e.txResult, "tecTOO_SOON");
  assert.equal(e.txHash, HASH);
  assert.equal(e.message, src.message);
  assert.equal(e.cause, src);
});

test("toLedgerError: other tx failures → ledger_error; hash only when on a ledger", () => {
  const tec = toLedgerError(new XrplTxError("EscrowFinish", "tecCRYPTOCONDITION_ERROR", HASH));
  assert.ok(!(tec instanceof TooSoonError));
  assert.equal(tec.code, "ledger_error");
  assert.equal(tec.txResult, "tecCRYPTOCONDITION_ERROR");
  assert.equal(tec.txHash, HASH);
  const tef = toLedgerError(new XrplTxError("Payment", "tefMAX_LEDGER", undefined, { retriable: true }));
  assert.equal(tef.txResult, "tefMAX_LEDGER");
  assert.equal(tef.txHash, undefined);
});

test("toLedgerError: refused preflight → unsafe_release; unknown → ledger_error; LedgerError passes through", () => {
  const r = refused();
  const fromResult = toLedgerError(r);
  assert.equal(fromResult.code, "unsafe_release");
  assert.equal(fromResult.message, r.message);
  assert.equal(toLedgerError(unsafeReleaseError(r)).code, "unsafe_release");
  const plain = new Error("socket hang up");
  const e = toLedgerError(plain);
  assert.equal(e.code, "ledger_error");
  assert.equal(e.message, "socket hang up");
  assert.equal(e.cause, plain);
  assert.equal(toLedgerError("weird").message, "weird");
  const shared = new TooSoonError("wait");
  assert.equal(toLedgerError(shared), shared);
});

test("withLedgerErrors rethrows as LedgerError, passes values through", async () => {
  assert.equal(await withLedgerErrors(async () => 42), 42);
  await assert.rejects(
    withLedgerErrors(async () => {
      throw new XrplTxError("VaultWithdraw", "tecTOO_SOON", HASH);
    }),
    (e: unknown) => e instanceof TooSoonError && e.txHash === HASH,
  );
});

// ---------------------------------------------------------------- events

test("toChainEvent output parses as a shared ChainEvent for every kind xrpl emits", () => {
  const kinds: ChainEventKind[] = [
    "cover_deposited",
    "verification_fee_paid",
    "credential_issued",
    "credential_accepted",
    "release_refused",
    ...Object.values(ATTEST_EVENT_KIND),
  ];
  for (const kind of kinds) {
    const ev = toChainEvent(tx(), { projectId: "p1", kind, milestoneId: "m1", actor: "rQL25XCW6mnGciVPsSfbii5pnFH28bPpGP", amount: "250.1234567" });
    assert.deepEqual(ChainEvent.parse(ev), ev);
    assert.equal(ev.amount, "250.123456");
  }
});

test("ATTEST_EVENT_KIND uses the shared v2 kinds (release → approval_attested)", () => {
  assert.deepEqual(ATTEST_EVENT_KIND, { audit: "audit_attested", verdict: "verdict_attested", decision: "decision_attested", release: "approval_attested" });
});

test("toChainEvent: result only when not tesSUCCESS (from tx or explicit); at override", () => {
  assert.equal("result" in toChainEvent(tx(), { projectId: "p1", kind: "escrow_finished" }), false);
  const steal = toChainEvent(tx("tecCRYPTOCONDITION_ERROR"), { projectId: "p1", kind: "release_refused" });
  assert.equal(steal.result, "tecCRYPTOCONDITION_ERROR");
  assert.equal(toChainEvent({ hash: HASH, explorerUrl: tx().explorerUrl }, { projectId: "p1", kind: "release_refused", result: "tecNO_PERMISSION" }).result, "tecNO_PERMISSION");
  const at = "2026-10-25T12:00:00.000Z";
  assert.equal(toChainEvent(tx(), { projectId: "p1", kind: "loan_set", at }).at, at);
  assert.equal(ChainEvent.safeParse(steal).success, true);
});

// ---------------------------------------------------------------- reads

test("toEscrowSnapshot: recorded escrow → shared EscrowSnapshot", () => {
  const f = fixture("escrows");
  const seq = (f.sequences as { open: number }).open;
  const snap: EscrowSnapshot = toEscrowSnapshot(parseEscrow(f.open, Number(f.ledger.close_time))!, seq);
  assert.deepEqual(Object.keys(snap).sort(), ["amount", "cancelAfter", "condition", "destination", "offerSequence", "owner"]);
  assert.equal(snap.owner, f.owner);
  assert.equal(snap.offerSequence, seq);
  assert.equal(snap.destination, f.destination);
  assert.equal(snap.amount, "100.123456");
  assert.equal(snap.cancelAfter, "2026-10-24T23:59:32.000Z");
  assert.match(snap.condition!, /^A0258020/);
  // No Sequence on the node and none passed → can't address the escrow.
  const { offerSequence: _s, ...view } = parseEscrow(f.open, Number(f.ledger.close_time))!;
  assert.throws(() => toEscrowSnapshot({ ...view, offerSequence: undefined }));
  assert.equal(toEscrowSnapshot({ ...view, offerSequence: undefined }, 99).offerSequence, 99);
});

test("parseVaultSnapshot returns the shared VaultSnapshot", () => {
  const f = fixture("vault-subscription");
  const v: VaultSnapshot | undefined = parseVaultSnapshot({ ledger: f.ledger, vault: f.vault, shareIssuance: f.shareIssuance });
  assert.ok(v);
  assert.deepEqual(Object.keys(v).sort(), ["assetsAvailable", "assetsTotal", "phase", "redemptionDate", "sharePrice", "sharesOutstanding", "subscriptionDate"]);
});

test("findTrustLine: raw line by currency; null for no line / unfunded account; throws other errors", () => {
  const f = fixture("balances");
  const line = findTrustLine(f.investorLines, RLUSD_CURRENCY)!;
  assert.equal(line.account, f.issuer);
  assert.equal(line.limit, "1000000000");
  assert.equal(findTrustLine(f.investorLines, "USD"), null);
  assert.equal(findTrustLine(f.unfundedLines, RLUSD_CURRENCY), null);
  assert.throws(() => findTrustLine({ error: "noNetwork" }, RLUSD_CURRENCY));
});
