// Deterministic VerifierPort v2 for demos/tests. Same evidence in -> same verdict out. Every check id is from
// MILESTONE_CHECKS (shared). Maple St fixtures: foundation -> pass; framing with a reused photo -> fail on
// no_duplicate_photo; no audit -> fail on inspector_audit_present; a photo named *unclear*/*blurry* -> needs_human.
// TODO(adapters): CORE_VERIFIER=verifier -> packages/verifier/src/adapter.ts (@elmir132).
import {
  MILESTONE_CHECKS,
  TWO_INSPECTOR_THRESHOLD,
  type CheckResult,
  type Evidence,
  type Inspector,
  type InspectorAssignment,
  type Milestone,
  type Project,
  type ProjectVerification,
  type ReleasePolicy,
  type RiskTier,
  type Verdict,
  type VerifierPort,
  type VerifyMilestoneInput,
  type VerifyProjectInput,
} from "@xrlp/shared";
import { systemClock, type Clock } from "../clock.ts";
import { canonicalJson, sha256Hex } from "../ids.ts";
import { sumMicro, toMicro } from "../money.ts";

const MIN_CONFIDENCE: Record<RiskTier, number> = { low: 0.7, medium: 0.8, high: 0.9 };

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const check = (id: string, result: CheckResult["result"], reason: string, evidenceIds: string[] = []): CheckResult => ({
  check: id,
  result,
  reason,
  evidenceIds,
});

export class FakeVerifier implements VerifierPort {
  readonly mode = "fake" as const;
  constructor(private readonly clock: Clock = systemClock) {}

  policyFor(_project: Project, milestone: Milestone): ReleasePolicy {
    const big = toMicro(milestone.amount) >= BigInt(TWO_INSPECTOR_THRESHOLD) * 1_000_000n;
    const riskTier: RiskTier = "medium";
    return {
      riskTier,
      requiredChecks: [...MILESTONE_CHECKS],
      optionalChecks: [],
      minConfidence: MIN_CONFIDENCE[riskTier],
      requiredAudits: big ? 2 : 1,
    };
  }

  verdictHash(v: Verdict): string {
    return sha256Hex(canonicalJson(v));
  }

  async verifyProject({ project, builder, sov, documents }: VerifyProjectInput): Promise<ProjectVerification> {
    const has = (k: string) => documents.some((d) => d.kind === k);
    const revoked = documents.filter((d) => ["revoked", "expired"].includes(d.fields?.status?.toLowerCase() ?? ""));
    const identity = [
      has("license")
        ? check("license_valid", revoked.some((d) => d.kind === "license") ? "fail" : "pass", `[MOCK registry] License ${builder.licenseNumber} ${revoked.some((d) => d.kind === "license") ? "revoked" : "active"}`)
        : check("license_valid", "fail", "No contractor license document"),
      has("insurance")
        ? check("insurance_active", revoked.some((d) => d.kind === "insurance") ? "fail" : "pass", `[MOCK carrier] Policy ${builder.insurancePolicy}`)
        : check("insurance_active", "fail", "No general liability certificate"),
      check("entity_registered", has("entity") ? "pass" : "warn", has("entity") ? "[MOCK] Entity in good standing" : "No entity document; inspector pre-visit can confirm"),
    ];
    const sovTotal = sumMicro(sov.map((l) => l.amount));
    const principal = toMicro(project.terms.principal);
    const feasibility = [
      check("sov_sums_to_principal", sovTotal === principal ? "pass" : "fail", `Schedule of Values totals ${sovTotal / 1_000_000n} vs principal ${project.terms.principal}`),
      check("sov_lines_in_range", sov.every((l) => toMicro(l.amount) > 0n) ? "pass" : "fail", `${sov.length} SoV lines within regional cost ranges (mock)`),
      check("permits_present", has("permit") || has("plans") ? "pass" : "warn", has("permit") || has("plans") ? "Permit/plans on file" : "No permit uploaded"),
    ];
    const riskTier: RiskTier = builder.completedProjects >= 10 ? "low" : builder.completedProjects >= 3 ? "medium" : "high";
    const capability = [
      check("track_record", builder.completedProjects > 0 ? "pass" : "warn", `${builder.completedProjects} completed projects -> risk tier ${riskTier}`),
    ];
    const all = [...identity, ...feasibility, ...capability];
    const decision: ProjectVerification["decision"] = all.some((c) => c.result === "fail")
      ? "fail"
      : all.filter((c) => c.result === "warn").length >= 2
        ? "needs_human"
        : "pass";
    return {
      identity,
      feasibility,
      capability,
      decision,
      riskTier,
      summary:
        decision === "pass"
          ? `${builder.name} verified for ${project.name}: identity, feasibility and capability checks passed.`
          : decision === "fail"
            ? `Verification failed: ${all.filter((c) => c.result === "fail").map((c) => c.check).join(", ")}.`
            : `Needs an inspector pre-construction visit: ${all.filter((c) => c.result === "warn").map((c) => c.check).join(", ")}.`,
      model: "mock",
      createdAt: this.clock.now().toISOString(),
    };
  }

  async assignInspector({ project, panel, count }: { project: Project; panel: Inspector[]; count: 1 | 2 }): Promise<InspectorAssignment> {
    const verified = panel.filter((i) => i.verified);
    const scored = verified
      .map((i) => {
        const dist = i.homeGeo ? haversineM(i.homeGeo, project.siteGeo) : 50_000;
        const trade = i.trades.includes(project.type.startsWith("residential") ? "residential" : "commercial") ? 0.2 : 0;
        return { i, score: Math.round((1 / (1 + dist / 10_000) + trade) * 1000) / 1000, dist };
      })
      .sort((a, b) => b.score - a.score || a.i.address.localeCompare(b.i.address));
    const picked = scored.slice(0, count);
    return {
      inspectors: picked.map((p) => p.i.address),
      scores: Object.fromEntries(scored.map((p) => [p.i.address, p.score])),
      reasons: picked.map((p) => `${p.i.name}: ${Math.round(p.dist / 1000)} km from site, licence ${p.i.licenseNumber}, score ${p.score}`),
    };
  }

  async verifyMilestone(input: VerifyMilestoneInput): Promise<Verdict> {
    const { project, milestone, sov, evidence, audits, priorEvidence, escrowCreatedAt, policy } = input;
    const photos = evidence.filter((e) => e.kind === "photo");
    const checks: CheckResult[] = [];

    // required_evidence_present: every SoV line's requirement met (pooled across the milestone's lines)
    const need = new Map<string, number>();
    for (const l of sov) for (const r of l.evidence) need.set(r.kind, Math.max(need.get(r.kind) ?? 0, r.minCount));
    const short = [...need].filter(([kind, n]) => evidence.filter((e) => e.kind === kind).length < n);
    checks.push(
      check(
        "required_evidence_present",
        short.length ? "fail" : "pass",
        short.length ? `Missing: ${short.map(([k, n]) => `${n}x ${k}`).join(", ")}` : `All ${need.size} required evidence types present`,
      ),
    );

    // gps_within_site. EXIF GPS is spoofable, so this only catches lazy fraud; the shown reason states what was read, and
    // packages/verifier strips the same caveat from its displayed reasons.
    const noGps = photos.filter((p) => !p.meta.gps);
    const far = photos.filter((p) => p.meta.gps && haversineM(p.meta.gps, project.siteGeo) > project.siteGeo.radiusM);
    checks.push(
      check(
        "gps_within_site",
        far.length ? "fail" : noGps.length ? "warn" : "pass",
        far.length
          ? `${far.map((p) => `${p.filename} ${Math.round(haversineM(p.meta.gps!, project.siteGeo))}m from site`).join("; ")}`
          : noGps.length
            ? `${noGps.length} photos without GPS`
            : `All ${photos.length} photos within ${project.siteGeo.radiusM} m of the site (GPS from the photo files)`,
        (far.length ? far : noGps).map((p) => p.id),
      ),
    );

    // photo_fresh
    const stale = escrowCreatedAt ? photos.filter((p) => p.meta.takenAt && p.meta.takenAt < escrowCreatedAt) : [];
    const noDate = photos.filter((p) => !p.meta.takenAt);
    const daysBefore = (p: Evidence) => Math.floor((new Date(escrowCreatedAt!).getTime() - new Date(p.meta.takenAt!).getTime()) / 86_400_000);
    const howLongBefore = (p: Evidence) => {
      const d = daysBefore(p);
      return d < 1 ? "taken before this escrow existed" : `taken ${d} day${d === 1 ? "" : "s"} before this escrow existed`;
    };
    checks.push(
      check(
        "photo_fresh",
        stale.length ? "fail" : noDate.length ? "warn" : "pass",
        stale.length
          ? stale.map((p) => `${p.filename} ${howLongBefore(p)}`).join("; ")
          : noDate.length
            ? `${noDate.length} photos without EXIF time`
            : "All photos taken after the escrow was created",
        (stale.length ? stale : noDate).map((p) => p.id),
      ),
    );

    // no_duplicate_photo (sha256 + pHash across ALL projects)
    const seen = new Map<string, Evidence & { projectId?: string; projectName?: string }>();
    for (const p of priorEvidence) {
      seen.set(p.sha256, p);
      if (p.meta.perceptualHash) seen.set(`p:${p.meta.perceptualHash}`, p);
    }
    const dupes: { e: Evidence; of: Evidence & { projectId?: string; projectName?: string } }[] = [];
    for (const p of photos) {
      const of = seen.get(p.sha256) ?? (p.meta.perceptualHash ? seen.get(`p:${p.meta.perceptualHash}`) : undefined);
      if (of) dupes.push({ e: p, of });
    }
    checks.push(
      check(
        "no_duplicate_photo",
        dupes.length ? "fail" : "pass",
        dupes.length
          ? dupes.map((d) => `${d.e.filename} matches ${d.of.filename}${d.of.projectId && d.of.projectId !== project.id ? ` from project ${d.of.projectName ?? d.of.projectId}` : ""} (distance 0/64)`).join("; ")
          : `${photos.length} photos unique across all projects`,
        dupes.map((d) => d.e.id),
      ),
    );

    // invoice_matches_budget (±10% pass, ±25% warn)
    const invoices = evidence.filter((e) => e.kind === "invoice" && e.meta.invoiceTotal);
    const invoiced = sumMicro(invoices.map((e) => e.meta.invoiceTotal!));
    const budget = toMicro(milestone.amount);
    const dev = budget === 0n ? 0 : Math.abs(Number(invoiced - budget)) / Number(budget);
    checks.push(
      check(
        "invoice_matches_budget",
        invoices.length === 0 ? "warn" : dev <= 0.1 ? "pass" : dev <= 0.25 ? "warn" : "fail",
        invoices.length === 0
          ? "No invoice totals extracted"
          : `Invoices ${invoiced / 1_000_000n} RLUSD vs SoV ${milestone.amount} (${Math.round(dev * 100)}% off)`,
        invoices.map((e) => e.id),
      ),
    );

    // inspector_audit_present (core recomputes this from attested records; the verifier reports what it was given)
    const attested = audits.filter((a) => a.txHash);
    checks.push(
      check(
        "inspector_audit_present",
        attested.length >= policy.requiredAudits ? "pass" : "fail",
        attested.length ? `${attested.length} signed audit(s) on-chain` : "No inspector audit for this milestone",
      ),
    );

    // audit_checklist_complete
    const items = audits.flatMap((a) => a.checklist);
    checks.push(
      check(
        "audit_checklist_complete",
        !audits.length ? "fail" : items.some((i) => i.status === "not_done") ? "fail" : items.some((i) => i.status === "partial") ? "warn" : "pass",
        !audits.length ? "No audit checklist" : `${items.filter((i) => i.status === "done").length}/${items.length} SoV items done`,
      ),
    );

    // judgement checks (mock)
    const unclear = photos.filter((p) => /unclear|blurry/i.test(p.filename));
    const visual = sov.flatMap((l) => l.visualCriteria);
    checks.push(
      check(
        "stage_visually_consistent",
        unclear.length ? "warn" : "pass",
        unclear.length ? `[mock] Cannot confirm the stage from ${unclear.map((p) => p.filename).join(", ")}` : `[mock] Photos show: ${visual.join(", ") || milestone.title}`,
        unclear.map((p) => p.id),
      ),
    );
    // The inspector marking a line not done / partial is a disagreement with the builder's claim that the stage is done:
    // say so (warn) instead of "agrees", so the row never contradicts the inspector's checklist on screen.
    const behind = items.filter((i) => i.status !== "done");
    checks.push(
      check(
        "audit_matches_evidence",
        !audits.length ? "fail" : behind.length ? "warn" : "pass",
        !audits.length
          ? "No audit to compare"
          : behind.length
            ? `[mock] Inspector marked ${behind.length} of ${items.length} item${items.length === 1 ? "" : "s"} not done; the builder's evidence claims the stage complete`
            : "[mock] Inspector checklist agrees with builder evidence",
      ),
    );
    checks.push(check("document_consistency", "pass", "[mock] Dates, parties and site address agree across documents"));

    const fails = checks.filter((c) => c.result === "fail");
    const warns = checks.filter((c) => c.result === "warn");
    const decision: Verdict["decision"] = fails.length ? "fail" : warns.length ? "needs_human" : "pass";
    const confidence = decision === "pass" ? 0.93 : decision === "fail" ? 0.95 : 0.62;
    return {
      milestoneId: milestone.id,
      decision,
      confidence,
      summary:
        decision === "pass"
          ? `${milestone.title}: all ${checks.length} checks green.`
          : decision === "fail"
            ? `${milestone.title}: ${fails.map((c) => c.check).join(", ")} failed. Funds stay locked.`
            : `${milestone.title}: needs a human — ${warns.map((c) => c.check).join(", ")}.`,
      checks,
      policy: { projectType: project.type, riskTier: policy.riskTier, requiredInspectors: policy.requiredAudits },
      model: "mock",
      createdAt: this.clock.now().toISOString(),
    };
  }
}
