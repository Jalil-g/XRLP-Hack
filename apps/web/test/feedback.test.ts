import assert from "node:assert/strict";
import { test } from "node:test";
import { ErrorCode } from "@xrlp/shared";
import { ApiError, api } from "../lib/api.ts";
import { ERROR_FEEDBACK, errorFeedback } from "../lib/error-feedback.ts";
import { cancelFeedback, checksFeedback, decisionFeedback } from "../lib/action-feedback.ts";

test("every shared error code has distinct readable copy and a recovery step", () => {
  for (const code of ErrorCode.options) {
    const feedback = errorFeedback(new ApiError(code, `server detail: ${code}`));
    assert.equal(feedback.title, ERROR_FEEDBACK[code].title);
    assert.ok(feedback.description.length > 30);
    assert.equal(feedback.detail, `server detail: ${code}`);
  }
  assert.equal(new Set(Object.values(ERROR_FEEDBACK).map((copy) => copy.title)).size, 11);
});

test("unknown and malformed payloads stay renderable and preserve genuine diagnostics", () => {
  for (const body of [null, "html", { error: "broken" }, { error: { code: "__proto__", message: {} } }]) {
    const error = ApiError.fromBody(body, 502);
    assert.equal(error.code, "unknown");
    assert.equal(typeof error.message, "string");
    assert.equal(errorFeedback(error).title, "We could not confirm the result");
  }
  const tx = "A".repeat(64);
  const error = ApiError.fromBody({ error: { code: "unsafe_release", message: "Destination has no trust line", txResult: "tecNO_LINE", txHash: tx } }, 409);
  assert.equal(error.status, 409);
  assert.match(errorFeedback(error).detail!, /Destination has no trust line/);
  assert.ok(errorFeedback(error).detail!.includes(tx));
  assert.equal(errorFeedback({ code: "validation", message: { unexpected: true } }).detail, undefined);
});

test("HTTP errors and dropped connections reach the same feedback path without retries", async (t) => {
  const previousFetch = globalThis.fetch;
  const previousMode = process.env.NEXT_PUBLIC_API_MODE;
  process.env.NEXT_PUBLIC_API_MODE = "http";
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousMode === undefined) delete process.env.NEXT_PUBLIC_API_MODE;
    else process.env.NEXT_PUBLIC_API_MODE = previousMode;
  });
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({ error: { code: "needs_human", message: "Inspector review is pending" } }, { status: 409 });
  };
  await assert.rejects(api.runChecks("demo", "m1"), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(errorFeedback(error).title, "A person needs to review this");
    return true;
  });
  assert.equal(requests, 1);
  globalThis.fetch = async () => { requests++; throw new Error("connection closed"); };
  await assert.rejects(api.invest("demo", "rInvestor", "10"), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "unreachable");
    assert.match(errorFeedback(error).description, /previous request may already/);
    return true;
  });
  assert.equal(requests, 2);
});

test("passing checks and approval do not claim a release without confirmation", () => {
  const verdict = { decision: "pass" as const, checks: [] };
  assert.equal(checksFeedback({ verdict }).tone, "info");
  assert.match(checksFeedback({ verdict }).message, /not confirmed/);
  assert.equal(checksFeedback({ verdict, release: { txHash: "tx" } }).tone, "success");
  assert.equal(decisionFeedback("approve", { status: "verified" }).tone, "info");
  assert.equal(decisionFeedback("approve", { status: "released" }).tone, "success");
  assert.equal(decisionFeedback("reject", { status: "failed" }).tone, "info");
});

test("failure, human review, and a cancelled-but-not-repaid escrow remain distinct", () => {
  const failed = checksFeedback({ verdict: { decision: "fail", checks: [{ check: "gps_within_site", result: "fail", reason: "Off site", evidenceIds: [] }] } });
  assert.match(failed.message, /1 check failed/);
  assert.equal(failed.tone, "error");
  assert.equal(checksFeedback({ verdict: { decision: "needs_human", checks: [] } }).tone, "info");
  assert.equal(cancelFeedback({ status: "expired" }).tone, "info");
  assert.match(cancelFeedback({ status: "expired" }).message, /repayment.*not confirmed/);
  assert.equal(cancelFeedback({ status: "refunded" }).tone, "success");
});
