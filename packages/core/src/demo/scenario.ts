// The demo story (docs/04-demo-script.md) as reusable steps over CoreService. Used by `seed`, `simulate`, route 21 and tests.
// Pre-staged state (04 §Pre-staged): Maple St duplex verified, funded, loan closed, 3 escrows; M1 evidence + audit uploaded;
// M2 evidence with a photo reused from the Oak Ave project + audit uploaded. Oak Ave (Project B): one milestone released,
// the other's escrow already past CancelAfter (the live "Keeper tick" cancels and refunds it).
// Addresses are deterministic fakes; on devnet the XRPL prestage script provides funded wallets instead.
import { MILESTONE_TEMPLATES, type CreateProjectInput, type Milestone, type Project, type SovLine, type XrplAddress } from "@xrlp/shared";
import type { FakeClock } from "../clock.ts";
import { DAY_MS } from "../clock.ts";
import { fakeAddress, sha256Hex } from "../ids.ts";
import type { CoreService, EvidenceFile, RegisterBuilderInput, RegisterInspectorInput } from "../service.ts";
import { demoDoc, demoPhoto, nearby, reupload } from "./fixtures.ts";

export type Log = (line: string) => void;
const HOUR = 3_600_000;

export const DEMO_ADDRESSES = {
  platform: fakeAddress("platform"),
  aiAgent: fakeAddress("ai-agent"),
  releaseService: fakeAddress("release-service"),
};

export const DEMO = {
  builders: {
    hudson: {
      id: "bld-hudson-valley",
      name: "Hudson Valley Builders",
      address: fakeAddress("builder:hudson-valley"),
      licenseNumber: "NY-GC-2019-04417",
      insurancePolicy: "GL-88213-HV",
      completedProjects: 14,
      riskTier: "medium",
    },
    catskill: {
      id: "bld-catskill-reno",
      name: "Catskill Renovation Co",
      address: fakeAddress("builder:catskill"),
      licenseNumber: "NY-HIC-2021-11802",
      insurancePolicy: "GL-55102-CR",
      completedProjects: 5,
      riskTier: "medium",
    },
  } satisfies Record<string, RegisterBuilderInput & { id: string; address: string }>,
  investors: [
    { name: "Ava Chen", address: fakeAddress("investor:ava") },
    { name: "Marcus Johnson", address: fakeAddress("investor:marcus") },
    { name: "Priya Patel", address: fakeAddress("investor:priya") },
  ],
  inspectors: {
    dana: { name: "Dana Ruiz (Hudson Code Inspections)", address: fakeAddress("inspector:dana"), licenseNumber: "NYS-CEO-3341", trades: ["residential"], homeGeo: { lat: 41.51, lng: -73.96 } },
    tom: { name: "Tom Becker (Valley Site Services)", address: fakeAddress("inspector:tom"), licenseNumber: "NYS-CEO-5120", trades: ["residential"], homeGeo: { lat: 41.93, lng: -74.0 } },
    lee: { name: "Lee Park (Metro Commercial)", address: fakeAddress("inspector:lee"), licenseNumber: "NYS-CEO-7781", trades: ["commercial"], homeGeo: { lat: 40.75, lng: -73.99 } },
  } satisfies Record<string, RegisterInspectorInput>,
  maple: { name: "Maple St Duplex", siteAddress: "48 Maple St, Beacon, NY 12508", siteGeo: { lat: 41.5048, lng: -73.9696, radiusM: 150 } },
  oak: { name: "Oak Ave Renovation", siteAddress: "12 Oak Ave, Kingston, NY 12401", siteGeo: { lat: 41.927, lng: -73.997, radiusM: 150 } },
} as const;

export const MAPLE_ID = "maple-st-duplex";
export const OAK_ID = "oak-ave-renovation";

const TRADE: Record<string, string> = { foundation: "concrete", framing: "framing", dry_in: "roofing", finish: "finishes" };

/** Pre-filled SoV from a residential template (the template's evidence + visual criteria, our amounts). */
export function sovFromTemplate(keys: { key: string; amount: string; code?: string; title?: string }[]): SovLine[] {
  const all = MILESTONE_TEMPLATES.residential_new;
  return keys.map(({ key, amount, code, title }) => {
    const t = all.find((x) => x.key === key);
    if (!t) throw new Error(`no residential template ${key}`);
    return { code: code ?? key, title: title ?? t.title, amount, trade: TRADE[key] ?? key, evidence: t.requiredEvidence, visualCriteria: t.visualCriteria };
  });
}

const DOCS: CreateProjectInput["documents"] = [
  { kind: "license", filename: "contractor-license.pdf", fields: { status: "active" } },
  { kind: "insurance", filename: "gl-certificate.pdf", fields: { status: "active" } },
  { kind: "entity", filename: "llc-good-standing.pdf" },
  { kind: "permit", filename: "building-permit.pdf" },
];

export function mapleInput(fundingDeadline: Date): CreateProjectInput {
  return {
    name: DEMO.maple.name,
    type: "residential_new",
    builderId: DEMO.builders.hudson.id,
    siteAddress: DEMO.maple.siteAddress,
    siteGeo: DEMO.maple.siteGeo,
    description: "Two-family new build on a cleared lot. Foundation, framing, roof & dry-in.",
    terms: { principal: "120000", interestRateBps: 1000, termDays: 180, paymentIntervalDays: 30, fundingDeadline: fundingDeadline.toISOString() },
    sov: sovFromTemplate([
      { key: "foundation", amount: "36000" },
      { key: "framing", amount: "48000" },
      { key: "dry_in", amount: "36000" },
    ]),
    documents: DOCS,
  };
}

export function oakInput(fundingDeadline: Date): CreateProjectInput {
  return {
    name: DEMO.oak.name,
    type: "residential_renovation",
    builderId: DEMO.builders.catskill.id,
    siteAddress: DEMO.oak.siteAddress,
    siteGeo: DEMO.oak.siteGeo,
    description: "Gut renovation of a 1920s single-family: reframe, new roof.",
    terms: { principal: "40000", interestRateBps: 1100, termDays: 90, paymentIntervalDays: 15, fundingDeadline: fundingDeadline.toISOString() },
    sov: sovFromTemplate([
      { key: "framing", amount: "24000" },
      { key: "dry_in", amount: "16000", code: "roof", title: "New roof" },
    ]),
    documents: DOCS,
  };
}

/** Demo CancelAfter: Oak Ave escrows expire within days (Project B stalls by demo time); everything else uses the default. */
export function demoCancelAfter(project: Project, milestone: Milestone, closeAt: Date): Date {
  if (project.id === OAK_ID) return new Date(closeAt.getTime() + (milestone.index + 1) * 4 * DAY_MS);
  return new Date(closeAt.getTime() + Math.round(((milestone.index + 1) / project.milestones.length) * project.terms.termDays * DAY_MS));
}

/** Seed clock starts this long before "now" so subscription dates and Oak Ave's CancelAfter are already in the past. */
export const SEED_BACKDATE_MS = 12 * DAY_MS;

// ---------- evidence ----------

export function photos(site: { lat: number; lng: number }, label: string, n: number, takenAt: Date, prefix: string, hue = 30): EvidenceFile[] {
  return Array.from({ length: n }, (_, i) =>
    demoPhoto({ label: `${label} ${i + 1}`, filename: `${prefix}-${String(i + 1).padStart(2, "0")}.jpg`, takenAt: new Date(takenAt.getTime() + i * 60_000), gps: nearby(site, 10 + i * 5), hue }),
  );
}
export const invoice = (filename: string, total: string): EvidenceFile => demoDoc({ kind: "invoice", filename, title: "Invoice", invoiceTotal: total });
export const doc = (filename: string, title: string): EvidenceFile => demoDoc({ kind: "document", filename, title });

/** Oak Ave framing photo; reused later as Maple St "IMG_2231.jpg" (the fraud beat). */
export const oakFramingPhoto = (takenAt: Date) =>
  demoPhoto({ label: "Framing — Oak Ave", filename: "oak-ave-framing.jpg", takenAt, gps: nearby(DEMO.oak.siteGeo, 15), hue: 18 });

export function auditBody(project: Project, milestoneId: string, inspector: XrplAddress, evidence: EvidenceFile[], notes = "Site visit: work matches the SoV line.") {
  const m = project.milestones.find((x) => x.id === milestoneId)!;
  return {
    report: {
      inspector,
      evidenceBundleHash: sha256Hex(evidence.map((e) => e.sha256).sort().join(",")),
      checklist: (m.sovCodes ?? [m.templateKey]).map((sovCode) => ({ sovCode, status: "done" as const })),
      notes,
    },
    photos: [],
  };
}

// ---------- steps ----------

export async function registerParticipants(svc: CoreService, log: Log = () => {}): Promise<void> {
  for (const b of Object.values(DEMO.builders)) await svc.registerBuilder(b);
  for (const i of Object.values(DEMO.inspectors)) await svc.registerInspector(i);
  for (const i of DEMO.investors) await svc.kycInvestor(i.address, i.name);
  log(`participants: ${Object.keys(DEMO.builders).length} builders, ${Object.keys(DEMO.inspectors).length} panel inspectors, ${DEMO.investors.length} KYC'd investors`);
}

/** draft -> verifying -> verified -> funding -> funded. Returns the project and its assigned inspector(s). */
export async function toFunded(svc: CoreService, input: CreateProjectInput, split: string[], log: Log = () => {}) {
  const p = await svc.createProject(input);
  const builder = await svc.getBuilder(p.builderId);
  await svc.payVerificationFee(p.id, { builder: builder.address });
  const v = await svc.verifyProject(p.id);
  if (v.project.status !== "verified") throw new Error(`${p.id}: verification ${v.verification.decision}`);
  const { assignment } = await svc.lockTermsAndOpenFunding(p.id, { actor: svc.platformAddress });
  for (const [i, amount] of split.entries()) await svc.invest(p.id, { investor: DEMO.investors[i]!.address, amount });
  log(`${p.name}: verified, funded ${input.terms.principal} RLUSD, inspector ${assignment.inspectors.join(", ")}`);
  return { project: (await svc.getProject(p.id)).project, inspectors: assignment.inspectors };
}

export async function seedDemo(svc: CoreService, clock: FakeClock, log: Log = () => {}): Promise<void> {
  const t0 = clock.now().getTime();
  await registerParticipants(svc, log);

  // Project B: Oak Ave. Framing released; roof escrow expires before demo time.
  const oak = await toFunded(svc, oakInput(new Date(t0 + DAY_MS)), ["15000", "15000", "10000"], log);
  clock.set(new Date(t0 + DAY_MS + HOUR));
  const oakClosed = await svc.closeLoan(oak.project.id, { actor: svc.platformAddress });
  const oakFraming = oakClosed.project.milestones[0]!;
  clock.set(new Date(t0 + 2 * DAY_MS));
  const oakPhotos = [oakFramingPhoto(new Date(t0 + DAY_MS + 20 * HOUR)), ...photos(DEMO.oak.siteGeo, "Framing — Oak Ave", 3, new Date(t0 + DAY_MS + 21 * HOUR), "oak-framing", 18)];
  const oakEvidence = [...oakPhotos, invoice("oak-lumber-invoice.pdf", "24000")];
  await svc.submitEvidence(oak.project.id, oakFraming.id, oakEvidence);
  await svc.submitAudit(oak.project.id, oakFraming.id, auditBody(oakClosed.project, oakFraming.id, oak.inspectors[0]!, oakEvidence));
  await svc.runChecks(oak.project.id, oakFraming.id);
  log(`${DEMO.oak.name}: framing released; roof escrow expires ${oakClosed.project.milestones[1]!.cancelAfter}`);

  // Project A: Maple St. Funded, closed, M1 + M2 evidence and audits uploaded (checks run live in the demo).
  clock.set(new Date(t0 + 2 * DAY_MS + HOUR));
  const maple = await toFunded(svc, mapleInput(new Date(t0 + 3 * DAY_MS)), ["50000", "40000", "30000"], log);
  clock.set(new Date(t0 + 3 * DAY_MS + HOUR));
  const closed = await svc.closeLoan(maple.project.id, { actor: svc.platformAddress });
  const [m1, m2] = closed.project.milestones;
  clock.set(new Date(t0 + 10 * DAY_MS));
  const site = DEMO.maple.siteGeo;
  const m1Evidence = [
    ...photos(site, "Foundation — Maple St", 3, new Date(t0 + 9 * DAY_MS + 12 * HOUR), "foundation", 30),
    invoice("concrete-rebar-invoice.pdf", "36000"),
    doc("footing-inspection.pdf", "Footing inspection: PASSED"),
  ];
  await svc.submitEvidence(maple.project.id, m1!.id, m1Evidence);
  await svc.submitAudit(maple.project.id, m1!.id, auditBody(closed.project, m1!.id, maple.inspectors[0]!, m1Evidence, "Slab cured, anchor bolts set, no framing yet."));
  clock.set(new Date(t0 + 10 * DAY_MS + 6 * HOUR));
  const m2Evidence = [
    ...photos(site, "Framing — Maple St", 3, new Date(t0 + 10 * DAY_MS + 4 * HOUR), "framing", 45),
    reupload(oakPhotos[0]!, "IMG_2231.jpg"),
    invoice("lumber-package-invoice.pdf", "48000"),
  ];
  await svc.submitEvidence(maple.project.id, m2!.id, m2Evidence);
  await svc.submitAudit(maple.project.id, m2!.id, auditBody(closed.project, m2!.id, maple.inspectors[0]!, m2Evidence, "Walls framed; sheathing started."));
  clock.set(new Date(t0 + 11 * DAY_MS));
  log(`${DEMO.maple.name}: escrowed; M1 + M2 evidence and audits uploaded (M2 contains IMG_2231.jpg reused from Oak Ave)`);
}
