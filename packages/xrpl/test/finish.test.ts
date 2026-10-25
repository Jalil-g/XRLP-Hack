// Security review H3 (offline): every EscrowFinish blob that carries the real fulfillment is signed right after its own
// preflight and submitted pre-signed; nothing re-signs it without a fresh preflight.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LedgerError } from "@xrlp/shared";
import { decode, DisconnectedError, Wallet } from "xrpl";
import { toAdapterError } from "../src/adapter-map.ts";
import { XrplTxError, toErrorCode } from "../src/errors.ts";
import type { TxResult } from "../src/client.ts";
import { finishEscrow, type FinishEscrowDeps } from "../src/escrow.ts";
import { UnsafeReleaseError, type PreflightRequest, type PreflightResult } from "../src/preflight.ts";
import { testConditionPair } from "./support/conditions.ts";

const OWNER = Wallet.generate().classicAddress;
const pair = testConditionPair();

function preflightOk(ledgerIndex: number, req: PreflightRequest): PreflightResult {
  return {
    ok: true,
    failures: [],
    details: {
      ledgerIndex,
      ledgerCloseTime: 846_000_000 + ledgerIndex,
      owner: req.owner,
      offerSequence: req.offerSequence,
      effectiveMarginS: 300,
      conditionChecked: true,
      recommendedFee: "36",
      lastLedgerSequence: ledgerIndex + (req.lastLedgerOffset ?? 20),
    },
  };
}

const refused = (reason: "no_trustline" | "expired_or_too_close"): PreflightResult => ({
  ok: false,
  reason,
  message: `refused: ${reason}`,
  code: "unsafe_release",
  failures: [{ reason, message: `refused: ${reason}` }],
  details: { ledgerIndex: 1, ledgerCloseTime: 1, owner: OWNER, offerSequence: 7, effectiveMarginS: 300, conditionChecked: true, recommendedFee: "36", lastLedgerSequence: 61 },
});

/** Fake network: scripted preflights and submits; records what was signed and in which order. */
function world(o: { preflights: ((req: PreflightRequest) => PreflightResult)[]; submits: ((blob: string) => TxResult)[] }) {
  const log: string[] = [];
  const signed: Record<string, unknown>[] = [];
  let ledger = 1000;
  let sequence = 50;
  const deps: FinishEscrowDeps = {
    preflightFinish: async (req) => {
      ledger += 10;
      log.push(`preflight@${ledger}`);
      const next = o.preflights.shift();
      assert.ok(next, "unexpected preflight");
      return next({ ...req, offerSequence: req.offerSequence });
    },
    prepare: async (tx) => ({ ...tx, Sequence: sequence++ }),
    submitBlob: async (blob) => {
      const tx = decode(blob) as Record<string, unknown>;
      signed.push(tx);
      log.push(`submit LLS=${String(tx.LastLedgerSequence)}`);
      const next = o.submits.shift();
      assert.ok(next, "unexpected submit");
      return next(blob);
    },
  };
  return { deps, log, signed, ledgerNow: () => ledger };
}

const ok = (blob: string): TxResult => ({ hash: "F".repeat(64), explorerUrl: "x", result: "tesSUCCESS", tx: decode(blob) as Record<string, unknown>, meta: {} });
const expired = (): TxResult => {
  throw new XrplTxError("EscrowFinish", "tefMAX_LEDGER", undefined, { retriable: true, detail: "pre-signed blob must be re-prepared" });
};

test("H3: each finish blob is signed right after its own preflight; a provably dead blob → fresh preflight, rebuilt once", async () => {
  const w = world({ preflights: [(r) => preflightOk(1010, r), (r) => preflightOk(1020, r)], submits: [expired, ok] });
  const submitter = Wallet.generate();
  const tx = await finishEscrow({ submitter, owner: OWNER, offerSequence: 7, condition: pair.condition, fulfillment: pair.fulfillment }, w.deps);
  assert.equal(tx.result, "tesSUCCESS");
  // preflight → submit → preflight → submit: never two submits without a preflight between them.
  assert.deepEqual(w.log, ["preflight@1010", "submit LLS=1070", "preflight@1020", "submit LLS=1080"]);
  for (const t of w.signed) {
    assert.equal(t.Fulfillment, pair.fulfillment);
    assert.equal(t.Fee, "36", "Fee from preflight");
    assert.equal(t.Account, submitter.classicAddress);
  }
  assert.notEqual(w.signed[0]!.Sequence, w.signed[1]!.Sequence);
});

test("H3: the first preflight refusing → UnsafeReleaseError, nothing signed or submitted", async () => {
  const w = world({ preflights: [() => refused("no_trustline")], submits: [] });
  await assert.rejects(finishEscrow({ submitter: Wallet.generate(), owner: OWNER, offerSequence: 7, condition: pair.condition, fulfillment: pair.fulfillment }, w.deps), (e: unknown) => {
    assert.ok(e instanceof UnsafeReleaseError);
    assert.equal(toErrorCode(e), "unsafe_release");
    return true;
  });
  assert.deepEqual(w.signed, []);
});

test("H3: the rebuild's preflight refusing is NOT unsafe_release (the first blob may have been broadcast)", async () => {
  const w = world({ preflights: [(r) => preflightOk(1010, r), () => refused("expired_or_too_close")], submits: [expired] });
  await assert.rejects(finishEscrow({ submitter: Wallet.generate(), owner: OWNER, offerSequence: 7, condition: pair.condition, fulfillment: pair.fulfillment }, w.deps), (e: unknown) => {
    assert.ok(e instanceof XrplTxError && !(e instanceof UnsafeReleaseError));
    assert.equal(e.engineResult, "preflight_refused_after_submit");
    assert.equal(e.retriable, false);
    assert.equal(toErrorCode(e), "ledger_error");
    assert.match(e.message, /expired_or_too_close/);
    return true;
  });
  assert.equal(w.signed.length, 1);
});

test("H3: an unknown outcome is never rebuilt; a wrong fulfillment is refused before any preflight", async () => {
  const unknown = (): TxResult => {
    throw new XrplTxError("EscrowFinish", "unknown_outcome", "A".repeat(64), { retriable: false });
  };
  const w = world({ preflights: [(r) => preflightOk(1010, r)], submits: [unknown] });
  await assert.rejects(finishEscrow({ submitter: Wallet.generate(), owner: OWNER, offerSequence: 7, condition: pair.condition, fulfillment: pair.fulfillment }, w.deps), /unknown_outcome/);
  assert.equal(w.signed.length, 1, "no second finish while the first may still apply");

  const none = world({ preflights: [], submits: [] });
  await assert.rejects(
    finishEscrow({ submitter: Wallet.generate(), owner: OWNER, offerSequence: 7, condition: pair.condition, fulfillment: testConditionPair().fulfillment }, none.deps),
    /fulfillment does not match escrow condition/,
  );
  assert.deepEqual(none.log, []);
});

test("H3: lastLedgerMargin outside 1..500 is refused before anything is read", async () => {
  const w = world({ preflights: [], submits: [] });
  await assert.rejects(
    finishEscrow({ submitter: Wallet.generate(), owner: OWNER, offerSequence: 7, condition: pair.condition, fulfillment: pair.fulfillment, lastLedgerMargin: 5000 }, w.deps),
    /lastLedgerMargin must be an integer in 1\.\.500/,
  );
  assert.deepEqual(w.log, []);
});

// Known medium finding: a failure BEFORE any finish blob was submitted must be `unsafe_release` (core keeps the release
// key), never a generic error (core would mark the key exposed and the milestone could never release).
test("pre-submit failures (preflight read, autofill, socket down before submit) → unsafe_release, nothing sent", async () => {
  const run = (deps: Partial<FinishEscrowDeps>) =>
    finishEscrow({ submitter: Wallet.generate(), owner: OWNER, offerSequence: 7, condition: pair.condition, fulfillment: pair.fulfillment }, deps);
  const isUnsafe = (e: unknown) => {
    assert.ok(e instanceof LedgerError, `got ${String(e)}`);
    assert.equal(e.code, "unsafe_release");
    assert.equal(toErrorCode(e), "unsafe_release");
    const mapped = toAdapterError(e, "finishEscrow");
    assert.equal(mapped.code, "unsafe_release", "adapter keeps it");
    assert.ok(!e.message.includes(pair.fulfillment));
    return true;
  };
  const w = world({ preflights: [(r) => preflightOk(1010, r)], submits: [] });

  // websocket drop during preflight's ledger reads
  await assert.rejects(run({ ...w.deps, preflightFinish: async () => Promise.reject(new DisconnectedError("websocket closed")) }), isUnsafe);
  // autofill fails after a good preflight
  await assert.rejects(run({ ...w.deps, prepare: async () => Promise.reject(new DisconnectedError("websocket closed")) }), isUnsafe);
  assert.deepEqual(w.signed, []);

  // the engine proves nothing was sent (socket down before the first submit): retriable → one rebuild, also unsent
  const unsent = (): TxResult => {
    throw new XrplTxError("EscrowFinish", "not_applied", undefined, { retriable: true, notSent: true });
  };
  const twice = world({ preflights: [(r) => preflightOk(1010, r), (r) => preflightOk(1020, r)], submits: [unsent, unsent] });
  await assert.rejects(run(twice.deps), isUnsafe);
  // …and if the rebuild's preflight then refuses, that is the plain UnsafeReleaseError (nothing was ever broadcast)
  const thenRefused = world({ preflights: [(r) => preflightOk(1010, r), () => refused("expired_or_too_close")], submits: [unsent] });
  await assert.rejects(run(thenRefused.deps), (e: unknown) => e instanceof UnsafeReleaseError && e.reason === "expired_or_too_close");
  // the engine's "socket down before this call submitted anything" (connection_lost + notSent) is unsafe_release too
  const unsentFatal = (): TxResult => {
    throw new XrplTxError("EscrowFinish", "connection_lost", "A".repeat(64), { notSent: true });
  };
  await assert.rejects(run(world({ preflights: [(r) => preflightOk(1010, r)], submits: [unsentFatal] }).deps), isUnsafe);
});

test("a finish that may have been sent keeps its ledger error (core reconciles / marks the key exposed)", async () => {
  const lost = (): TxResult => {
    throw new XrplTxError("EscrowFinish", "connection_lost", "A".repeat(64));
  };
  const w = world({ preflights: [(r) => preflightOk(1010, r)], submits: [lost] });
  await assert.rejects(finishEscrow({ submitter: Wallet.generate(), owner: OWNER, offerSequence: 7, condition: pair.condition, fulfillment: pair.fulfillment }, w.deps), (e: unknown) => {
    assert.ok(e instanceof XrplTxError && e.engineResult === "connection_lost");
    assert.equal(toAdapterError(e).code, "ledger_error");
    return true;
  });
  // first blob provably dead (retriable, but it was sent), then the rebuild's autofill fails → NOT unsafe_release
  const dead = (): TxResult => {
    throw new XrplTxError("EscrowFinish", "tefMAX_LEDGER", undefined, { retriable: true });
  };
  let prepares = 0;
  const w2 = world({ preflights: [(r) => preflightOk(1010, r), (r) => preflightOk(1020, r)], submits: [dead] });
  const prepare = w2.deps.prepare;
  await assert.rejects(
    finishEscrow({ submitter: Wallet.generate(), owner: OWNER, offerSequence: 7, condition: pair.condition, fulfillment: pair.fulfillment }, {
      ...w2.deps,
      prepare: async (tx, m) => (++prepares === 2 ? Promise.reject(new DisconnectedError("websocket closed")) : prepare(tx, m)),
    }),
    (e: unknown) => !(e instanceof LedgerError) && e instanceof DisconnectedError,
  );
});
