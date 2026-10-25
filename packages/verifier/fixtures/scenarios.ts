// Demo scenarios for the verifier. Used by `pnpm demo`, tests, and (optionally) core/web seed data.
// Company, licence, invoice and audit documents are SYNTHETIC. Photos are real CC0 / public-domain photographs
// (see SOURCES.txt) re-stamped with fixture EXIF by scripts/make-fixtures.ts. Times are pinned so verdicts
// are deterministic regardless of today's date.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, Project, type Evidence, type EvidenceKind } from "@xrlp/shared";
import { extractEvidenceMeta } from "../src/meta.ts";
import { evidenceBundleHash, InspectorAudit } from "../src/audit.ts";
import type { PriorEvidence, VerifyMilestoneInput } from "../src/types.ts";

export const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));

export const GEO = {
  mapleSite: { lat: 40.6795, lng: -73.962 },
  oakSite: { lat: 40.6502, lng: -73.9497 },
  offsite: { lat: 40.7008, lng: -73.9505 }, // ~2.6 km from Maple St
};

const times = {
  escrowCreatedAt: "2026-10-15T14:00:00Z", // loan closed, all milestone escrows created
  m1Photos: ["2026-10-19T14:05:00Z", "2026-10-19T14:12:00Z", "2026-10-20T09:30:00Z"],
  m1ApprovedAt: "2026-10-21T18:00:00Z",
  m2Photos: ["2026-10-23T15:10:00Z", "2026-10-23T15:22:00Z", "2026-10-23T16:05:00Z"],
  oakPhoto: "2025-07-14T16:40:00Z",
  now: "2026-10-24T20:00:00Z",
};

const BUILDER_NAME = "Hudson Ridge Builders LLC";
const SITE = "41 Maple St, Brooklyn, NY 11216";

const docs: Record<string, string> = {
  "evidence/maple-st/foundation/invoice_GRM-24117.txt": `GOTHAM READY-MIX CONCRETE
Invoice No: GRM-24117
Date: 2026-10-18
Bill To: ${BUILDER_NAME}
Job Site: ${SITE}

Ready-mix 4000 PSI, 92 cu yd          18,860.00
#5 rebar, 4.1 tons                       4,510.00
Anchor bolts 5/8" x 12" (220)              880.00
Pump truck, 1 day                          600.00
TOTAL: $24,850.00
`,
  "evidence/maple-st/foundation/invoice_GRM-24117_short.txt": `GOTHAM READY-MIX CONCRETE
Invoice No: GRM-24117
Date: 2026-10-18
Bill To: ${BUILDER_NAME}
Job Site: ${SITE}

Ready-mix 4000 PSI, 70 cu yd          14,350.00
#5 rebar, 3.0 tons                       3,300.00
Anchor bolts 5/8" x 12" (190)              750.00
TOTAL: $18,400.00
`,
  "evidence/maple-st/foundation/footing_inspection.txt": `CITY OF NEW YORK - DEPARTMENT OF BUILDINGS (SYNTHETIC DEMO DOCUMENT)
Footing / Foundation Inspection Sign-off
Date: 2026-10-17
Permit: B-0099341
Contractor: ${BUILDER_NAME}
Site: ${SITE}
Result: APPROVED - footings conform to approved plans.
`,
  "evidence/maple-st/foundation/lien_waiver_GRM-24117.txt": `CONDITIONAL LIEN WAIVER AND RELEASE ON PROGRESS PAYMENT
Claimant: Gotham Ready-Mix Concrete
Customer: ${BUILDER_NAME}
Job Site: ${SITE}
Invoice No: GRM-24117
Amount: $24,850.00
Date: 2026-10-19
`,
  "evidence/maple-st/framing/invoice_BLS-88310.txt": `BROOKLYN LUMBER & SUPPLY
Invoice No: BLS-88310
Date: 2026-10-22
Bill To: ${BUILDER_NAME}
Deliver To: ${SITE}

Framing lumber package (studs, plates, headers)   21,940.00
Engineered roof trusses (14)                       6,320.00
Sheathing OSB 7/16 (120 sheets)                     1,500.00
TOTAL: $29,760.00
`,
  "builder/license.txt": `GENERAL CONTRACTOR LICENSE (SYNTHETIC DEMO DOCUMENT)
License No: NYC-GC-204518
Licensee: ${BUILDER_NAME}
Expires: 2027-06-30
`,
  "builder/insurance-coi.txt": `CERTIFICATE OF LIABILITY INSURANCE (SYNTHETIC DEMO DOCUMENT)
Insured: ${BUILDER_NAME}
Policy No: HSB-GL-7781203
General Liability Each Occurrence: $2,000,000
Expires: 2027-03-31
`,
};

export const FIX = { times, docs };

export const builder: Builder = Builder.parse({
  id: "bld_hudson",
  name: BUILDER_NAME,
  address: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
  licenseNumber: "NYC-GC-204518",
  insurancePolicy: "HSB-GL-7781203",
  completedProjects: 6,
  riskTier: "medium",
  verified: true,
});

export const project: Project = Project.parse({
  id: "prj_maple",
  name: "Maple St Duplex",
  type: "residential_new",
  builderId: builder.id,
  siteAddress: SITE,
  siteGeo: { ...GEO.mapleSite, radiusM: 120 },
  description: "Two-family new build on a 25x100 lot.",
  terms: { principal: "100000.00", interestRateBps: 900, termDays: 365, paymentIntervalDays: 30, fundingDeadline: "2026-10-14T00:00:00Z" },
  status: "escrowed",
  sov: [
    { code: "F-01", title: "Footings and stem walls", amount: "10000.00", trade: "concrete", evidence: [], visualCriteria: ["Foundation walls visible"] },
    { code: "F-02", title: "Slab", amount: "10000.00", trade: "concrete", evidence: [], visualCriteria: ["Completed slab"] },
    { code: "F-03", title: "Anchor bolts", amount: "5000.00", trade: "concrete", evidence: [], visualCriteria: ["Anchor bolts visible"] },
    { code: "FR-01", title: "Wall framing", amount: "18000.00", trade: "framing", evidence: [], visualCriteria: ["Wall framing visible"] },
    { code: "FR-02", title: "Roof trusses", amount: "8000.00", trade: "framing", evidence: [], visualCriteria: ["Roof trusses installed"] },
    { code: "FR-03", title: "Sheathing", amount: "4000.00", trade: "framing", evidence: [], visualCriteria: ["Sheathing complete"] },
    { code: "R-01", title: "Roof and dry-in", amount: "20000.00", trade: "roofing", evidence: [], visualCriteria: ["Roof dried in"] },
    { code: "FN-01", title: "Finishes", amount: "25000.00", trade: "finish", evidence: [], visualCriteria: ["Finishes complete"] },
  ],
  milestones: [
    { id: "ms_maple_1", index: 0, templateKey: "foundation", title: "Foundation", amount: "25000.00", requiredInspectors: 1, status: "evidence_submitted", sovCodes: ["F-01", "F-02", "F-03"] },
    { id: "ms_maple_2", index: 1, templateKey: "framing", title: "Framing", amount: "30000.00", requiredInspectors: 1, status: "evidence_submitted", sovCodes: ["FR-01", "FR-02", "FR-03"] },
    { id: "ms_maple_3", index: 2, templateKey: "dry_in", title: "Roof & Dry-in", amount: "20000.00", requiredInspectors: 1, status: "escrowed", sovCodes: ["R-01"] },
    { id: "ms_maple_4", index: 3, templateKey: "finish", title: "Finishes & CO", amount: "25000.00", requiredInspectors: 1, status: "escrowed", sovCodes: ["FN-01"] },
  ],
});

const m1 = project.milestones[0]!;
const m2 = project.milestones[1]!;

const MIME: Record<string, string> = { jpg: "image/jpeg", json: "application/json", txt: "text/plain" };

/** Build an Evidence the way core would at upload time: hash + extract meta. */
export async function fixtureEvidence(rel: string, kind: EvidenceKind, uploadedAt = times.now): Promise<Evidence> {
  const bytes = await readFile(join(FIXTURES_DIR, rel));
  const mimeType = MIME[rel.split(".").pop()!] ?? "application/octet-stream";
  const filename = rel.split("/").pop()!;
  const { sha256, meta } = await extractEvidenceMeta({ bytes, mimeType, filename });
  return { id: `ev_${filename.replace(/\.\w+$/, "")}`, kind, filename, mimeType, uri: rel, sha256, meta, uploadedAt };
}

/** Fixture file layout (relative to fixtures/). Photos are stamped by scripts/make-fixtures.ts. */
export const PATHS = {
  foundation: {
    wide: "evidence/maple-st/foundation/foundation-01-wide.jpg",
    bolts: "evidence/maple-st/foundation/foundation-02-bolts.jpg",
    walls: "evidence/maple-st/foundation/foundation-03-walls.jpg",
    wallsOffsite: "evidence/maple-st/foundation/foundation-03-walls-b.jpg",
    invoice: "evidence/maple-st/foundation/invoice_GRM-24117.txt",
    invoiceShort: "evidence/maple-st/foundation/invoice_GRM-24117_short.txt",
    footing: "evidence/maple-st/foundation/footing_inspection.txt",
    lien: "evidence/maple-st/foundation/lien_waiver_GRM-24117.txt",
  },
  framing: {
    a: "evidence/maple-st/framing/framing-01-wide.jpg",
    b: "evidence/maple-st/framing/framing-02-corner.jpg",
    c: "evidence/maple-st/framing/framing-03-wall.jpg",
    /** Copy of the Oak Ave photo: neutral name, FRESH EXIF date, Maple St GPS. Only pHash can catch it. */
    reused: "evidence/maple-st/framing/IMG_5121.jpg",
    invoice: "evidence/maple-st/framing/invoice_BLS-88310.txt",
  },
  oak: "evidence/oak-ave/framing/oak-ave-framing.jpg",
  dryInNote: "evidence/maple-st/dry_in/NOTE.txt",
  audits: {
    foundation: "evidence/maple-st/audits/foundation.json",
    foundationOffsite: "evidence/maple-st/audits/foundation_offsite.json",
    foundationShortInvoice: "evidence/maple-st/audits/foundation_short_invoice.json",
    framing: "evidence/maple-st/audits/framing.json",
  },
  auditPhotos: {
    foundation: ["evidence/maple-st/audits/photos/audit-foundation-01-rebar.jpg", "evidence/maple-st/audits/photos/audit-foundation-02-site.jpg"],
    framing: ["evidence/maple-st/audits/photos/audit-framing-01-frame.jpg"],
  },
};

const kindOf = (rel: string): EvidenceKind =>
  /\.jpg$/.test(rel) ? "photo" : /\/invoice_/.test(rel) ? "invoice" : "document";
const ev = (rel: string) => fixtureEvidence(rel, kindOf(rel));

async function oakPrior(): Promise<PriorEvidence> {
  return { evidence: await ev(PATHS.oak), projectId: "prj_oak", milestoneId: "ms_oak_2", projectName: "Oak Ave Fourplex (2025)" };
}
async function maplePrior(rels: string[], milestoneId: string): Promise<PriorEvidence[]> {
  return (await Promise.all(rels.map(ev))).map((evidence) => ({ evidence, projectId: project.id, milestoneId, projectName: project.name }));
}

export interface Scenario {
  key: string;
  title: string;
  expect: "pass" | "fail" | "needs_human";
  /** Checks that must come back `fail` / `warn` (manifest.json mirrors this; tests assert it). */
  failingChecks: string[];
  warnChecks: string[];
  /** Fixture paths of the builder evidence bundle, in submission order. */
  evidencePaths: string[];
  /** Path of the inspector audit JSON, or null when no audit was filed. */
  auditPath: string | null;
  milestoneIndex: 0 | 1;
  /** Ticket that must land before the verifier can produce this outcome; tests skip the decision until then. */
  pending?: string;
  input: () => Promise<VerifyMilestoneInput>;
  /** The inspector audit(s) filed for this milestone (empty when none). */
  audits: () => Promise<InspectorAudit[]>;
}

const base = { project, builder, dataDir: FIXTURES_DIR };
const F = PATHS.foundation;
const R = PATHS.framing;
const timelineM1 = { escrowCreatedAt: times.escrowCreatedAt, now: times.now };

export async function loadAudit(rel: string): Promise<InspectorAudit> {
  return InspectorAudit.parse(JSON.parse(await readFile(join(FIXTURES_DIR, rel), "utf8")));
}

function scenario(
  s: Pick<Scenario, "key" | "title" | "expect" | "failingChecks" | "warnChecks" | "evidencePaths" | "auditPath" | "milestoneIndex" | "pending">,
): Scenario {
  const milestone = s.milestoneIndex === 0 ? m1 : m2;
  return {
    ...s,
    input: async () => ({
      ...base,
      milestone,
      evidence: await Promise.all(s.evidencePaths.map(ev)),
      priorEvidence:
        s.milestoneIndex === 0
          ? [await oakPrior()]
          : [await oakPrior(), ...(await maplePrior([F.wide, F.bolts, F.walls], m1.id))],
      timeline:
        s.milestoneIndex === 0
          ? timelineM1
          : { escrowCreatedAt: times.escrowCreatedAt, previousMilestoneApprovedAt: times.m1ApprovedAt, now: times.now },
    }),
    audits: async () => (s.auditPath ? [await loadAudit(s.auditPath)] : []),
  };
}

export const SCENARIOS: Scenario[] = [
  scenario({
    key: "A",
    title: "Milestone 1 (Foundation) — honest submission, inspector audit all done",
    expect: "pass",
    failingChecks: [],
    warnChecks: [],
    evidencePaths: [F.wide, F.bolts, F.walls, F.invoice, F.footing, F.lien],
    auditPath: PATHS.audits.foundation,
    milestoneIndex: 0,
  }),
  scenario({
    key: "B",
    title: "Milestone 2 (Framing) — a photo copied from the Oak Ave project (fresh EXIF date, neutral file name); inspector marks sheathing partial",
    expect: "fail",
    failingChecks: ["no_duplicate_photo"],
    warnChecks: ["audit_checklist_complete"],
    evidencePaths: [R.a, R.b, R.c, R.reused, R.invoice],
    auditPath: PATHS.audits.framing,
    milestoneIndex: 1,
  }),
  scenario({
    key: "C",
    title: "Milestone 1 — one photo geotagged 2.6 km from the site",
    expect: "needs_human",
    failingChecks: ["gps_within_site"], // a failed lazy-fraud-only check escalates to needs_human, never to a hard fail
    warnChecks: [],
    evidencePaths: [F.wide, F.bolts, F.wallsOffsite, F.invoice, F.footing],
    auditPath: PATHS.audits.foundationOffsite,
    milestoneIndex: 0,
  }),
  scenario({
    key: "D",
    title: "Milestone 1 — invoices cover only 73.6% of the requested draw",
    expect: "fail",
    failingChecks: ["invoice_matches_budget"],
    warnChecks: [],
    evidencePaths: [F.wide, F.bolts, F.walls, F.invoiceShort, F.footing],
    auditPath: PATHS.audits.foundationShortInvoice,
    milestoneIndex: 0,
  }),
  scenario({
    key: "E",
    title: "Milestone 1 — honest evidence but the inspector has filed NO audit",
    expect: "fail",
    failingChecks: ["inspector_audit_present"],
    warnChecks: [],
    evidencePaths: [F.wide, F.bolts, F.walls, F.invoice, F.footing, F.lien],
    auditPath: null,
    milestoneIndex: 0,
    pending: "VER-03",
  }),
];

/** Builder onboarding fixture for verifyBuilder(). */
export async function builderOnboardingInput() {
  return {
    builder,
    documents: await Promise.all([fixtureEvidence("builder/license.txt", "document"), fixtureEvidence("builder/insurance-coi.txt", "document")]),
    dataDir: FIXTURES_DIR,
    now: times.now,
  };
}

export { evidenceBundleHash };
