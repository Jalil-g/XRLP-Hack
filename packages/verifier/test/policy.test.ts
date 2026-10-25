import assert from "node:assert/strict";
import { test } from "node:test";
import type { Builder, Milestone, Project } from "@xrlp/shared";
import { policyFor } from "../src/index.ts";
import { builder, project } from "../fixtures/scenarios.ts";

const ms = (amount: string): Milestone => ({ ...project.milestones[0]!, amount });
const b = (patch: Partial<Builder>): Builder => ({ ...builder, ...patch });
const p = (patch: Partial<Project>): Project => ({ ...project, ...patch });

test("one inspector for a normal milestone, two at/above TWO_INSPECTOR_THRESHOLD", () => {
  assert.equal(policyFor(project, builder, ms("25000.00")).requiredInspectors, 1);
  assert.equal(policyFor(project, builder, ms("49999.99")).requiredInspectors, 1);
  assert.equal(policyFor(project, builder, ms("50000.00")).requiredInspectors, 2);
  assert.equal(policyFor(project, builder, ms("50000.00")).highValue, true);
});

test("high-risk builder: two inspectors, GPS mismatch is a hard fail, stricter thresholds", () => {
  const high = policyFor(project, b({ riskTier: "high" }), ms("10000.00"));
  const med = policyFor(project, builder, ms("10000.00"));
  assert.equal(high.requiredInspectors, 2);
  assert.equal(high.checks.gps_within_site.onFail, "fail");
  assert.equal(med.checks.gps_within_site.onFail, "needs_human");
  assert.ok(high.thresholds.invoiceUnderTolerancePct < med.thresholds.invoiceUnderTolerancePct);
  assert.ok(high.thresholds.minLlmConfidence > med.thresholds.minLlmConfidence);
  assert.ok(high.thresholds.phashFailDistance >= med.thresholds.phashFailDistance, "more sensitive to reuse");
  assert.equal(high.checks.document_consistency.onFail, "fail");
});

test("low-risk builder: soft signals ignored, invoice shortfall goes to a human", () => {
  const low = policyFor(project, b({ riskTier: "low" }), ms("10000.00"));
  assert.equal(low.checks.gps_within_site.onWarn, "ignore");
  assert.equal(low.checks.photo_fresh.onWarn, "ignore");
  assert.equal(low.checks.invoice_matches_budget.onFail, "needs_human");
  // ...but reuse is never forgiven
  assert.equal(low.checks.no_duplicate_photo.onFail, "fail");
});

test("high value tightens invoice tolerance and raises AI confidence bar", () => {
  const big = policyFor(project, b({ riskTier: "low" }), ms("80000.00"));
  assert.equal(big.thresholds.invoiceUnderTolerancePct, 3);
  assert.equal(big.thresholds.minLlmConfidence, 0.75);
  assert.equal(big.checks.invoice_matches_budget.onWarn, "needs_human");
});

test("project type changes the policy", () => {
  const reno = policyFor(p({ type: "residential_renovation" }), builder, ms("10000.00"));
  const comm = policyFor(p({ type: "commercial_small" }), builder, ms("10000.00"));
  const base = policyFor(project, builder, ms("10000.00"));
  assert.ok(reno.thresholds.gpsSlackM > base.thresholds.gpsSlackM);
  assert.equal(reno.checks.gps_within_site.onWarn, "ignore");
  assert.ok(comm.thresholds.maxPhotoAgeDays <= 21);
  assert.equal(comm.checks.document_consistency.onWarn, "needs_human");
});

test("unverified builder can never auto-pass", () => {
  assert.equal(policyFor(project, b({ verified: false }), ms("1000.00")).allowAutoPass, false);
  assert.equal(policyFor(project, builder, ms("1000.00")).allowAutoPass, true);
});
