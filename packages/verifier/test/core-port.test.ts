// Compatibility with core's VerifierPort (origin/scaffold/core: packages/core/src/ports.ts).
// The interfaces below are copied from there; if core changes them, this file stops typechecking.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MILESTONE_TEMPLATES, type Builder, type Evidence, type Milestone, type MilestoneTemplate, type Project, type RiskTier, type Verdict } from "@xrlp/shared";
import { policyFor, verifyBuilder, verifyMilestone } from "../src/index.ts";
import { builder, project, SCENARIOS } from "../fixtures/scenarios.ts";

// --- copied from packages/core/src/ports.ts --------------------------------------------------
interface BuilderDocument {
  kind: "license" | "insurance" | "track_record" | "identity" | "other";
  filename: string;
  uri?: string;
  fields?: Record<string, string>;
}
interface BuilderVerification { ok: boolean; reasons: string[]; riskTier?: RiskTier }
interface MilestonePolicy { requiredInspectors: 1 | 2; riskTier: RiskTier; minConfidence: number }
interface CoreVerifyMilestoneInput {
  project: Project; builder: Builder; milestone: Milestone; template: MilestoneTemplate;
  evidence: Evidence[]; priorEvidence: Evidence[]; escrowCreatedAt?: string;
}
interface VerifierPortFns {
  verifyMilestone(input: CoreVerifyMilestoneInput): Promise<Verdict>;
  verifyBuilder(input: { builder: Builder; documents: BuilderDocument[] }): Promise<BuilderVerification>;
  policyFor(project: Project, builder: Builder, milestone: Milestone): MilestonePolicy;
}
// ---------------------------------------------------------------------------------------------

// Compile-time proof: our exports satisfy the port (adapter only needs to add `mode`).
const port: VerifierPortFns = { verifyMilestone: (i) => verifyMilestone(i), verifyBuilder, policyFor };

test("core-shaped milestone input (plain Evidence priors, template, escrowCreatedAt) works", async () => {
  const s = await SCENARIOS[1]!.input(); // B: reused photo
  const input: CoreVerifyMilestoneInput = {
    project, builder, milestone: s.milestone,
    template: MILESTONE_TEMPLATES.residential_new.find((t) => t.key === "framing")!,
    evidence: s.evidence,
    priorEvidence: (s.priorEvidence ?? []).map((p) => ("evidence" in p ? p.evidence : p)),
    escrowCreatedAt: s.timeline?.escrowCreatedAt,
  };
  process.env.DATA_DIR = s.dataDir; // core resolves uris against DATA_DIR
  const v = await port.verifyMilestone(input);
  assert.equal(v.decision, "fail");
  const dup = v.checks.find((c) => c.check === "no_duplicate_photo")!;
  assert.equal(dup.result, "fail");
  assert.match(dup.reason, /previously submitted evidence/);
});

test("core-shaped verifyBuilder with structured fields", async () => {
  const docs: BuilderDocument[] = [
    { kind: "license", filename: "license.pdf", fields: { licenseNumber: "NYC-GC-204518", holder: builder.name, expires: "2027-06-30" } },
    { kind: "insurance", filename: "coi.pdf", fields: { policyNumber: "HSB-GL-7781203", insured: builder.name, generalLiability: "2,000,000" } },
  ];
  const ok = await port.verifyBuilder({ builder, documents: docs });
  assert.equal(ok.ok, true, ok.reasons.join("\n"));
  assert.equal(ok.riskTier, "medium");
  const bad = await port.verifyBuilder({
    builder,
    documents: [{ ...docs[0]!, fields: { licenseNumber: "NYC-GC-999999", holder: "Someone Else LLC" } }, docs[1]!],
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.some((r) => r.includes("NYC-GC-999999")));
});

test("policyFor satisfies MilestonePolicy", () => {
  const p = port.policyFor(project, builder, project.milestones[0]!);
  assert.equal(p.requiredInspectors, 1);
  assert.equal(p.riskTier, "medium");
  assert.equal(p.minConfidence, 0.8);
});
