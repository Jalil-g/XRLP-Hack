// Demo scenarios for the verifier. Used by `pnpm demo`, tests, and (optionally) core/web seed data.
// All data is synthetic. Times are pinned so verdicts are deterministic regardless of today's date.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, Project, type Evidence, type EvidenceKind } from "@xrlp/shared";
import { extractEvidenceMeta } from "../src/meta.ts";
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
  "invoice-concrete.txt": `GOTHAM READY-MIX CONCRETE
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
  "invoice-concrete-short.txt": `GOTHAM READY-MIX CONCRETE
Invoice No: GRM-24117
Date: 2026-10-18
Bill To: ${BUILDER_NAME}
Job Site: ${SITE}

Ready-mix 4000 PSI, 70 cu yd          14,350.00
#5 rebar, 3.0 tons                       3,300.00
Anchor bolts 5/8" x 12" (190)              750.00
TOTAL: $18,400.00
`,
  "footing-inspection.txt": `CITY OF NEW YORK - DEPARTMENT OF BUILDINGS (SYNTHETIC DEMO DOCUMENT)
Footing / Foundation Inspection Sign-off
Date: 2026-10-17
Permit: B-0099341
Contractor: ${BUILDER_NAME}
Site: ${SITE}
Result: APPROVED - footings conform to approved plans.
`,
  "lien-waiver-concrete.txt": `CONDITIONAL LIEN WAIVER AND RELEASE ON PROGRESS PAYMENT
Claimant: Gotham Ready-Mix Concrete
Customer: ${BUILDER_NAME}
Job Site: ${SITE}
Invoice No: GRM-24117
Amount: $24,850.00
Date: 2026-10-19
`,
  "invoice-lumber.txt": `BROOKLYN LUMBER & SUPPLY
Invoice No: BLS-88310
Date: 2026-10-22
Bill To: ${BUILDER_NAME}
Deliver To: ${SITE}

Framing lumber package (studs, plates, headers)   21,940.00
Engineered roof trusses (14)                       6,320.00
Sheathing OSB 7/16 (120 sheets)                     1,500.00
TOTAL: $29,760.00
`,
  "license.txt": `GENERAL CONTRACTOR LICENSE (SYNTHETIC DEMO DOCUMENT)
License No: NYC-GC-204518
Licensee: ${BUILDER_NAME}
Expires: 2027-06-30
`,
  "insurance-coi.txt": `CERTIFICATE OF LIABILITY INSURANCE (SYNTHETIC DEMO DOCUMENT)
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
  milestones: [
    { id: "ms_maple_1", index: 0, templateKey: "foundation", title: "Foundation", amount: "25000.00", requiredInspectors: 1, status: "evidence_submitted" },
    { id: "ms_maple_2", index: 1, templateKey: "framing", title: "Framing", amount: "30000.00", requiredInspectors: 1, status: "evidence_submitted" },
    { id: "ms_maple_3", index: 2, templateKey: "dry_in", title: "Roof & Dry-in", amount: "20000.00", requiredInspectors: 1, status: "escrowed" },
    { id: "ms_maple_4", index: 3, templateKey: "finish", title: "Finishes & CO", amount: "25000.00", requiredInspectors: 1, status: "escrowed" },
  ],
});

const m1 = project.milestones[0]!;
const m2 = project.milestones[1]!;

const MIME: Record<string, string> = { jpg: "image/jpeg", txt: "text/plain" };

/** Build an Evidence the way core would at upload time: hash + extract meta. */
export async function fixtureEvidence(rel: string, kind: EvidenceKind, uploadedAt = times.now): Promise<Evidence> {
  const bytes = await readFile(join(FIXTURES_DIR, rel));
  const mimeType = MIME[rel.split(".").pop()!] ?? "application/octet-stream";
  const filename = rel.split("/").pop()!;
  const { sha256, meta } = await extractEvidenceMeta({ bytes, mimeType, filename });
  return { id: `ev_${filename.replace(/\.\w+$/, "")}`, kind, filename, mimeType, uri: rel, sha256, meta, uploadedAt };
}

const photo = (f: string) => fixtureEvidence(`photos/${f}`, "photo");
const doc = (f: string, kind: EvidenceKind = "document") => fixtureEvidence(`docs/${f}`, kind);

async function oakPrior(): Promise<PriorEvidence> {
  return { evidence: await photo("oak-ave-framing.jpg"), projectId: "prj_oak", milestoneId: "ms_oak_2", projectName: "Oak Ave Fourplex (2025)" };
}

export interface Scenario {
  key: string;
  title: string;
  expect: "pass" | "fail" | "needs_human";
  input: () => Promise<VerifyMilestoneInput>;
}

const base = { project, builder, dataDir: FIXTURES_DIR };

export const SCENARIOS: Scenario[] = [
  {
    key: "A",
    title: "Milestone 1 (Foundation) — honest submission",
    expect: "pass",
    input: async () => ({
      ...base,
      milestone: m1,
      evidence: await Promise.all([
        photo("foundation-01-wide.jpg"), photo("foundation-02-bolts.jpg"), photo("foundation-03-closeup.jpg"),
        doc("invoice-concrete.txt", "invoice"), doc("footing-inspection.txt"), doc("lien-waiver-concrete.txt"),
      ]),
      priorEvidence: [await oakPrior()],
      timeline: { escrowCreatedAt: times.escrowCreatedAt, now: times.now },
    }),
  },
  {
    key: "B",
    title: "Milestone 2 (Framing) — reused photo from another project, EXIF date before escrow",
    expect: "fail",
    input: async () => ({
      ...base,
      milestone: m2,
      evidence: await Promise.all([
        photo("framing-01-wide.jpg"), photo("framing-02-corner.jpg"), photo("framing-03-wall.jpg"), photo("framing-04-reused.jpg"),
        doc("invoice-lumber.txt", "invoice"),
      ]),
      priorEvidence: [
        await oakPrior(),
        ...(await Promise.all(["foundation-01-wide.jpg", "foundation-02-bolts.jpg", "foundation-03-closeup.jpg"].map(photo))).map(
          (evidence) => ({ evidence, projectId: project.id, milestoneId: m1.id, projectName: project.name }),
        ),
      ],
      timeline: { escrowCreatedAt: times.escrowCreatedAt, previousMilestoneApprovedAt: times.m1ApprovedAt, now: times.now },
    }),
  },
  {
    key: "C",
    title: "Milestone 1 — one photo geotagged 2.6 km from the site",
    expect: "needs_human",
    input: async () => ({
      ...base,
      milestone: m1,
      evidence: await Promise.all([
        photo("foundation-01-wide.jpg"), photo("foundation-02-bolts.jpg"), photo("foundation-03-offsite.jpg"),
        doc("invoice-concrete.txt", "invoice"), doc("footing-inspection.txt"),
      ]),
      priorEvidence: [await oakPrior()],
      timeline: { escrowCreatedAt: times.escrowCreatedAt, now: times.now },
    }),
  },
  {
    key: "D",
    title: "Milestone 1 — invoices cover only 73.6% of the requested draw",
    expect: "fail",
    input: async () => ({
      ...base,
      milestone: m1,
      evidence: await Promise.all([
        photo("foundation-01-wide.jpg"), photo("foundation-02-bolts.jpg"), photo("foundation-03-closeup.jpg"),
        doc("invoice-concrete-short.txt", "invoice"), doc("footing-inspection.txt"),
      ]),
      priorEvidence: [await oakPrior()],
      timeline: { escrowCreatedAt: times.escrowCreatedAt, now: times.now },
    }),
  },
];

/** Builder onboarding fixture for verifyBuilder(). */
export async function builderOnboardingInput() {
  return {
    builder,
    documents: await Promise.all([doc("license.txt"), doc("insurance-coi.txt")]),
    dataDir: FIXTURES_DIR,
    now: times.now,
  };
}
