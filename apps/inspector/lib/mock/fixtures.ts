// Mock-mode seed data. Shapes = lib/types.ts (docs/05-api.md); test/fixtures.test.ts parses every object with those schemas.
// Story matches docs/04-demo-script.md: Maple St duplex (3 milestones, escrows locked, M1 evidence awaiting the inspector's
// audit, M2 evidence with the reused Oak Ave framing photo), plus a failed suite needing a re-audit and a pre-construction visit.
// Addresses are real classic addresses derived from public entropy sha256("drawproof/mock/<label>")[0..16] — never funded,
// never on devnet; they only exist so mock-mode signing (INS-04) has keys that match the fixtures.
import { explorerTxUrl } from "@xrlp/shared";
import type {
  Attestation,
  Builder,
  ChainEvent,
  ChecksStatus,
  Evidence,
  Inspector,
  InspectorAudit,
  Investment,
  LoanSnapshot,
  Project,
  ProjectVerification,
  SovLine,
  VaultSnapshot,
} from "../types.ts";
import { documentArt, photoArt, type Scene } from "./art.ts";

export const ADDR = {
  dana: "rDFTQYuGTApAjDhn7Jd3PxWsWhYtJ3RgVN",
  marcus: "rKMQPHTG3S3Bn37Vrkumg8jY29G997MMSd",
  priya: "rNEmNwZgws6iH5QYKHq5D4vhYcaH7ukHqV",
  hvb: "rBkULj8RmkvUZiMzzQovZBZXYRHMZ4Sdsm",
  catskill: "raTG7r2mgj8wN3jyU7iK4czD9zyWLRLzjQ",
  platform: "rsMZBY4qhj3Hsv1F1QScqV7YSsEmtpKvr8",
  aiAgent: "rwcWJkMTyWqLRj6dqUpQMZgf5dDXRGTXjK",
  spvMaple: "rUZUn8u5cooZRFHbggU5vgUz86M23TSTX6",
  spvRhinebeck: "rwfhBgNc5XoDHwVD3qCXdxQLTTMnPNPwrx",
  ava: "rUC6rripwu9bpa5onzxmxLJ3v5tk8N8mKw",
  northbridge: "rn3kA6BZEE4QuJSUbibXQ8vi3S4p4mU71W",
  marco: "rnUYpEnLKEcxGUBdZBRUvqBgYFjqHqCtwW",
} as const;

/** Deterministic 64-hex stand-in for sha256 / tx hashes (FNV-1a rounds). Mock data only. */
export function fakeHash(seed: string): string {
  let out = "";
  for (let round = 0; out.length < 64; round++) {
    let h = 0x811c9dc5 ^ round;
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    out += ((h ^ (h >>> 15)) >>> 0).toString(16).padStart(8, "0");
  }
  return out.toUpperCase();
}

const condition = (seed: string) => `A0258020${fakeHash(`cond:${seed}`)}810120`;

export function chainEvent(e: Omit<ChainEvent, "txHash" | "explorerUrl"> & { txHash?: string }): ChainEvent {
  const txHash = e.txHash ?? fakeHash(`tx:${e.projectId}:${e.milestoneId ?? ""}:${e.kind}:${e.at}:${e.actor ?? ""}`);
  return { ...e, txHash, explorerUrl: explorerTxUrl(txHash) };
}

// ---------------------------------------------------------------- parties

export const INSPECTORS: Inspector[] = [
  {
    address: ADDR.dana,
    name: "Dana Okafor, PE",
    licenseNumber: "NY PE-089412",
    firm: "Catskill Inspection Group",
    region: "Hudson Valley, NY",
    trades: ["concrete", "framing", "earthwork"],
    verified: true,
    credentialTx: fakeHash("cred:VERIFIED_INSPECTOR:dana"),
  },
  {
    address: ADDR.marcus,
    name: "Marcus Lindqvist",
    licenseNumber: "ICC 5381207",
    firm: "Hudson Code Services",
    region: "Hudson Valley, NY",
    trades: ["framing", "plumbing", "electrical"],
    verified: true,
    credentialTx: fakeHash("cred:VERIFIED_INSPECTOR:marcus"),
  },
  {
    address: ADDR.priya,
    name: "Priya Raman",
    licenseNumber: "NY HI-16000117245",
    firm: "Mid-Hudson Building Consultants",
    region: "Ulster County, NY",
    trades: ["roofing", "envelope", "finishes"],
    verified: true,
    credentialTx: fakeHash("cred:VERIFIED_INSPECTOR:priya"),
  },
];

export const BUILDERS: Builder[] = [
  {
    id: "hudson-valley-builders",
    name: "Hudson Valley Builders LLC",
    address: ADDR.hvb,
    licenseNumber: "NY HIC-2207841",
    insurancePolicy: "GL-44-19082",
    completedProjects: 14,
    riskTier: "low",
    verified: true,
    credentialTx: fakeHash("cred:VERIFIED_BUILDER:hvb"),
  },
  {
    id: "catskill-restoration",
    name: "Catskill Restoration Co.",
    address: ADDR.catskill,
    licenseNumber: "NY HIC-1984420",
    insurancePolicy: "GL-71-55210",
    completedProjects: 6,
    riskTier: "medium",
    verified: true,
    credentialTx: fakeHash("cred:VERIFIED_BUILDER:catskill"),
  },
];

// ---------------------------------------------------------------- Schedule of Values

const photo = (minCount: number, description: string) => ({ kind: "photo" as const, minCount, description });
const invoice = (description: string) => ({ kind: "invoice" as const, minCount: 1, description });
const document = (description: string) => ({ kind: "document" as const, minCount: 1, description });

const MAPLE_SOV: SovLine[] = [
  { code: "02-100", title: "Site prep & excavation", amount: "4000.00", trade: "earthwork", evidence: [photo(1, "Excavated, backfilled footprint")], visualCriteria: ["excavation to footing depth", "backfill compacted"] },
  { code: "03-100", title: "Footings & foundation walls", amount: "18000.00", trade: "concrete", evidence: [photo(2, "Walls wide shot + close-up"), invoice("Concrete + rebar invoice"), document("Footing inspection sign-off")], visualCriteria: ["foundation walls poured", "anchor bolts visible"] },
  { code: "03-300", title: "Slab on grade", amount: "8000.00", trade: "concrete", evidence: [photo(1, "Cured slab")], visualCriteria: ["cured concrete slab", "no framing yet"] },
  { code: "06-100", title: "Wall framing", amount: "30000.00", trade: "framing", evidence: [photo(2, "All exterior walls framed"), invoice("Lumber package invoice")], visualCriteria: ["wall framing on all sides"] },
  { code: "06-170", title: "Roof trusses", amount: "12000.00", trade: "framing", evidence: [photo(1, "Trusses set and braced")], visualCriteria: ["roof trusses installed"] },
  { code: "06-160", title: "Wall & roof sheathing", amount: "6000.00", trade: "framing", evidence: [photo(1, "Sheathing started")], visualCriteria: ["sheathing started"] },
  { code: "07-310", title: "Roofing", amount: "18000.00", trade: "roofing", evidence: [photo(2, "Roof covering complete"), invoice("Roofing invoice")], visualCriteria: ["roof covering installed"] },
  { code: "07-250", title: "Weather barrier", amount: "4000.00", trade: "envelope", evidence: [photo(1, "House wrap installed")], visualCriteria: ["house wrap"] },
  { code: "08-500", title: "Windows", amount: "14000.00", trade: "openings", evidence: [photo(1, "Windows set"), invoice("Window package invoice")], visualCriteria: ["windows installed"] },
  { code: "08-100", title: "Exterior doors", amount: "6000.00", trade: "openings", evidence: [photo(1, "Exterior doors hung")], visualCriteria: ["exterior doors installed"] },
];

const RHINEBECK_SOV: SovLine[] = [
  { code: "02-410", title: "Selective demolition", amount: "6000.00", trade: "demolition", evidence: [photo(1, "Stripped interior")], visualCriteria: ["interior stripped to studs"] },
  { code: "22-100", title: "Rough plumbing", amount: "9000.00", trade: "plumbing", evidence: [photo(1, "New supply + DWV runs"), invoice("Plumbing invoice")], visualCriteria: ["new piping visible"] },
  { code: "26-100", title: "Rough electrical", amount: "9000.00", trade: "electrical", evidence: [photo(2, "Boxes set, conductors pulled"), invoice("Electrical invoice")], visualCriteria: ["new wiring pulled to boxes"] },
  { code: "09-250", title: "Drywall & paint", amount: "14000.00", trade: "finishes", evidence: [photo(2, "Finished walls")], visualCriteria: ["drywall painted"] },
  { code: "09-600", title: "Flooring", amount: "10000.00", trade: "finishes", evidence: [photo(1, "Flooring complete")], visualCriteria: ["flooring installed"] },
  { code: "22-400", title: "Plumbing fixtures", amount: "6000.00", trade: "plumbing", evidence: [photo(1, "Fixtures set")], visualCriteria: ["fixtures installed"] },
  { code: "01-770", title: "Final permit sign-off", amount: "6000.00", trade: "general", evidence: [document("Final permit sign-off")], visualCriteria: [] },
];

const ELM_SOV: SovLine[] = [
  { code: "02-100", title: "Site prep & excavation", amount: "22000.00", trade: "earthwork", evidence: [photo(2, "Cleared, excavated lot")], visualCriteria: ["lot cleared", "excavation to footing depth"] },
  { code: "03-100", title: "Footings & foundation walls", amount: "58000.00", trade: "concrete", evidence: [photo(2, "Walls wide shot + close-up"), invoice("Concrete invoice")], visualCriteria: ["foundation walls poured"] },
  { code: "06-100", title: "Framing", amount: "110000.00", trade: "framing", evidence: [photo(4, "All floors framed"), invoice("Lumber invoice")], visualCriteria: ["framing on all floors"] },
  { code: "07-310", title: "Roofing & dry-in", amount: "90000.00", trade: "roofing", evidence: [photo(3, "Roof + windows")], visualCriteria: ["roof covering installed", "windows installed"] },
];

// ---------------------------------------------------------------- projects

const MAPLE_GEO = { lat: 41.9312, lng: -74.0004, radiusM: 60 };
const RHINEBECK_GEO = { lat: 41.9268, lng: -73.9124, radiusM: 80 };

const escrow = (owner: string, seq: number, seed: string) => ({
  owner,
  offerSequence: seq,
  condition: condition(seed),
  createTx: fakeHash(`escrow-create:${seed}`),
});

export const PROJECTS: Project[] = [
  {
    id: "maple-st-duplex",
    name: "Maple St Duplex",
    type: "residential_new",
    builderId: "hudson-valley-builders",
    siteAddress: "418 Maple St, Kingston, NY 12401",
    siteGeo: MAPLE_GEO,
    description: "Ground-up side-by-side duplex, 2 × 3BR/2.5BA on a 0.22-acre infill lot. Permits issued Sep 2026.",
    terms: { principal: "120000.00", interestRateBps: 1050, termDays: 365, paymentIntervalDays: 30, fundingDeadline: "2026-10-24T14:30:00Z" },
    status: "escrowed",
    sov: MAPLE_SOV,
    milestones: [
      { id: "maple-st-duplex:m1", index: 0, title: "Foundation", amount: "30000.00", sovCodes: ["02-100", "03-100", "03-300"], requiredInspectors: 1, status: "evidence_submitted", cancelAfter: "2026-12-15T23:59:00Z", escrow: escrow(ADDR.spvMaple, 11, "maple:m1") },
      { id: "maple-st-duplex:m2", index: 1, title: "Framing", amount: "48000.00", sovCodes: ["06-100", "06-170", "06-160"], requiredInspectors: 1, status: "evidence_submitted", cancelAfter: "2027-02-15T23:59:00Z", escrow: escrow(ADDR.spvMaple, 12, "maple:m2") },
      { id: "maple-st-duplex:m3", index: 2, title: "Roof & Dry-in", amount: "42000.00", sovCodes: ["07-310", "07-250", "08-500", "08-100"], requiredInspectors: 1, status: "escrowed", cancelAfter: "2027-04-15T23:59:00Z", escrow: escrow(ADDR.spvMaple, 13, "maple:m3") },
    ],
    chain: { spv: ADDR.spvMaple, vaultId: fakeHash("vault:maple"), loanBrokerId: fakeHash("broker:maple"), loanId: fakeHash("loan:maple") },
  },
  {
    id: "rhinebeck-farmhouse",
    name: "Rhinebeck Farmhouse Renovation",
    type: "residential_renovation",
    builderId: "catskill-restoration",
    siteAddress: "77 Mill Rd, Rhinebeck, NY 12572",
    siteGeo: RHINEBECK_GEO,
    description: "Gut renovation of an 1890s farmhouse: new plumbing, electrical, insulation and finishes.",
    terms: { principal: "60000.00", interestRateBps: 1150, termDays: 270, paymentIntervalDays: 30, fundingDeadline: "2026-10-10T23:59:00Z" },
    status: "escrowed",
    sov: RHINEBECK_SOV,
    milestones: [
      { id: "rhinebeck-farmhouse:m1", index: 0, title: "Demolition & Rough-in", amount: "24000.00", sovCodes: ["02-410", "22-100", "26-100"], requiredInspectors: 1, status: "failed", cancelAfter: "2026-12-31T23:59:00Z", escrow: escrow(ADDR.spvRhinebeck, 7, "rhinebeck:m1") },
      { id: "rhinebeck-farmhouse:m2", index: 1, title: "Finishes", amount: "36000.00", sovCodes: ["09-250", "09-600", "22-400", "01-770"], requiredInspectors: 1, status: "escrowed", cancelAfter: "2027-03-31T23:59:00Z", escrow: escrow(ADDR.spvRhinebeck, 8, "rhinebeck:m2") },
    ],
    chain: { spv: ADDR.spvRhinebeck, vaultId: fakeHash("vault:rhinebeck"), loanBrokerId: fakeHash("broker:rhinebeck"), loanId: fakeHash("loan:rhinebeck") },
  },
  {
    id: "elm-ct-fourplex",
    name: "Elm Ct Fourplex",
    type: "residential_new",
    builderId: "catskill-restoration",
    siteAddress: "12 Elm Ct, Saugerties, NY 12477",
    siteGeo: { lat: 42.0776, lng: -73.9529, radiusM: 70 },
    description: "Ground-up fourplex, 4 × 2BR on a former auto-repair lot.",
    terms: { principal: "280000.00", interestRateBps: 1100, termDays: 450, paymentIntervalDays: 30, fundingDeadline: "2026-11-30T23:59:00Z" },
    status: "verifying",
    sov: ELM_SOV,
    milestones: [],
    chain: {},
  },
];

/** AI-assigned inspectors per project (route 6 output). */
export const ASSIGNMENTS: Record<string, string[]> = {
  "maple-st-duplex": [ADDR.dana],
  "rhinebeck-farmhouse": [ADDR.marcus],
  "elm-ct-fourplex": [ADDR.dana],
};

// ---------------------------------------------------------------- builder evidence

let photoN = 2040;

function photoEv(milestoneId: string, scene: Exclude<Scene, "document">, geo: { lat: number; lng: number }, takenAt: string, uploadedAt: string, i: number, over: Partial<Evidence["meta"]> & { filename?: string } = {}): Evidence {
  const { filename = `IMG_${photoN++}.jpg`, ...meta } = over;
  const id = `${milestoneId}:photo-${i + 1}`;
  return {
    id,
    kind: "photo",
    filename,
    mimeType: "image/jpeg",
    uri: photoArt(scene, filename, i),
    sha256: fakeHash(`file:${id}`).toLowerCase(),
    meta: { takenAt, gps: { lat: geo.lat + 0.00007 * (i - 1), lng: geo.lng - 0.00009 * (i - 1) }, perceptualHash: `phash:${id}`, ...meta },
    uploadedAt,
  };
}

function docEv(milestoneId: string, kind: "invoice" | "document", filename: string, lines: string[], uploadedAt: string, invoiceTotal?: string): Evidence {
  const id = `${milestoneId}:${kind}-${filename}`;
  return {
    id,
    kind,
    filename,
    mimeType: "application/pdf",
    uri: documentArt(filename, lines),
    sha256: fakeHash(`file:${id}`).toLowerCase(),
    meta: invoiceTotal ? { invoiceTotal } : {},
    uploadedAt,
  };
}

const M1_UP = "2026-10-24T17:05:00Z";
const M2_UP = "2026-10-24T17:20:00Z";
const RB_UP = "2026-10-22T13:10:00Z";

export const EVIDENCE: Record<string, Evidence[]> = {
  "maple-st-duplex:m1": [
    photoEv("maple-st-duplex:m1", "excavation", MAPLE_GEO, "2026-10-24T16:12:00Z", M1_UP, 0),
    photoEv("maple-st-duplex:m1", "foundation", MAPLE_GEO, "2026-10-24T16:20:00Z", M1_UP, 1),
    photoEv("maple-st-duplex:m1", "foundation", MAPLE_GEO, "2026-10-24T16:24:00Z", M1_UP, 2),
    docEv("maple-st-duplex:m1", "invoice", "ulster-ready-mix-INV-4410.pdf", ["Ulster Ready-Mix", "Concrete 4000 psi, 62 yd³", "Rebar #4, 1.8 t", "Total: 17,640.00 RLUSD"], M1_UP, "17640.00"),
    docEv("maple-st-duplex:m1", "document", "footing-signoff.pdf", ["City of Kingston — Building Dept.", "Footing inspection: APPROVED", "Permit BP-2026-0917"], M1_UP),
  ],
  "maple-st-duplex:m2": [
    photoEv("maple-st-duplex:m2", "framing", MAPLE_GEO, "2026-10-24T16:41:00Z", M2_UP, 0),
    // The fraud beat: a framing photo reused from the builder's Oak Ave job, taken 41 days before this escrow existed.
    photoEv("maple-st-duplex:m2", "framing", MAPLE_GEO, "2026-09-13T15:22:00Z", M2_UP, 1, { filename: "IMG_0412.jpg", perceptualHash: "phash:oak-ave-framing-0412" }),
    photoEv("maple-st-duplex:m2", "framing", MAPLE_GEO, "2026-10-24T16:47:00Z", M2_UP, 2),
    photoEv("maple-st-duplex:m2", "framing", MAPLE_GEO, "2026-10-24T16:52:00Z", M2_UP, 3),
    docEv("maple-st-duplex:m2", "invoice", "kingston-lumber-INV-2291.pdf", ["Kingston Lumber Supply", "Framing package, duplex", "Trusses × 28", "Total: 44,210.00 RLUSD"], M2_UP, "44210.00"),
  ],
  "rhinebeck-farmhouse:m1": [
    photoEv("rhinebeck-farmhouse:m1", "rough_in", RHINEBECK_GEO, "2026-10-22T12:30:00Z", RB_UP, 0),
    photoEv("rhinebeck-farmhouse:m1", "rough_in", RHINEBECK_GEO, "2026-10-22T12:34:00Z", RB_UP, 1),
    photoEv("rhinebeck-farmhouse:m1", "rough_in", RHINEBECK_GEO, "2026-10-22T12:39:00Z", RB_UP, 2),
    photoEv("rhinebeck-farmhouse:m1", "rough_in", RHINEBECK_GEO, "2026-10-22T12:44:00Z", RB_UP, 3),
    docEv("rhinebeck-farmhouse:m1", "invoice", "mill-rd-electric-INV-118.pdf", ["Mill Rd Electric", "Rough-in, 2 floors", "Total: 8,720.00 RLUSD"], RB_UP, "8720.00"),
  ],
};

// ---------------------------------------------------------------- audits, checks, attestations

const RB_AUDIT_AT = "2026-10-22T15:30:00Z";

export const AUDITS: Record<string, InspectorAudit[]> = {
  "rhinebeck-farmhouse:m1": [
    {
      milestoneId: "rhinebeck-farmhouse:m1",
      inspector: ADDR.marcus,
      evidenceBundleHash: fakeHash("bundle:rhinebeck:m1:v1").toLowerCase(),
      checklist: [
        { sovCode: "02-410", status: "done" },
        { sovCode: "22-100", status: "done" },
        { sovCode: "26-100", status: "done", note: "Boxes set on both floors." },
      ],
      photos: [photoEv("rhinebeck-farmhouse:m1:audit-1", "rough_in", RHINEBECK_GEO, "2026-10-22T15:05:00Z", RB_AUDIT_AT, 0)],
      notes: "Rough-in complete per SoV.",
      txHash: fakeHash("audit:rhinebeck:m1:v1"),
      at: RB_AUDIT_AT,
    },
  ],
};

const pending = (): ChecksStatus => ({ required: [], optional: [], outcome: "pending" });

const RB_CHECKS = [
  { check: "required_evidence_present", result: "pass" as const, reason: "4 photos, 1 invoice (SoV 02-410, 22-100, 26-100)", evidenceIds: [] },
  { check: "gps_within_site", result: "pass" as const, reason: "All photo GPS within 24 m of site (geofence 80 m)", evidenceIds: [] },
  { check: "photo_fresh", result: "pass" as const, reason: "All photos taken after the escrow was created", evidenceIds: [] },
  { check: "no_duplicate_photo", result: "pass" as const, reason: "No match across 212 indexed photos", evidenceIds: [] },
  { check: "invoice_matches_budget", result: "pass" as const, reason: "Electrical invoice 8,720.00 vs SoV 26-100 9,000.00 (−3.1%)", evidenceIds: [] },
  { check: "inspector_audit_present", result: "pass" as const, reason: "Audit attested by assigned inspector rKMQPH…MMSd", evidenceIds: [] },
  { check: "audit_checklist_complete", result: "pass" as const, reason: "3 of 3 SoV lines covered", evidenceIds: [] },
  { check: "audit_matches_evidence", result: "fail" as const, reason: "Audit marks 26-100 rough electrical done; builder photos show no conductors pulled at 2 of 3 boxes", evidenceIds: ["rhinebeck-farmhouse:m1:photo-2", "rhinebeck-farmhouse:m1:photo-3"] },
  { check: "stage_visually_consistent", result: "warn" as const, reason: "Plumbing rough-in visible; electrical rough-in partially visible", evidenceIds: [] },
  { check: "document_consistency", result: "pass" as const, reason: "Invoice party and address match the project", evidenceIds: [] },
];

export const CHECKS: Record<string, ChecksStatus> = {
  "maple-st-duplex:m1": pending(),
  "maple-st-duplex:m2": pending(),
  "maple-st-duplex:m3": pending(),
  "rhinebeck-farmhouse:m1": {
    required: RB_CHECKS,
    optional: [],
    outcome: "fail",
    verdict: {
      milestoneId: "rhinebeck-farmhouse:m1",
      decision: "fail",
      confidence: 0.88,
      summary: "Inspector audit contradicts builder photos on rough electrical. Re-audit required.",
      checks: RB_CHECKS,
      policy: { projectType: "residential_renovation", riskTier: "medium", requiredInspectors: 1 },
      model: "mock",
      createdAt: "2026-10-22T16:02:00Z",
    },
  },
  "rhinebeck-farmhouse:m2": pending(),
};

/** Milestones whose failed suite needs a fresh audit (route 18 `needs: "re_audit"`). */
export const RE_AUDIT: string[] = ["rhinebeck-farmhouse:m1"];

export const ATTESTATIONS: Record<string, Attestation[]> = {
  "rhinebeck-farmhouse:m1": [
    { milestoneId: "rhinebeck-farmhouse:m1", role: "inspector", signer: ADDR.marcus, decision: "approve", notes: "Rough-in complete per SoV.", txHash: fakeHash("audit:rhinebeck:m1:v1"), at: RB_AUDIT_AT },
    { milestoneId: "rhinebeck-farmhouse:m1", role: "ai_agent", signer: ADDR.aiAgent, decision: "reject", notes: "audit_matches_evidence failed", txHash: fakeHash("verdict:rhinebeck:m1"), at: "2026-10-22T16:02:00Z" },
  ],
};

// ---------------------------------------------------------------- verification, money, events

const check = (name: string, reason: string, result: "pass" | "warn" = "pass") => ({ check: name, result, reason, evidenceIds: [] });

export const VERIFICATIONS: Record<string, ProjectVerification> = {
  "maple-st-duplex": {
    identity: [check("license_active", "NY HIC-2207841 active (MOCK registry)"), check("insurance_in_force", "GL-44-19082 valid to 2027-06 (MOCK)")],
    feasibility: [check("sov_sums", "SoV lines sum to principal 120,000.00"), check("line_ranges", "All lines within Hudson Valley ranges")],
    capability: [check("track_record", "14 completed projects, 96% milestone pass rate")],
    decision: "pass",
    riskTier: "low",
    summary: "Established builder, feasible SoV, permits issued.",
    model: "mock",
    createdAt: "2026-10-20T13:40:00Z",
  },
  "rhinebeck-farmhouse": {
    identity: [check("license_active", "NY HIC-1984420 active (MOCK registry)")],
    feasibility: [check("sov_sums", "SoV lines sum to principal 60,000.00")],
    capability: [check("track_record", "6 completed projects; first renovation over 50k", "warn")],
    decision: "pass",
    riskTier: "medium",
    summary: "Verified; medium risk tier for project size.",
    model: "mock",
    createdAt: "2026-10-05T10:15:00Z",
  },
  "elm-ct-fourplex": {
    identity: [check("license_active", "NY HIC-1984420 active (MOCK registry)")],
    feasibility: [
      check("sov_sums", "SoV lines sum to principal 280,000.00"),
      check("site_exists", "Parcel shows a 2019 demolition permit but no imagery since; confirm the lot is clear and accessible", "warn"),
    ],
    capability: [check("capacity", "1 open project; capacity OK")],
    decision: "needs_human",
    riskTier: "medium",
    summary: "Site condition unconfirmed — pre-construction visit assigned.",
    model: "mock",
    createdAt: "2026-10-24T11:20:00Z",
  },
};

export const INVESTMENTS: Investment[] = [
  { projectId: "maple-st-duplex", investor: ADDR.ava, amount: "45000.00", tx: fakeHash("dep:maple:ava"), at: "2026-10-24T13:10:00Z" },
  { projectId: "maple-st-duplex", investor: ADDR.northbridge, amount: "50000.00", tx: fakeHash("dep:maple:nb"), at: "2026-10-24T13:20:00Z" },
  { projectId: "maple-st-duplex", investor: ADDR.marco, amount: "25000.00", tx: fakeHash("dep:maple:marco"), at: "2026-10-24T13:30:00Z" },
  { projectId: "rhinebeck-farmhouse", investor: ADDR.northbridge, amount: "40000.00", tx: fakeHash("dep:rb:nb"), at: "2026-10-08T15:00:00Z" },
  { projectId: "rhinebeck-farmhouse", investor: ADDR.ava, amount: "20000.00", tx: fakeHash("dep:rb:ava"), at: "2026-10-09T15:00:00Z" },
];

export const VAULTS: Record<string, VaultSnapshot> = {
  "maple-st-duplex": { assetsTotal: "132600.00", assetsAvailable: "0.00", sharesOutstanding: "120000", sharePrice: "1.105000", subscriptionDate: "2026-10-24T14:30:00Z", redemptionDate: "2027-11-24T00:00:00Z", phase: "investment" },
  "rhinebeck-farmhouse": { assetsTotal: "65100.00", assetsAvailable: "0.00", sharesOutstanding: "60000", sharePrice: "1.085000", subscriptionDate: "2026-10-10T23:59:00Z", redemptionDate: "2027-08-10T00:00:00Z", phase: "investment" },
};

export const LOANS: Record<string, LoanSnapshot> = {
  "maple-st-duplex": { principalOutstanding: "120000.00", totalValueOutstanding: "132600.00", periodicPayment: "11050.00", paymentRemaining: 12, nextPaymentDueDate: "2026-11-23T15:00:00Z" },
  "rhinebeck-farmhouse": { principalOutstanding: "60000.00", totalValueOutstanding: "65100.00", periodicPayment: "7233.33", paymentRemaining: 9, nextPaymentDueDate: "2026-11-11T12:00:00Z" },
};

const setup = (projectId: string, spv: string, builder: string, start: string, closeAt: string, deposits: Investment[], milestones: number): ChainEvent[] => {
  const at = (min: number) => new Date(new Date(start).getTime() + min * 60_000).toISOString();
  return [
    chainEvent({ projectId, kind: "verification_fee_paid", actor: builder, amount: "250.00", at: at(0) }),
    chainEvent({ projectId, kind: "project_verified", actor: ADDR.aiAgent, at: at(5) }),
    chainEvent({ projectId, kind: "inspector_assigned", actor: ADDR.platform, at: at(10) }),
    chainEvent({ projectId, kind: "vault_created", actor: ADDR.platform, at: at(11) }),
    chainEvent({ projectId, kind: "loan_broker_created", actor: ADDR.platform, at: at(12) }),
    chainEvent({ projectId, kind: "cover_deposited", actor: ADDR.platform, at: at(13) }),
    ...deposits.map((d) => chainEvent({ projectId, kind: "vault_deposit", actor: d.investor, amount: d.amount, at: d.at })),
    chainEvent({ projectId, kind: "loan_set", actor: spv, at: closeAt }),
    ...Array.from({ length: milestones }, (_, i) =>
      chainEvent({ projectId, milestoneId: `${projectId}:m${i + 1}`, kind: "escrow_created", actor: spv, at: new Date(new Date(closeAt).getTime() + (i + 1) * 4000).toISOString() }),
    ),
  ];
};

export const EVENTS: ChainEvent[] = [
  ...setup("maple-st-duplex", ADDR.spvMaple, ADDR.hvb, "2026-10-20T13:30:00Z", "2026-10-24T15:00:00Z", INVESTMENTS.slice(0, 3), 3),
  ...setup("rhinebeck-farmhouse", ADDR.spvRhinebeck, ADDR.catskill, "2026-10-05T10:00:00Z", "2026-10-11T12:00:00Z", INVESTMENTS.slice(3), 2),
  chainEvent({ projectId: "rhinebeck-farmhouse", milestoneId: "rhinebeck-farmhouse:m1", kind: "audit_attested", actor: ADDR.marcus, at: RB_AUDIT_AT }),
  chainEvent({ projectId: "rhinebeck-farmhouse", milestoneId: "rhinebeck-farmhouse:m1", kind: "verdict_attested", actor: ADDR.aiAgent, at: "2026-10-22T16:02:00Z" }),
  chainEvent({ projectId: "elm-ct-fourplex", kind: "verification_fee_paid", actor: ADDR.catskill, amount: "250.00", at: "2026-10-24T11:00:00Z" }),
];
