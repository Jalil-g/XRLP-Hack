// Builder onboarding check: license + insurance documents consistent with the builder record and a
// (MOCK) license/insurance registry. Output feeds the VERIFIED_BUILDER credential decision.
// TODO(live): in VERIFIER_MODE=live, extract fields from PDF/photo docs with Claude (same pattern as llm/live.ts).
//             Today only text/JSON documents are parsed (deterministically) in both modes.
import type { Builder, CheckResult, Evidence, RiskTier } from "@xrlp/shared";
import { loadEvidence } from "./meta.ts";
import { normalizeName, round2, toCents } from "./util.ts";

export interface LicenseRecord {
  licenseNumber: string;
  holderName: string;
  status: "active" | "expired" | "suspended";
  expiresOn: string; // YYYY-MM-DD
}
export interface InsuranceRecord {
  policyNumber: string;
  insuredName: string;
  generalLiabilityUsd: number;
  expiresOn: string;
}
export interface BuilderRegistry {
  /** Label shown in reasons, e.g. "MOCK NYC DOB registry". */
  label: string;
  lookupLicense(licenseNumber: string): Promise<LicenseRecord | null>;
  lookupInsurance(policyNumber: string): Promise<InsuranceRecord | null>;
}

/** MOCK registry — clearly fake data for the demo. Replace with a real lookup (state license board, COI provider). */
export const MOCK_REGISTRY: BuilderRegistry = (() => {
  const licenses: LicenseRecord[] = [
    { licenseNumber: "NYC-GC-204518", holderName: "Hudson Ridge Builders LLC", status: "active", expiresOn: "2027-06-30" },
    { licenseNumber: "NYC-GC-118200", holderName: "Quickbuild Co", status: "expired", expiresOn: "2025-12-31" },
  ];
  const policies: InsuranceRecord[] = [
    { policyNumber: "HSB-GL-7781203", insuredName: "Hudson Ridge Builders LLC", generalLiabilityUsd: 2_000_000, expiresOn: "2027-03-31" },
  ];
  return {
    label: "MOCK license/insurance registry",
    async lookupLicense(n) {
      return licenses.find((l) => l.licenseNumber.toUpperCase() === n.toUpperCase()) ?? null;
    },
    async lookupInsurance(p) {
      return policies.find((x) => x.policyNumber.toUpperCase() === p.toUpperCase()) ?? null;
    },
  };
})();

export interface VerifyBuilderInput {
  builder: Builder;
  /** License + insurance documents (kind "document"). Text/JSON parsed today; PDFs need live mode (TODO). */
  documents: Evidence[];
  files?: Record<string, Uint8Array>;
  dataDir?: string;
  registry?: BuilderRegistry;
  now?: string;
  /** Minimum general liability coverage, USD. Default 1,000,000. */
  minLiabilityUsd?: number;
}

export interface BuilderVerdict {
  builderId: string;
  decision: "pass" | "fail" | "needs_human";
  confidence: number;
  summary: string;
  checks: CheckResult[];
  /** Tier suggested from track record; platform decides the final tier. */
  suggestedRiskTier: RiskTier;
  /** True while the registry lookup is the demo mock. */
  registryIsMock: boolean;
  model: string;
  createdAt: string;
}

const field = (text: string, re: RegExp) => re.exec(text)?.[1]?.trim();

export async function verifyBuilder(input: VerifyBuilderInput): Promise<BuilderVerdict> {
  const { builder } = input;
  const registry = input.registry ?? MOCK_REGISTRY;
  const now = input.now ? Date.parse(input.now) : Date.now();
  const minLiab = input.minLiabilityUsd ?? 1_000_000;
  const loaded = await Promise.all(input.documents.map((d) => loadEvidence(d, { files: input.files, dataDir: input.dataDir })));
  const texts = loaded.filter((l) => l.text).map((l) => ({ id: l.evidence.id, text: l.text! }));
  const licDoc = texts.find((t) => /licen[cs]e/i.test(t.text));
  const insDoc = texts.find((t) => /insur|liability|policy/i.test(t.text));
  const checks: CheckResult[] = [];
  const add = (check: string, result: CheckResult["result"], reason: string, evidenceIds: string[] = []) =>
    checks.push({ check, result, reason, evidenceIds });
  const sameName = (a: string, b: string) => normalizeName(a) === normalizeName(b);
  const tag = `[${registry.label}]`;

  // 1. registry: license
  const lic = await registry.lookupLicense(builder.licenseNumber);
  if (!lic) add("license_registry_lookup", "fail", `${tag} License ${builder.licenseNumber} not found.`);
  else if (lic.status !== "active") add("license_registry_lookup", "fail", `${tag} License ${lic.licenseNumber} is ${lic.status} (expires ${lic.expiresOn}).`);
  else if (!sameName(lic.holderName, builder.name)) add("license_registry_lookup", "fail", `${tag} License holder "${lic.holderName}" ≠ builder "${builder.name}".`);
  else add("license_registry_lookup", "pass", `${tag} License ${lic.licenseNumber} active for ${lic.holderName} until ${lic.expiresOn}.`);

  // 2. registry: insurance
  const ins = await registry.lookupInsurance(builder.insurancePolicy);
  if (!ins) add("insurance_registry_lookup", "fail", `${tag} Policy ${builder.insurancePolicy} not found.`);
  else if (Date.parse(ins.expiresOn) < now) add("insurance_registry_lookup", "fail", `${tag} Policy ${ins.policyNumber} expired ${ins.expiresOn}.`);
  else if (ins.generalLiabilityUsd < minLiab) add("insurance_registry_lookup", "fail", `${tag} GL coverage $${ins.generalLiabilityUsd.toLocaleString("en-US")} < required $${minLiab.toLocaleString("en-US")}.`);
  else add("insurance_registry_lookup", "pass", `${tag} Policy ${ins.policyNumber}: $${ins.generalLiabilityUsd.toLocaleString("en-US")} GL, valid until ${ins.expiresOn}.`);

  // 3. license document matches record
  if (!licDoc) add("license_document_consistent", "warn", "No readable license document submitted.");
  else {
    const no = field(licDoc.text, /licen[cs]e\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Z0-9-]+)/i);
    const holder = field(licDoc.text, /(?:licensee|holder|name)\s*:\s*(.+)/i);
    const exp = field(licDoc.text, /expir\w*\s*:?\s*(\d{4}-\d{2}-\d{2})/i);
    const issues = [
      no?.toUpperCase() !== builder.licenseNumber.toUpperCase() && `license number "${no ?? "?"}" ≠ record ${builder.licenseNumber}`,
      holder && !sameName(holder, builder.name) && `holder "${holder}" ≠ ${builder.name}`,
      exp && Date.parse(exp) < now && `document expired ${exp}`,
    ].filter(Boolean) as string[];
    add("license_document_consistent", issues.length ? "fail" : "pass",
      issues.length ? `License document: ${issues.join("; ")}.` : `License document matches record (${builder.licenseNumber}).`, [licDoc.id]);
  }

  // 4. insurance certificate matches record
  if (!insDoc) add("insurance_document_consistent", "warn", "No readable insurance certificate submitted.");
  else {
    const pol = field(insDoc.text, /policy\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Z0-9-]+)/i);
    const insured = field(insDoc.text, /insured\s*:\s*(.+)/i);
    const limit = field(insDoc.text, /(?:general\s+liability|each\s+occurrence|limit)[^\d$]*\$?\s*([\d,]+)/i);
    const issues = [
      pol?.toUpperCase() !== builder.insurancePolicy.toUpperCase() && `policy "${pol ?? "?"}" ≠ record ${builder.insurancePolicy}`,
      insured && !sameName(insured, builder.name) && `insured "${insured}" ≠ ${builder.name}`,
      limit && toCents(limit) < BigInt(minLiab) * 100n && `limit $${limit} below required`,
    ].filter(Boolean) as string[];
    add("insurance_document_consistent", issues.length ? "fail" : "pass",
      issues.length ? `Insurance certificate: ${issues.join("; ")}.` : `Insurance certificate matches record (${builder.insurancePolicy}).`, [insDoc.id]);
  }

  // 5. track record -> suggested tier
  const suggested: RiskTier = builder.completedProjects >= 10 ? "low" : builder.completedProjects >= 3 ? "medium" : "high";
  const rank = { low: 0, medium: 1, high: 2 } as const;
  add("track_record", rank[suggested] > rank[builder.riskTier] ? "warn" : "pass",
    `${builder.completedProjects} completed projects → suggested tier "${suggested}" (record says "${builder.riskTier}").`);

  const fails = checks.filter((c) => c.result === "fail");
  const warns = checks.filter((c) => c.result === "warn");
  const decision = fails.length ? "fail" : warns.length ? "needs_human" : "pass";
  const summary =
    decision === "pass" ? `PASS — license and insurance verified against ${registry.label} and documents. Eligible for VERIFIED_BUILDER credential.`
    : decision === "fail" ? `FAIL — ${fails.map((c) => c.reason).join(" | ")}`
    : `NEEDS HUMAN — ${warns.map((c) => c.reason).join(" | ")}`;
  return {
    builderId: builder.id,
    decision,
    confidence: round2(decision === "needs_human" ? 0.6 : 0.95),
    summary,
    checks,
    suggestedRiskTier: suggested,
    registryIsMock: registry === MOCK_REGISTRY,
    model: "deterministic",
    createdAt: new Date().toISOString(),
  };
}
