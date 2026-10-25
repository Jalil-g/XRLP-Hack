// Route 10 refusals → what the audit form offers. Core's real messages (packages/core/src/service.ts submitAudit), not only the mock's.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "../lib/api.ts";
import { submitErrorView } from "../lib/submit-error.ts";

describe("submitErrorView", () => {
  it("offers Reload evidence for core's stale-bundle refusal (http mode)", () => {
    const err = new ApiError("validation", "Audit must cover the current builder evidence bundle", 400);
    assert.deepEqual(submitErrorView(err, true), { message: err.message, stale: true, needsKey: false });
  });

  it("still recognises the mock's stale-bundle message", () => {
    const err = new ApiError("validation", "evidenceBundleHash does not match the builder evidence on file; reload and re-review", 400);
    assert.equal(submitErrorView(err, false).stale, true);
  });

  it("asks for the inspector key when devnet core refuses an unsigned audit", () => {
    const err = new ApiError("invalid_state", "A signed inspector audit is required outside fake demo mode", 403);
    const view = submitErrorView(err, false);
    assert.equal(view.needsKey, true);
    assert.equal(view.stale, false);
    assert.match(view.message, /Load your inspector key/);
  });

  it("passes other errors through unchanged", () => {
    const bad = new ApiError("validation", "Signed audit does not match the assigned inspector, project, report and uploaded photos", 400);
    assert.deepEqual(submitErrorView(bad, true), { message: bad.message, stale: false, needsKey: false });
    assert.deepEqual(submitErrorView(new Error("socket closed"), true), { message: "socket closed", stale: false, needsKey: false });
  });
});
