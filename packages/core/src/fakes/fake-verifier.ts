// Deterministic VerifierPort for demos/tests. Same evidence in -> same verdict out.
// Rules (each becomes a CheckResult):
//   required_evidence_present  fail if fewer files of a kind than the template requires
//   no_duplicate_photo         fail if a photo's sha256/perceptualHash appeared in priorEvidence (or twice in this round)
//   photo_fresh                fail if EXIF takenAt is before the escrow was created; warn if missing
//   gps_within_site            fail if photo GPS is outside project.siteGeo radius; warn if missing
//   invoice_matches_budget     warn if invoice total > 110% of milestone amount; skipped if no totals
//   stage_visually_consistent  needs_human if any filename contains "unclear"/"blurry" (demo hook)
// Decision: any fail -> "fail"; any needs-human hook or >=2 warns -> "needs_human"; else "pass".
// TODO(adapters): replace with src/adapters/claude-verifier.ts wrapping @xrlp/verifier (see ports.ts).
import { TWO_INSPECTOR_THRESHOLD, type CheckResult, type Evidence, type RiskTier, type Verdict } from "@xrlp/shared";
import { systemClock, type Clock } from "../clock.ts";
import { toMicro } from "../money.ts";
import type { BuilderVerification, MilestonePolicy, VerifierPort, VerifyMilestoneInput } from "../ports.ts";

const MIN_CONFIDENCE: Record<RiskTier, number> = { low: 0.7, medium: 0.8, high: 0.9 };

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export class FakeVerifier implements VerifierPort {
  readonly mode = "fake" as const;
  constructor(private readonly clock: Clock = systemClock) {}

  policyFor(...[, builder, milestone]: Parameters<VerifierPort["policyFor"]>): MilestonePolicy {
    const big = toMicro(milestone.amount) >= BigInt(TWO_INSPECTOR_THRESHOLD) * 1_000_000n;
    return {
      requiredInspectors: big || builder.riskTier === "high" ? 2 : 1,
      riskTier: builder.riskTier,
      minConfidence: MIN_CONFIDENCE[builder.riskTier],
    };
  }

  async verifyBuilder({ builder, documents }: Parameters<VerifierPort["verifyBuilder"]>[0]): Promise<BuilderVerification> {
    const reasons: string[] = [];
    let ok = true;
    const has = (k: string) => documents.some((d) => d.kind === k);
    if (!builder.licenseNumber.trim() || !has("license")) {
      ok = false;
      reasons.push("Missing contractor license document");
    } else reasons.push(`License ${builder.licenseNumber} found in (mock) state registry`);
    if (!builder.insurancePolicy.trim() || !has("insurance")) {
      ok = false;
      reasons.push("Missing general liability insurance certificate");
    } else reasons.push(`Insurance policy ${builder.insurancePolicy} active (mock carrier lookup)`);
    for (const d of documents) {
      const status = d.fields?.status?.toLowerCase();
      if (status === "revoked" || status === "expired") {
        ok = false;
        reasons.push(`${d.kind} document ${d.filename} is ${status}`);
      }
    }
    const riskTier: RiskTier = builder.completedProjects >= 10 ? "low" : builder.completedProjects >= 3 ? "medium" : "high";
    reasons.push(`${builder.completedProjects} completed projects on record -> risk tier ${riskTier}`);
    return { ok, reasons, riskTier };
  }

  async verifyMilestone(input: VerifyMilestoneInput): Promise<Verdict> {
    const { project, builder, milestone, template, evidence, priorEvidence, escrowCreatedAt } = input;
    const checks: CheckResult[] = [];
    const photos = evidence.filter((e) => e.kind === "photo");

    // required_evidence_present
    const short = template.requiredEvidence.filter((r) => evidence.filter((e) => e.kind === r.kind).length < r.minCount);
    checks.push({
      check: "required_evidence_present",
      result: short.length ? "fail" : "pass",
      reason: short.length
        ? `Missing: ${short.map((r) => `${r.minCount}x ${r.kind} (${r.description})`).join("; ")}`
        : `All ${template.requiredEvidence.length} required evidence types present`,
      evidenceIds: [],
    });

    // no_duplicate_photo
    const seen = new Map<string, Evidence>();
    for (const p of priorEvidence) {
      seen.set(p.sha256, p);
      if (p.meta.perceptualHash) seen.set(`p:${p.meta.perceptualHash}`, p);
    }
    const dupes: { e: Evidence; of: Evidence }[] = [];
    for (const p of photos) {
      const of = seen.get(p.sha256) ?? (p.meta.perceptualHash ? seen.get(`p:${p.meta.perceptualHash}`) : undefined);
      if (of) dupes.push({ e: p, of });
      seen.set(p.sha256, p);
      if (p.meta.perceptualHash) seen.set(`p:${p.meta.perceptualHash}`, p);
    }
    checks.push({
      check: "no_duplicate_photo",
      result: dupes.length ? "fail" : "pass",
      reason: dupes.length
        ? dupes.map((d) => `${d.e.filename} is a duplicate of previously submitted ${d.of.filename}`).join("; ")
        : `${photos.length} photos are unique across this builder's history`,
      evidenceIds: dupes.map((d) => d.e.id),
    });

    // photo_fresh
    const noDate = photos.filter((p) => !p.meta.takenAt);
    const stale = escrowCreatedAt ? photos.filter((p) => p.meta.takenAt && p.meta.takenAt < escrowCreatedAt) : [];
    checks.push({
      check: "photo_fresh",
      result: stale.length ? "fail" : noDate.length ? "warn" : "pass",
      reason: stale.length
        ? `${stale.map((p) => `${p.filename} taken ${p.meta.takenAt?.slice(0, 10)}`).join("; ")} — before escrow was created (${escrowCreatedAt?.slice(0, 10)})`
        : noDate.length
          ? `${noDate.length} photos have no EXIF timestamp`
          : "All photo timestamps are after the escrow was created",
      evidenceIds: (stale.length ? stale : noDate).map((p) => p.id),
    });

    // gps_within_site
    const noGps = photos.filter((p) => !p.meta.gps);
    const far = photos.filter((p) => p.meta.gps && haversineM(p.meta.gps, project.siteGeo) > project.siteGeo.radiusM);
    checks.push({
      check: "gps_within_site",
      result: far.length ? "fail" : noGps.length ? "warn" : "pass",
      reason: far.length
        ? `${far.map((p) => `${p.filename} ${Math.round(haversineM(p.meta.gps!, project.siteGeo))}m from site`).join("; ")} (allowed ${project.siteGeo.radiusM}m)`
        : noGps.length
          ? `${noGps.length} photos have no GPS metadata`
          : `All photo GPS within ${project.siteGeo.radiusM}m of ${project.siteAddress}`,
      evidenceIds: (far.length ? far : noGps).map((p) => p.id),
    });

    // invoice_matches_budget
    const invoices = evidence.filter((e) => e.kind === "invoice" && e.meta.invoiceTotal);
    const invoiced = invoices.reduce((a, e) => a + toMicro(e.meta.invoiceTotal!), 0n);
    const cap = (toMicro(milestone.amount) * 110n) / 100n;
    checks.push({
      check: "invoice_matches_budget",
      result: invoices.length === 0 ? "skipped" : invoiced > cap ? "warn" : "pass",
      reason:
        invoices.length === 0
          ? "No invoice totals extracted"
          : invoiced > cap
            ? `Invoices total ${Number(invoiced / 1_000_000n)} RLUSD exceeds 110% of the ${milestone.amount} budget line`
            : `Invoices total ${Number(invoiced / 1_000_000n)} RLUSD within the ${milestone.amount} budget line`,
      evidenceIds: invoices.map((e) => e.id),
    });

    // stage_visually_consistent (mock)
    const unclear = photos.filter((p) => /unclear|blurry/i.test(p.filename));
    checks.push({
      check: "stage_visually_consistent",
      result: unclear.length ? "warn" : "pass",
      reason: unclear.length
        ? `Cannot confirm stage from ${unclear.map((p) => p.filename).join(", ")} — human review needed`
        : `(mock) Photos consistent with: ${template.visualCriteria.join(", ")}`,
      evidenceIds: unclear.map((p) => p.id),
    });

    const fails = checks.filter((c) => c.result === "fail");
    const warns = checks.filter((c) => c.result === "warn");
    const policy = this.policyFor(project, builder, milestone);
    const decision: Verdict["decision"] = fails.length ? "fail" : unclear.length || warns.length >= 2 ? "needs_human" : "pass";
    const confidence = decision === "pass" ? 0.93 - warns.length * 0.05 : decision === "fail" ? 0.95 : 0.55;
    const summary =
      decision === "pass"
        ? `Evidence for "${milestone.title}" is consistent: ${checks.filter((c) => c.result === "pass").length}/${checks.length} checks passed.`
        : decision === "fail"
          ? `Evidence for "${milestone.title}" failed: ${fails.map((c) => c.check).join(", ")}. Funds stay locked.`
          : `Evidence for "${milestone.title}" needs a human: ${[...warns].map((c) => c.check).join(", ")}.`;

    return {
      milestoneId: milestone.id,
      decision,
      confidence,
      summary,
      checks,
      policy: { projectType: project.type, riskTier: policy.riskTier, requiredInspectors: policy.requiredInspectors },
      model: "mock",
      createdAt: this.clock.now().toISOString(),
    };
  }
}
