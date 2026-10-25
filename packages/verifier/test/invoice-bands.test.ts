import assert from "node:assert/strict";
import { test } from "node:test";
import { MILESTONE_TEMPLATES } from "@xrlp/shared";
import { checkInvoiceMatchesBudget } from "../src/checks.ts";
import { loadEvidence } from "../src/meta.ts";
import { policyFor } from "../src/index.ts";
import { builder, project, SCENARIOS } from "../fixtures/scenarios.ts";

test("invoice bands use exact integer boundaries: 10% pass, 25% warning, beyond 25% fail", async () => {
  const input = await SCENARIOS[0]!.input();
  const inv = await loadEvidence(input.evidence.find((e) => e.kind === "invoice")!, input);
  const ctx = { project, builder, milestone: input.milestone, template: MILESTONE_TEMPLATES.residential_new[0], riskTier: builder.riskTier };
  const policy = policyFor(project, builder, input.milestone);
  for (const [total, result] of [["22500.00", "pass"], ["27500.00", "pass"], ["22499.99", "warn"], ["27500.01", "warn"], ["18750.00", "warn"], ["31250.00", "warn"], ["18749.99", "fail"], ["31250.01", "fail"]] as const) {
    assert.equal(checkInvoiceMatchesBudget(ctx, [{ ...inv, meta: { invoiceTotal: total } }], policy).result, result, total);
  }
  const extracted = checkInvoiceMatchesBudget(ctx, [{ ...inv, meta: {} }], policy, { [inv.evidence.id]: "25000.00" });
  assert.match(extracted.reason, /LLM-extracted/);
  assert.equal(checkInvoiceMatchesBudget(ctx, [{ ...inv, meta: {} }], policy, { [inv.evidence.id]: "not-money" }).result, "warn");
});
