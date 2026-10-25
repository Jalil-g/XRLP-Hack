import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Evidence } from "@xrlp/shared";
import { SCENARIOS, FIXTURES_DIR, fixtureEvidence, project } from "../fixtures/scenarios.ts";
import { checkLienWaiverPresent, checkLienWaivers } from "../src/checks.ts";
import type { LoadedEvidence, PriorEvidence } from "../src/types.ts";
import { verifyMilestoneDetailed } from "../src/verifyMilestone.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAPLE = join(HERE, "../fixtures/evidence/maple-st");

async function loaded(rel: string, kind: Evidence["kind"]): Promise<LoadedEvidence> {
  const path = join(MAPLE, rel);
  const bytes = await readFile(path);
  const text = bytes.toString("utf8");
  const filename = rel.split("/").pop()!;
  return {
    evidence: {
      id: `ev_${filename}`,
      kind,
      filename,
      mimeType: "text/plain",
      uri: path,
      sha256: `fixture-${filename}`,
      meta: {},
      uploadedAt: "2026-10-24T20:00:00Z",
    },
    bytes,
    sha256: `fixture-${filename}`,
    meta: {},
    text,
  };
}

test("fixture waivers cover the current conditional and previous unconditional draws", async () => {
  const current = await Promise.all([
    loaded("framing/invoice_BLS-88310.txt", "invoice"),
    loaded("waivers/conditional_BLS-88310.txt", "document"),
    loaded("waivers/unconditional_GRM-24117.txt", "document"),
  ]);
  const previous = [await loaded("foundation/invoice_GRM-24117.txt", "invoice")];
  assert.equal(checkLienWaiverPresent(current, previous, { previousRequired: true }).result, "pass");
  assert.equal(checkLienWaivers(current, previous).result, "pass");
});

test("fixture cases fail closed on a missing waiver and exact-cent amount mismatch", async () => {
  const invoice = await loaded("framing/invoice_BLS-88310.txt", "invoice");
  const conditional = await loaded("waivers/conditional_BLS-88310.txt", "document");
  const previous = [await loaded("foundation/invoice_GRM-24117.txt", "invoice")];
  const missing = checkLienWaiverPresent([invoice, conditional], previous, { previousRequired: true });
  assert.equal(missing.result, "fail");
  assert.match(missing.reason, /missing unconditional lien waiver/i);

  const wrong = await loaded("waivers/unconditional_GRM-24117_wrong_amount.txt", "document");
  const mismatch = checkLienWaivers([invoice, conditional, wrong], previous);
  assert.equal(mismatch.result, "fail");
  assert.match(mismatch.reason, /20,000\.00 RLUSD.*24,850\.00 RLUSD/);
});

test("unreadable waiver fields require human reconciliation", async () => {
  const invoice = await loaded("framing/invoice_BLS-88310.txt", "invoice");
  const bad = await loaded("waivers/conditional_BLS-88310.txt", "document");
  bad.text = "CONDITIONAL LIEN WAIVER\nInvoice No: BLS-88310";
  assert.equal(checkLienWaivers([invoice, bad]).result, "warn");
});

test("missing previous-draw invoice evidence skips rather than showing a false failure", async () => {
  const invoice = await loaded("framing/invoice_BLS-88310.txt", "invoice");
  const conditional = await loaded("waivers/conditional_BLS-88310.txt", "document");
  const result = checkLienWaiverPresent([invoice, conditional], [], {
    previousRequired: true,
  });
  assert.equal(result.result, "skipped");
  assert.match(result.reason, /previous-draw invoice evidence is unavailable/i);
});

test("sub-cent waiver amounts are not silently truncated", async () => {
  const invoice = await loaded("framing/invoice_BLS-88310.txt", "invoice");
  const waiver = await loaded("waivers/conditional_BLS-88310.txt", "document");
  waiver.text = waiver.text!.replace("29,760.00", "29,760.001");
  const result = checkLienWaivers([invoice, waiver]);
  assert.equal(result.result, "warn");
  assert.match(result.reason, /unreadable monetary amount/i);
});

test("milestone runner loads the immediately previous draw invoice and emits both waiver checks", async () => {
  const input = await SCENARIOS[1]!.input();
  const conditional = await fixtureEvidence("evidence/maple-st/waivers/conditional_BLS-88310.txt", "document");
  const unconditional = await fixtureEvidence("evidence/maple-st/waivers/unconditional_GRM-24117.txt", "document");
  const priorInvoice = await fixtureEvidence("evidence/maple-st/foundation/invoice_GRM-24117.txt", "invoice");
  const prior: PriorEvidence = {
    evidence: priorInvoice,
    projectId: project.id,
    milestoneId: project.milestones[0]!.id,
    projectName: project.name,
  };
  const result = await verifyMilestoneDetailed({
    ...input,
    evidence: [...input.evidence, conditional, unconditional],
    priorEvidence: [...(input.priorEvidence ?? []), prior],
    dataDir: FIXTURES_DIR,
    mode: "mock",
  });
  assert.equal(result.checks.find((check) => check.check === "lien_waiver_present")?.result, "pass");
  assert.equal(result.checks.find((check) => check.check === "lien_waiver_matches_invoices")?.result, "pass");
});

test("milestone runner skips previous-draw waiver presence when prior invoices are unavailable", async () => {
  const input = await SCENARIOS[1]!.input();
  const conditional = await fixtureEvidence("evidence/maple-st/waivers/conditional_BLS-88310.txt", "document");
  const result = await verifyMilestoneDetailed({
    ...input,
    evidence: [...input.evidence, conditional],
    priorEvidence: (input.priorEvidence ?? []).map((record) => "evidence" in record ? record.evidence : record),
    dataDir: FIXTURES_DIR,
    mode: "mock",
  });
  const presence = result.checks.find((check) => check.check === "lien_waiver_present");
  assert.equal(presence?.result, "skipped");
  assert.match(presence?.reason ?? "", /previous-draw invoice evidence is unavailable/i);
});
