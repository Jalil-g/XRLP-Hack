// Mock world for NEXT_PUBLIC_API_MODE=mock: the docs/04-demo-script.md pre-stage as canned data. DATA ONLY.
// The mock never decides anything: verdicts, verifications and inspector assignments are canned here (SCRIPT) and played
// back by ./server.ts. Vault snapshots follow devnet (cash basis, decisions.md 10-24): AssetsTotal stays at principal when the
// loan closes and each repayment's interest raises the share price. Real outcomes come from core (verifier + ledger) in http mode.
//   A maple-st  the demo: verified, funded, closed, 3 escrows; M1 evidence + audit (passes), M2 reused photo + audit (fails)
//   B birch-rd  one escrow already past CancelAfter (keeper tick → cancel → LoanPay)
//   C oak-ave   repaid, vault in Redemption (withdrawable); source of the photo M2 reuses
//   D cedar-ln  draft by an unverified builder (onboarding: fee → verification → lock terms)
//   E elm-st    open for funding
import { explorerTxUrl } from "@xrlp/shared";
import { evidenceArtUri } from "../evidence-art";
import { OAK_AVE_ORIGINAL, fixtureUrl } from "../fixture-files";
import type {
  Attestation,
  Builder,
  ChainEvent,
  CheckResult,
  ChecksStatus,
  Evidence,
  Inspector,
  InspectorAssignment,
  InspectorAudit,
  Investment,
  LoanSnapshot,
  Milestone,
  Party,
  Project,
  ProjectVerification,
  Rlusd,
  SovLine,
  Verdict,
  VaultSnapshot,
  XrplAddress,
} from "../contract";

// ---------------------------------------------------------------- fake identifiers (pure JS, browser-safe)

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 64 hex chars, deterministic per seed. Looks like a tx hash; is not one. */
export const fakeHash = (seed: string) =>
  Array.from({ length: 8 }, (_, i) => fnv(`${i}|${seed}`).toString(16).padStart(8, "0"))
    .join("")
    .toUpperCase();

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const fakeAddress = (seed: string): XrplAddress => "r" + Array.from({ length: 33 }, (_, i) => B58[fnv(`a${i}|${seed}`) % 58]).join("");

const iso = (s: string) => new Date(s).toISOString();
const plusMin = (at: string, min: number) => new Date(new Date(at).getTime() + min * 60_000).toISOString();

// ---------------------------------------------------------------- parties

const party = (seed: string, p: Omit<Party, "address">): Party => ({ address: fakeAddress(seed), ...p });

export const PLATFORM = party("platform", { name: "Drawproof Platform", role: "platform", detail: "Vault + loan broker owner · credential issuer" });
export const RELEASE_SERVICE = party("release-service", {
  name: "Drawproof Release Service",
  role: "release_service",
  detail: "Holds escrow preimages · finishes only on a green suite",
});
export const AI_AGENT = party("ai-agent", { name: "Drawproof AI Verifier", role: "ai_agent", detail: "Attests verdict hashes" });
export const TRUSTEE = party("trustee", { name: "Hudson Fiduciary Trust", role: "trustee", detail: "Investor representative · 4th signer" });

const AVA = party("investor-ava", { name: "Ava Chen", role: "investor", detail: "Accredited · KYC_INVESTOR", kyc: true });
const NORTHBRIDGE = party("investor-northbridge", { name: "Northbridge Family Office", role: "investor", detail: "Institutional · KYC_INVESTOR", kyc: true });
const MARCO = party("investor-marco", { name: "Marco Ruiz", role: "investor", detail: "Accredited · KYC_INVESTOR", kyc: true });
const JORDAN = party("investor-jordan", { name: "Jordan Lee", role: "investor", detail: "No KYC credential", kyc: false });
const INVESTORS = [AVA, NORTHBRIDGE, MARCO, JORDAN];

const builder = (b: Omit<Builder, "address">): Builder => ({ ...b, address: fakeAddress(`builder-${b.id}`) });
const HVB = builder({
  id: "hudson-valley-builders",
  name: "Hudson Valley Builders",
  licenseNumber: "NY-HIC-2017-04418",
  insurancePolicy: "GL-7731902 · $2M aggregate",
  completedProjects: 23,
  riskTier: "low",
  verified: true,
  credentialTx: fakeHash("cred:hvb"),
});
const RIDGELINE = builder({
  id: "ridgeline-commercial",
  name: "Ridgeline Commercial",
  licenseNumber: "NY-GC-2014-11902",
  insurancePolicy: "GL-5530417 · $5M aggregate",
  completedProjects: 11,
  riskTier: "low",
  verified: true,
  credentialTx: fakeHash("cred:ridgeline"),
});
const CATSKILL = builder({
  id: "catskill-homes",
  name: "Catskill Homes",
  licenseNumber: "NY-HIC-2019-07731",
  insurancePolicy: "GL-6120088 · $1M aggregate",
  completedProjects: 9,
  riskTier: "medium",
  verified: true,
  credentialTx: fakeHash("cred:catskill"),
});
const KINGSTON = builder({
  id: "kingston-craft-homes",
  name: "Kingston Craft Homes",
  licenseNumber: "NY-HIC-2021-10254",
  insurancePolicy: "GL-8841203 · $1M aggregate",
  completedProjects: 4,
  riskTier: "medium",
  verified: false,
});

const inspector = (seed: string, i: Omit<Inspector, "address" | "credentialTx" | "verified"> & { firm: string }): Inspector & { firm: string } => ({
  verified: true,
  ...i,
  address: fakeAddress(seed),
  credentialTx: fakeHash(`cred:${seed}`),
});
const DANA = inspector("inspector-dana", {
  name: "Dana Okafor, PE",
  homeGeo: { lat: 41.8287, lng: -74.0751 },
  licenseNumber: "NY PE-089412",
  firm: "Catskill Inspection Group",
  trades: ["Concrete", "Carpentry", "Structural"],
});
const MARCUS = inspector("inspector-marcus", {
  name: "Marcus Lindqvist",
  homeGeo: { lat: 41.9973, lng: -73.8768 },
  licenseNumber: "ICC 5381207",
  firm: "Hudson Code Services",
  trades: ["Carpentry", "Roofing", "Openings"],
});
const PRIYA = inspector("inspector-priya", {
  name: "Priya Raman, PE",
  homeGeo: { lat: 41.0534, lng: -73.7629 },
  licenseNumber: "NY PE-091377",
  firm: "Raman Engineering",
  trades: ["MEP", "Structural"],
});

// ---------------------------------------------------------------- the suite (names only; the verifier owns what they mean)

export const SUITE = [
  "required_evidence_present",
  "gps_within_site",
  "photo_fresh",
  "no_duplicate_photo",
  "invoice_matches_budget",
  "inspector_audit_present",
  "audit_checklist_complete",
  "stage_visually_consistent",
  "audit_matches_evidence",
  "document_consistency",
];

const pending = (): ChecksStatus => ({ required: [], optional: [], outcome: "pending", suite: [...SUITE] });

// ---------------------------------------------------------------- builders of canned records

type Ev = Omit<ChainEvent, "txHash" | "explorerUrl"> & { txHash?: string };
const event = (e: Ev): ChainEvent => {
  const txHash = e.txHash ?? fakeHash(`ev:${e.projectId}:${e.milestoneId ?? ""}:${e.kind}:${e.at}:${e.actor ?? ""}`);
  return { ...e, txHash, explorerUrl: explorerTxUrl(txHash) };
};

/** `scene` is either an evidence-art scene name or a path under the verifier's fixture evidence (contains "/"). */
function photo(id: string, scene: string, variant: number, filename: string, at: string, meta: Evidence["meta"]): Evidence {
  return { id, kind: "photo", filename, mimeType: "image/jpeg", uri: scene.includes("/") ? fixtureUrl(scene) : evidenceArtUri(scene, variant), sha256: fakeHash(`file:${id}`).toLowerCase(), meta, uploadedAt: at };
}
function invoice(id: string, filename: string, total: Rlusd, at: string): Evidence {
  return { id, kind: "invoice", filename, mimeType: "application/pdf", uri: evidenceArtUri("invoice", 1), sha256: fakeHash(`file:${id}`).toLowerCase(), meta: { invoiceTotal: total }, uploadedAt: at };
}
function doc(id: string, filename: string, at: string): Evidence {
  return { id, kind: "document", filename, mimeType: "application/pdf", uri: evidenceArtUri("document", 1), sha256: fakeHash(`file:${id}`).toLowerCase(), meta: {}, uploadedAt: at };
}

const check = (check: string, result: CheckResult["result"], reason: string, evidenceIds: string[] = []): CheckResult => ({ check, result, reason, evidenceIds });

function suiteResult(m: Milestone, p: Project, decision: Verdict["decision"], confidence: number, summary: string, checks: CheckResult[], at: string): ChecksStatus {
  const verdict: Verdict = {
    milestoneId: m.id,
    decision,
    confidence,
    summary,
    checks,
    policy: { projectType: p.type, riskTier: "low", requiredInspectors: m.requiredInspectors },
    model: "mock",
    createdAt: at,
  };
  return { required: checks, optional: [], verdict, outcome: decision, suite: [...SUITE] };
}

function escrowFor(p: Project, m: Milestone, at: string, seq: number): NonNullable<Milestone["escrow"]> {
  return {
    owner: p.chain.spv!,
    offerSequence: seq,
    condition: `A0258020${fakeHash(`cond:${m.id}`)}810120`,
    createTx: fakeHash(`ev:${p.id}:${m.id}:escrow_created:${at}:${p.chain.spv}`),
  };
}

function chainIds(id: string): Project["chain"] {
  return {
    spv: fakeAddress(`spv:${id}`),
    vaultId: fakeHash(`vault:${id}`),
    loanBrokerId: fakeHash(`broker:${id}`),
    shareMptIssuanceId: fakeHash(`mpt:${id}`).slice(0, 48),
  };
}

const sov = (code: string, title: string, amount: Rlusd, trade: string, evidence: SovLine["evidence"], visualCriteria: string[]): SovLine => ({
  code,
  title,
  amount,
  trade,
  evidence,
  visualCriteria,
});

const ms = (projectId: string, index: number, title: string, amount: Rlusd, sovCodes: string[], status: Milestone["status"], cancelAfter?: string): Milestone => ({
  id: `${projectId}-m${index + 1}`,
  index,
  templateKey: title.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, ""),
  title,
  amount,
  sovCodes,
  requiredInspectors: 1,
  status,
  cancelAfter,
});

// ---------------------------------------------------------------- canned verifier / platform outputs

function verification(riskTier: ProjectVerification["riskTier"], at: string, o: { licence: string; insurance: string; entity: string; sov: string; ranges: string; permit: string; site: string; record: string; load: string }): ProjectVerification {
  return {
    identity: [
      check("licence_active", "pass", o.licence),
      check("insurance_in_force", "pass", o.insurance),
      check("entity_match", "pass", o.entity),
      check("sanctions_screen", "pass", "No match on the OFAC SDN list (MOCK list)"),
    ],
    feasibility: [
      check("sov_sums_to_principal", "pass", o.sov),
      check("line_amounts_in_range", "pass", o.ranges),
      check("permits_present", "pass", o.permit),
      check("site_resolves", "pass", o.site),
      check("timeline_realistic", "pass", "Milestone dates fit inside the loan term with a 60-day buffer"),
    ],
    capability: [check("track_record", "pass", o.record), check("open_load", "pass", o.load)],
    decision: "pass",
    riskTier,
    summary: "Identity, feasibility and capability checks passed. Project verified.",
    model: "mock",
    createdAt: at,
  };
}

/** Canned suite results for the demo milestones, keyed by milestone id. Played on run-checks when an audit exists. */
function demoVerdicts(maple: Project, ev: Record<string, Evidence[]>): Record<string, (at: string) => ChecksStatus> {
  const [m1, m2, m3] = maple.milestones as [Milestone, Milestone, Milestone];
  const reused = ev[m2.id]!.find((e) => e.filename === "IMG_5121.jpg")!;
  return {
    [m1.id]: (at) =>
      suiteResult(m1, maple, "pass", 0.93, "All 10 required checks passed.", [
        check("required_evidence_present", "pass", "All required items present: 3 photos, 2 invoices, footing inspection sign-off"),
        check("gps_within_site", "pass", "3 of 3 photos within 18 m of 418 Maple St (geofence 60 m)"),
        check("photo_fresh", "pass", "Photos taken Oct 22, after this escrow was created on Oct 21"),
        check("no_duplicate_photo", "pass", "No match against any photo on the platform (closest distance 27/64)"),
        check("invoice_matches_budget", "pass", "Invoices total 35,120 RLUSD vs 36,000 on SoV lines 31-200 + 03-300 (−2.4%)"),
        check("inspector_audit_present", "pass", "Signed by Dana Okafor, PE (assigned inspector), attested on-chain, covers this evidence"),
        check("audit_checklist_complete", "pass", "2 of 2 SoV lines marked done"),
        check("stage_visually_consistent", "pass", "Cured foundation walls and anchor bolts visible; no framing yet"),
        check("audit_matches_evidence", "pass", "Inspector's photos and checklist agree with the builder's evidence"),
        check("document_consistency", "pass", "Sign-off, invoices and permit agree on address, dates and parties"),
      ], at),
    [m2.id]: (at) =>
      suiteResult(m2, maple, "fail", 0.97, "1 required check failed: a photo is reused from another project.", [
        check("required_evidence_present", "pass", "All required items present: 4 photos, 1 invoice"),
        check("gps_within_site", "pass", "4 of 4 photos within 22 m of 418 Maple St (geofence 60 m)"),
        check("photo_fresh", "pass", "EXIF dates Oct 23, after this escrow was created"),
        check("no_duplicate_photo", "fail", "IMG_5121.jpg matches Oak Ave project photo, distance 3/64, taken 41 days before this escrow existed", [reused.id]),
        check("invoice_matches_budget", "pass", "Lumber invoice 41,300 RLUSD vs 42,000 on SoV lines 06-100 + 06-160 (−1.7%)"),
        check("inspector_audit_present", "pass", "Signed by Dana Okafor, PE (assigned inspector), attested on-chain"),
        check("audit_checklist_complete", "pass", "Framing done · sheathing partial · no line marked not done"),
        check("stage_visually_consistent", "pass", "Exterior walls framed on all sides, roof trusses set"),
        check("audit_matches_evidence", "pass", "Inspector's checklist is consistent with the builder's photos"),
        check("document_consistency", "pass", "Invoice parties and delivery address match the project"),
      ], at),
    [m3.id]: (at) =>
      suiteResult(m3, maple, "needs_human", 0.64, "Confidence 0.64 is below this milestone's 0.80 minimum: operator review.", [
        check("required_evidence_present", "pass", "All required items present: 4 photos, 2 invoices"),
        check("gps_within_site", "pass", "4 of 4 photos within 25 m of 418 Maple St (geofence 60 m)"),
        check("photo_fresh", "pass", "Photos taken after this escrow was created"),
        check("no_duplicate_photo", "pass", "No match against any photo on the platform"),
        check("invoice_matches_budget", "pass", "Invoices total 41,050 RLUSD vs 42,000 on SoV lines 07-310 + 08-500 (−2.3%)"),
        check("inspector_audit_present", "pass", "Signed by Dana Okafor, PE (assigned inspector), attested on-chain"),
        check("audit_checklist_complete", "pass", "2 of 2 SoV lines marked done"),
        check("stage_visually_consistent", "warn", "Roof covering visible; north-side windows not visible in any photo"),
        check("audit_matches_evidence", "pass", "Inspector's checklist agrees with the builder's photos"),
        check("document_consistency", "pass", "Invoices agree on address and parties"),
      ], at),
  };
}

// ---------------------------------------------------------------- the world

export interface MockDb {
  parties: Party[];
  builders: Builder[];
  inspectors: Inspector[];
  projects: Project[];
  investments: Investment[];
  /** projectId → investor → vault shares. */
  holdings: Record<string, Record<XrplAddress, string>>;
  events: ChainEvent[];
  verifications: Record<string, ProjectVerification>;
  assignments: Record<string, InspectorAssignment>;
  evidence: Record<string, Evidence[]>;
  audits: Record<string, InspectorAudit[]>;
  attestations: Record<string, Attestation[]>;
  checks: Record<string, ChecksStatus>;
  vaults: Record<string, VaultSnapshot>;
  loans: Record<string, LoanSnapshot>;
  /** Milestones whose evidence was replaced after a failed run (the resubmission plays back a pass). */
  resubmitted: Record<string, boolean>;
  /** RLUSD balances by account (builders, SPVs) for the money map. */
  balances: Record<XrplAddress, Rlusd>;
  seq: number;
}

/** Canned outcomes the mock plays back (never computed). */
export interface MockScript {
  verdicts: Record<string, (at: string) => ChecksStatus>;
  missingAudit: (p: Project, m: Milestone, at: string) => ChecksStatus;
  genericPass: (p: Project, m: Milestone, at: string) => ChecksStatus;
  verifications: Record<string, (at: string) => ProjectVerification>;
  genericVerification: (at: string) => ProjectVerification;
  assignments: Record<string, InspectorAssignment>;
  genericAssignment: InspectorAssignment;
}

export function seed(): { db: MockDb; script: MockScript } {
  const events: ChainEvent[] = [];
  const evidence: Record<string, Evidence[]> = {};
  const audits: Record<string, InspectorAudit[]> = {};
  const attestations: Record<string, Attestation[]> = {};
  const checks: Record<string, ChecksStatus> = {};
  const investments: Investment[] = [];
  const holdings: MockDb["holdings"] = {};
  const push = (e: Ev) => {
    const ce = event(e);
    events.push(ce);
    return ce;
  };
  const deposit = (projectId: string, inv: Party, amount: Rlusd, at: string) => {
    const ce = push({ projectId, kind: "vault_deposit", actor: inv.address, amount, at });
    investments.push({ projectId, investor: inv.address, amount, tx: ce.txHash, at });
    (holdings[projectId] ??= {})[inv.address] = `${amount}0000`; // 1 share per RLUSD during Subscription (amounts are 2dp)
  };
  const onboarding = (p: Project, b: Builder, at: string, firstProject: boolean) => {
    push({ projectId: p.id, kind: "verification_fee_paid", actor: b.address, amount: "250.00", at });
    push({ projectId: p.id, kind: "project_verified", actor: PLATFORM.address, at: plusMin(at, 15) });
    if (firstProject) {
      push({ projectId: p.id, kind: "credential_issued", actor: PLATFORM.address, at: plusMin(at, 16), txHash: b.credentialTx });
      push({ projectId: p.id, kind: "credential_accepted", actor: b.address, at: plusMin(at, 18) });
    }
  };
  const openFunding = (p: Project, at: string, cover: Rlusd) => {
    push({ projectId: p.id, kind: "inspector_assigned", actor: PLATFORM.address, at });
    push({ projectId: p.id, kind: "vault_created", actor: PLATFORM.address, at });
    push({ projectId: p.id, kind: "loan_broker_created", actor: PLATFORM.address, at });
    push({ projectId: p.id, kind: "cover_deposited", actor: PLATFORM.address, amount: cover, at });
  };
  const close = (p: Project, at: string) => {
    p.chain.loanId = fakeHash(`loan:${p.id}`);
    push({ projectId: p.id, kind: "loan_set", actor: PLATFORM.address, amount: p.terms.principal, at });
    p.milestones.forEach((m, i) => {
      m.escrow = escrowFor(p, m, at, 1201 + i * 2);
      push({ projectId: p.id, milestoneId: m.id, kind: "escrow_created", actor: p.chain.spv, amount: m.amount, at, txHash: m.escrow.createTx });
    });
  };
  const audit = (p: Project, m: Milestone, insp: Inspector, at: string, checklist: InspectorAudit["checklist"], photos: Evidence[], notes: string) => {
    const ce = push({ projectId: p.id, milestoneId: m.id, kind: "audit_attested", actor: insp.address, at });
    const a: InspectorAudit = { milestoneId: m.id, inspector: insp.address, evidenceBundleHash: fakeHash(`bundle:${m.id}`).toLowerCase(), checklist, photos, notes, txHash: ce.txHash, at };
    (audits[m.id] ??= []).push(a);
    (attestations[m.id] ??= []).push({ milestoneId: m.id, role: "inspector", kind: "audit", hash: fakeHash(`audit:${m.id}`).toLowerCase(), signer: insp.address, decision: "approve", notes, txHash: ce.txHash, at });
  };
  /** Records a played-back pass + release (history for B and C). */
  const released = (p: Project, m: Milestone, builderAddr: XrplAddress, at: string, result: ChecksStatus) => {
    checks[m.id] = result;
    const v = push({ projectId: p.id, milestoneId: m.id, kind: "verdict_attested", actor: AI_AGENT.address, at });
    (attestations[m.id] ??= []).push({ milestoneId: m.id, role: "ai_agent", kind: "verdict", hash: fakeHash(`verdict:${m.id}`).toLowerCase(), signer: AI_AGENT.address, decision: "approve", notes: result.verdict?.summary ?? "", txHash: v.txHash, at });
    const fin = push({ projectId: p.id, milestoneId: m.id, kind: "escrow_finished", actor: builderAddr, amount: m.amount, at });
    (attestations[m.id] ??= []).push({ milestoneId: m.id, role: "release_service", kind: "release", hash: fakeHash(`release:${m.id}`).toLowerCase(), signer: RELEASE_SERVICE.address, decision: "approve", notes: "Suite green; escrow finished", txHash: fakeHash(`att-release:${m.id}`), at });
    m.status = "released";
    m.escrow!.finishTx = fin.txHash;
  };

  // ======================================================== A · Maple St Duplex (the demo)
  const mapleSov = [
    sov("31-200", "Site prep & excavation", "8000.00", "Sitework", [{ kind: "photo", description: "Excavated footprint, wide shot", minCount: 1 }], ["excavation to footing depth"]),
    sov("03-300", "Footings & foundation walls", "28000.00", "Concrete", [
      { kind: "photo", description: "Poured foundation, wide shot + close-up", minCount: 2 },
      { kind: "invoice", description: "Concrete + rebar invoices", minCount: 1 },
      { kind: "document", description: "Footing inspection sign-off", minCount: 1 },
    ], ["cured concrete slab or foundation walls", "anchor bolts visible", "no framing yet"]),
    sov("06-100", "Rough framing", "34000.00", "Carpentry", [
      { kind: "photo", description: "All exterior walls framed, roof trusses set", minCount: 3 },
      { kind: "invoice", description: "Lumber package invoice", minCount: 1 },
    ], ["wall framing on all sides", "roof trusses or rafters installed"]),
    sov("06-160", "Wall & roof sheathing", "8000.00", "Carpentry", [{ kind: "photo", description: "Sheathing on all elevations", minCount: 1 }], ["sheathing on walls and roof deck"]),
    sov("07-310", "Roofing", "22000.00", "Roofing", [
      { kind: "photo", description: "Roof covering complete", minCount: 2 },
      { kind: "invoice", description: "Roofing invoice", minCount: 1 },
    ], ["roof covering installed"]),
    sov("08-500", "Windows & exterior doors", "20000.00", "Openings", [
      { kind: "photo", description: "Windows and exterior doors installed", minCount: 2 },
      { kind: "invoice", description: "Windows invoice", minCount: 1 },
    ], ["windows and exterior doors installed", "house wrap"]),
  ];
  const maple: Project = {
    id: "maple-st",
    name: "Maple St Duplex",
    type: "residential_new",
    builderId: HVB.id,
    siteAddress: "418 Maple St, Kingston, NY 12401",
    siteGeo: { lat: 41.9312, lng: -74.0004, radiusM: 60 },
    description: "Ground-up side-by-side duplex, 2 × 3BR/2.5BA (1,450 sq ft each) on a 0.22-acre infill lot. Permits issued Sep 2026; pre-leased to a local property manager.",
    terms: { principal: "120000.00", interestRateBps: 1050, termDays: 365, paymentIntervalDays: 30, fundingDeadline: iso("2026-10-21T16:00:00Z") },
    status: "escrowed",
    sov: mapleSov,
    milestones: [
      ms("maple-st", 0, "Foundation", "36000.00", ["31-200", "03-300"], "audited", iso("2027-01-15T00:00:00Z")),
      ms("maple-st", 1, "Framing", "42000.00", ["06-100", "06-160"], "audited", iso("2027-03-15T00:00:00Z")),
      ms("maple-st", 2, "Roof & dry-in", "42000.00", ["07-310", "08-500"], "audited", iso("2027-05-15T00:00:00Z")),
    ],
    chain: chainIds("maple-st"),
  };
  const [mm1, mm2, mm3] = maple.milestones as [Milestone, Milestone, Milestone];
  onboarding(maple, HVB, iso("2026-10-17T14:00:00Z"), true);
  openFunding(maple, iso("2026-10-18T15:00:00Z"), "12000.00");
  deposit(maple.id, AVA, "45000.00", iso("2026-10-19T16:41:00Z"));
  deposit(maple.id, NORTHBRIDGE, "50000.00", iso("2026-10-20T13:12:00Z"));
  deposit(maple.id, MARCO, "25000.00", iso("2026-10-20T18:30:00Z"));
  close(maple, iso("2026-10-21T16:05:00Z"));
  for (const m of maple.milestones) checks[m.id] = pending();
  // M1: genuine evidence + Dana's audit
  const m1At = iso("2026-10-22T15:10:00Z");
  evidence[mm1.id] = [
    photo("maple-st-m1-p1", "maple-st/foundation/foundation-01-wide.jpg", 0, "IMG_2041.jpg", m1At, { takenAt: iso("2026-10-22T13:02:00Z"), gps: { lat: 41.93128, lng: -74.00031 }, perceptualHash: "c3a1f0e29b7d4410" }),
    photo("maple-st-m1-p2", "maple-st/foundation/foundation-02-bolts.jpg", 0, "IMG_2044.jpg", m1At, { takenAt: iso("2026-10-22T13:05:00Z"), gps: { lat: 41.93109, lng: -74.00052 }, perceptualHash: "d1b2e0f39a6c5521" }),
    photo("maple-st-m1-p3", "maple-st/foundation/foundation-03-walls.jpg", 0, "IMG_2047.jpg", m1At, { takenAt: iso("2026-10-22T13:09:00Z"), gps: { lat: 41.93135, lng: -74.00044 }, perceptualHash: "a4c3d1e28b5f6632" }),
    invoice("maple-st-m1-i1", "kingston-ready-mix-4410.pdf", "27340.00", m1At),
    invoice("maple-st-m1-i2", "hudson-excavation-0981.pdf", "7780.00", m1At),
    doc("maple-st-m1-d1", "footing-inspection-signoff.pdf", m1At),
  ];
  mm1.status = "audited";
  audit(maple, mm1, DANA, iso("2026-10-22T17:40:00Z"), [
    { sovCode: "31-200", status: "done" },
    { sovCode: "03-300", status: "done", note: "Walls cured; anchor bolts at 6 ft o.c." },
  ], [
    photo("maple-st-m1-a1", "maple-st/audits/photos/audit-foundation-01-rebar.jpg", 0, "okafor-site-01.jpg", iso("2026-10-22T17:40:00Z"), { takenAt: iso("2026-10-22T16:20:00Z"), gps: { lat: 41.93121, lng: -74.00046 } }),
    photo("maple-st-m1-a2", "maple-st/audits/photos/audit-foundation-02-site.jpg", 0, "okafor-site-02.jpg", iso("2026-10-22T17:40:00Z"), { takenAt: iso("2026-10-22T16:26:00Z"), gps: { lat: 41.93113, lng: -74.00039 } }),
  ], "Foundation complete per plans. Footing inspection signed by the town on Oct 20.");
  // M2: reused Oak Ave photo (fresh EXIF, neutral filename) + Dana's audit (sheathing partial)
  const m2At = iso("2026-10-23T14:30:00Z");
  evidence[mm2.id] = [
    photo("maple-st-m2-p1", "maple-st/framing/framing-01-wide.jpg", 0, "IMG_2210.jpg", m2At, { takenAt: iso("2026-10-23T12:40:00Z"), gps: { lat: 41.93119, lng: -74.00035 }, perceptualHash: "e6f5a3b19c2d8854" }),
    photo("maple-st-m2-p2", "maple-st/framing/framing-02-corner.jpg", 0, "IMG_2213.jpg", m2At, { takenAt: iso("2026-10-23T12:44:00Z"), gps: { lat: 41.93131, lng: -74.0005 }, perceptualHash: "f7a6b4c28d3e9965" }),
    photo("maple-st-m2-p3", "maple-st/framing/framing-03-wall.jpg", 0, "IMG_2219.jpg", m2At, { takenAt: iso("2026-10-23T12:51:00Z"), gps: { lat: 41.93107, lng: -74.00029 }, perceptualHash: "a8b7c5d39e4f0076" }),
    photo("maple-st-m2-p4", "maple-st/framing/IMG_5121.jpg", 0, "IMG_5121.jpg", m2At, { takenAt: iso("2026-10-23T12:55:00Z"), gps: { lat: 41.93124, lng: -74.00041 }, perceptualHash: "9b8c7d6e5f4a3b2c" }),
    invoice("maple-st-m2-i1", "catskill-lumber-7720.pdf", "41300.00", m2At),
  ];
  audit(maple, mm2, DANA, iso("2026-10-23T18:05:00Z"), [
    { sovCode: "06-100", status: "done" },
    { sovCode: "06-160", status: "partial", note: "Roof deck sheathed; north wall sheathing ~70%" },
  ], [photo("maple-st-m2-a1", "maple-st/audits/photos/audit-framing-01-frame.jpg", 0, "okafor-site-03.jpg", iso("2026-10-23T18:05:00Z"), { takenAt: iso("2026-10-23T17:10:00Z"), gps: { lat: 41.93126, lng: -74.00048 } })],
  "Framing complete; sheathing in progress on the north elevation.");

  // M3 (off-script): evidence + audit present; the suite comes back below its confidence minimum → operator decision
  const m3At = iso("2026-10-24T13:20:00Z");
  evidence[mm3.id] = [
    photo("maple-st-m3-p1", "dry_in", 1, "IMG_2301.jpg", m3At, { takenAt: iso("2026-10-24T12:10:00Z"), gps: { lat: 41.93122, lng: -74.00038 } }),
    photo("maple-st-m3-p2", "dry_in", 2, "IMG_2304.jpg", m3At, { takenAt: iso("2026-10-24T12:14:00Z"), gps: { lat: 41.93114, lng: -74.00049 } }),
    photo("maple-st-m3-p3", "dry_in", 3, "IMG_2309.jpg", m3At, { takenAt: iso("2026-10-24T12:19:00Z"), gps: { lat: 41.93129, lng: -74.00033 } }),
    photo("maple-st-m3-p4", "dry_in", 4, "IMG_2312.jpg", m3At, { takenAt: iso("2026-10-24T12:25:00Z"), gps: { lat: 41.93118, lng: -74.00044 } }),
    invoice("maple-st-m3-i1", "hudson-roofing-1188.pdf", "21400.00", m3At),
    invoice("maple-st-m3-i2", "valley-windows-3307.pdf", "19650.00", m3At),
  ];
  audit(maple, mm3, DANA, iso("2026-10-24T15:00:00Z"), [
    { sovCode: "07-310", status: "done" },
    { sovCode: "08-500", status: "done", note: "North-side windows installed; photographed from inside" },
  ], [], "Roof covering complete. All windows and exterior doors installed.");

  // ======================================================== B · Birch Rd Cottage (stall → refund)
  const birch: Project = {
    id: "birch-rd",
    name: "Birch Rd Cottage Renovation",
    type: "residential_renovation",
    builderId: CATSKILL.id,
    siteAddress: "27 Birch Rd, Saugerties, NY 12477",
    siteGeo: { lat: 42.0773, lng: -73.9529, radiusM: 50 },
    description: "Gut renovation of a 1940s cottage: new MEP rough-in, insulation, kitchen and bath. Resale on completion.",
    terms: { principal: "60000.00", interestRateBps: 1125, termDays: 300, paymentIntervalDays: 90, fundingDeadline: iso("2026-08-01T16:00:00Z") },
    status: "escrowed",
    sov: [
      sov("02-410", "Selective demolition", "9000.00", "Demolition", [{ kind: "photo", description: "Stripped interior", minCount: 2 }], ["exposed studs"]),
      sov("22-050", "Plumbing & electrical rough-in", "15000.00", "MEP", [
        { kind: "photo", description: "New rough plumbing and wiring", minCount: 2 },
        { kind: "invoice", description: "Trade invoices", minCount: 1 },
      ], ["new wiring or piping visible"]),
      sov("09-900", "Interior finishes", "36000.00", "Finishes", [
        { kind: "photo", description: "Finished rooms", minCount: 4 },
        { kind: "document", description: "Final permit sign-off", minCount: 1 },
      ], ["finished walls", "fixtures installed"]),
    ],
    milestones: [
      ms("birch-rd", 0, "Demolition & rough-in", "24000.00", ["02-410", "22-050"], "escrowed", iso("2026-09-30T00:00:00Z")),
      ms("birch-rd", 1, "Finishes", "36000.00", ["09-900"], "expired", iso("2026-10-20T00:00:00Z")),
    ],
    chain: chainIds("birch-rd"),
  };
  const [bm1, bm2] = birch.milestones as [Milestone, Milestone];
  onboarding(birch, CATSKILL, iso("2026-07-10T14:00:00Z"), true);
  openFunding(birch, iso("2026-07-12T15:00:00Z"), "6000.00");
  deposit(birch.id, NORTHBRIDGE, "40000.00", iso("2026-07-20T13:00:00Z"));
  deposit(birch.id, AVA, "20000.00", iso("2026-07-24T19:20:00Z"));
  close(birch, iso("2026-08-01T16:10:00Z"));
  evidence[bm1.id] = [
    photo("birch-rd-m1-p1", "demo_rough", 1, "IMG_0912.jpg", iso("2026-09-08T15:00:00Z"), { takenAt: iso("2026-09-08T13:30:00Z"), gps: { lat: 42.07734, lng: -73.95281 } }),
    photo("birch-rd-m1-p2", "demo_rough", 2, "IMG_0915.jpg", iso("2026-09-08T15:00:00Z"), { takenAt: iso("2026-09-08T13:36:00Z"), gps: { lat: 42.07722, lng: -73.95302 } }),
    invoice("birch-rd-m1-i1", "ulster-electric-2231.pdf", "14650.00", iso("2026-09-08T15:00:00Z")),
  ];
  audit(birch, bm1, MARCUS, iso("2026-09-09T16:00:00Z"), [
    { sovCode: "02-410", status: "done" },
    { sovCode: "22-050", status: "done" },
  ], [], "Rough-in passed town inspection Sep 9.");
  released(birch, bm1, CATSKILL.address, iso("2026-09-10T14:20:00Z"), genericPassFor(birch, bm1, iso("2026-09-10T14:19:00Z")));
  checks[bm2.id] = pending();

  // ======================================================== C · Oak Ave Townhouse (repaid, redemption open)
  const oak: Project = {
    id: "oak-ave",
    name: "Oak Ave Townhouse",
    type: "residential_new",
    builderId: RIDGELINE.id,
    siteAddress: "112 Oak Ave, Beacon, NY 12508",
    siteGeo: { lat: 41.5048, lng: -73.9696, radiusM: 60 },
    description: "Two-unit townhouse on an infill lot near Main St. Completed and sold Sep 2026.",
    terms: { principal: "90000.00", interestRateBps: 1000, termDays: 210, paymentIntervalDays: 30, fundingDeadline: iso("2026-03-01T16:00:00Z") },
    status: "completed",
    sov: [
      sov("03-300", "Foundation", "27000.00", "Concrete", [{ kind: "photo", description: "Poured foundation", minCount: 2 }], ["foundation walls"]),
      sov("06-100", "Framing", "36000.00", "Carpentry", [{ kind: "photo", description: "Framing complete", minCount: 2 }], ["wall framing"]),
      sov("07-310", "Roof & dry-in", "27000.00", "Roofing", [{ kind: "photo", description: "Roof + windows", minCount: 2 }], ["roof covering"]),
    ],
    milestones: [
      ms("oak-ave", 0, "Foundation", "27000.00", ["03-300"], "escrowed", iso("2026-06-01T00:00:00Z")),
      ms("oak-ave", 1, "Framing", "36000.00", ["06-100"], "escrowed", iso("2026-08-01T00:00:00Z")),
      ms("oak-ave", 2, "Roof & dry-in", "27000.00", ["07-310"], "escrowed", iso("2026-10-01T00:00:00Z")),
    ],
    chain: chainIds("oak-ave"),
  };
  onboarding(oak, RIDGELINE, iso("2026-02-02T14:00:00Z"), true);
  openFunding(oak, iso("2026-02-04T15:00:00Z"), "9000.00");
  deposit(oak.id, AVA, "30000.00", iso("2026-02-10T15:00:00Z"));
  deposit(oak.id, MARCO, "60000.00", iso("2026-02-18T15:00:00Z"));
  close(oak, iso("2026-03-01T16:10:00Z"));
  const oakDates = ["2026-05-12T15:00:00Z", "2026-09-12T15:00:00Z", "2026-09-29T15:00:00Z"];
  oak.milestones.forEach((m, i) => {
    const at = iso(oakDates[i]!);
    evidence[m.id] = [
      photo(`${m.id}-p1`, i === 1 ? OAK_AVE_ORIGINAL : ["foundation", "framing", "dry_in"][i]!, 1, i === 1 ? "OAK_0412.jpg" : `OAK_0${300 + i * 50}.jpg`, at, {
        takenAt: i === 1 ? iso("2026-09-10T14:22:00Z") : at,
        gps: { lat: 41.50482, lng: -73.96957 },
        perceptualHash: i === 1 ? "9b8c7d6e5f4a3b2d" : undefined,
      }),
    ];
    audit(oak, m, MARCUS, at, (oak.sov ?? []).filter((l) => (m.sovCodes ?? []).includes(l.code)).map((l) => ({ sovCode: l.code, status: "done" as const })), [], "Complete per plans.");
    released(oak, m, RIDGELINE.address, at, genericPassFor(oak, m, at));
  });
  push({ projectId: oak.id, kind: "loan_payment", actor: oak.chain.spv, amount: "96480.00", at: iso("2026-10-06T15:00:00Z") });

  // ======================================================== D · Cedar Ln ADU (draft: onboarding)
  const cedar: Project = {
    id: "cedar-ln",
    name: "Cedar Ln ADU",
    type: "residential_new",
    builderId: KINGSTON.id,
    siteAddress: "9 Cedar Ln, Woodstock, NY 12498",
    siteGeo: { lat: 42.0409, lng: -74.1182, radiusM: 50 },
    description: "Detached 640 sq ft accessory dwelling unit with its own utilities. Long-term rental.",
    terms: { principal: "80000.00", interestRateBps: 1100, termDays: 300, paymentIntervalDays: 30, fundingDeadline: iso("2026-11-21T16:00:00Z") },
    status: "draft",
    sov: [
      sov("03-300", "Slab foundation", "18000.00", "Concrete", [
        { kind: "photo", description: "Poured slab, wide + close-up", minCount: 3 },
        { kind: "invoice", description: "Concrete invoice", minCount: 1 },
      ], ["cured slab", "anchor bolts visible"]),
      sov("06-100", "Framing & sheathing", "26000.00", "Carpentry", [
        { kind: "photo", description: "Walls + roof framed and sheathed", minCount: 3 },
        { kind: "invoice", description: "Lumber invoice", minCount: 1 },
      ], ["wall framing on all sides", "roof sheathing"]),
      sov("07-310", "Roofing & windows", "16000.00", "Roofing", [{ kind: "photo", description: "Roof + windows installed", minCount: 2 }], ["roof covering", "windows installed"]),
      sov("09-900", "Interior finishes", "20000.00", "Finishes", [
        { kind: "photo", description: "Finished interior", minCount: 4 },
        { kind: "document", description: "Certificate of occupancy", minCount: 1 },
      ], ["finished walls", "fixtures installed"]),
    ],
    milestones: [
      ms("cedar-ln", 0, "Slab foundation", "18000.00", ["03-300"], "pending"),
      ms("cedar-ln", 1, "Framing & sheathing", "26000.00", ["06-100"], "pending"),
      ms("cedar-ln", 2, "Roofing & windows", "16000.00", ["07-310"], "pending"),
      ms("cedar-ln", 3, "Interior finishes", "20000.00", ["09-900"], "pending"),
    ],
    chain: {},
  };
  for (const m of cedar.milestones) checks[m.id] = pending();

  // ======================================================== E · Elm St Fourplex (open for funding)
  const elm: Project = {
    id: "elm-st",
    name: "Elm St Fourplex",
    type: "residential_new",
    builderId: HVB.id,
    siteAddress: "61 Elm St, Kingston, NY 12401",
    siteGeo: { lat: 41.9271, lng: -74.0142, radiusM: 70 },
    description: "Four 2BR units over a shared slab, walking distance to Uptown Kingston. Permit approved Oct 2026.",
    terms: { principal: "96000.00", interestRateBps: 1075, termDays: 365, paymentIntervalDays: 30, fundingDeadline: iso("2026-11-07T16:00:00Z") },
    status: "funding",
    sov: [
      sov("03-300", "Foundation", "32000.00", "Concrete", [{ kind: "photo", description: "Poured foundation", minCount: 3 }], ["foundation walls"]),
      sov("06-100", "Framing", "32000.00", "Carpentry", [{ kind: "photo", description: "Framing complete", minCount: 3 }], ["wall framing"]),
      sov("07-310", "Roof & dry-in", "32000.00", "Roofing", [{ kind: "photo", description: "Roof + windows", minCount: 3 }], ["roof covering"]),
    ],
    milestones: [
      ms("elm-st", 0, "Foundation", "32000.00", ["03-300"], "pending"),
      ms("elm-st", 1, "Framing", "32000.00", ["06-100"], "pending"),
      ms("elm-st", 2, "Roof & dry-in", "32000.00", ["07-310"], "pending"),
    ],
    chain: chainIds("elm-st"),
  };
  onboarding(elm, HVB, iso("2026-10-20T14:00:00Z"), false);
  openFunding(elm, iso("2026-10-21T15:00:00Z"), "9600.00");
  deposit(elm.id, NORTHBRIDGE, "30000.00", iso("2026-10-22T14:00:00Z"));
  deposit(elm.id, AVA, "8500.00", iso("2026-10-23T20:15:00Z"));
  for (const m of elm.milestones) checks[m.id] = pending();

  // ======================================================== snapshots, verifications, assignments
  const vault = (v: VaultSnapshot) => v;
  const vaults: Record<string, VaultSnapshot> = {
    [maple.id]: vault({ assetsTotal: "120000.00", assetsAvailable: "0.00", sharesOutstanding: "120000.000000", sharePrice: "1.000000", subscriptionDate: maple.terms.fundingDeadline, redemptionDate: iso("2027-11-30T00:00:00Z"), phase: "investment" }),
    [birch.id]: vault({ assetsTotal: "60000.00", assetsAvailable: "0.00", sharesOutstanding: "60000.000000", sharePrice: "1.000000", subscriptionDate: birch.terms.fundingDeadline, redemptionDate: iso("2027-07-31T00:00:00Z"), phase: "investment" }),
    [oak.id]: vault({ assetsTotal: "96480.00", assetsAvailable: "96480.00", sharesOutstanding: "90000.000000", sharePrice: "1.072000", subscriptionDate: oak.terms.fundingDeadline, redemptionDate: iso("2026-10-15T00:00:00Z"), phase: "redemption" }),
    [elm.id]: vault({ assetsTotal: "38500.00", assetsAvailable: "38500.00", sharesOutstanding: "38500.000000", sharePrice: "1.000000", subscriptionDate: elm.terms.fundingDeadline, redemptionDate: iso("2028-01-31T00:00:00Z"), phase: "subscription" }),
  };
  const loans: Record<string, LoanSnapshot> = {
    [maple.id]: { principalOutstanding: "120000.00", totalValueOutstanding: "132600.00", periodicPayment: "11050.00", paymentRemaining: 12, nextPaymentDueDate: iso("2026-11-20T00:00:00Z") },
    [birch.id]: { principalOutstanding: "60000.00", totalValueOutstanding: "65550.00", periodicPayment: "16387.50", paymentRemaining: 4, nextPaymentDueDate: iso("2026-10-30T00:00:00Z") },
    [oak.id]: { principalOutstanding: "0.00", totalValueOutstanding: "0.00", periodicPayment: "0.00", paymentRemaining: 0, nextPaymentDueDate: iso("2026-10-06T00:00:00Z") },
  };
  const verifications: Record<string, ProjectVerification> = {
    [maple.id]: verification("low", iso("2026-10-17T14:15:00Z"), {
      licence: "NY HIC licence 2017-04418 active through Mar 2028 (MOCK registry)",
      insurance: "GL-7731902, $2M aggregate, in force to Jun 2027 (MOCK registry)",
      entity: "Hudson Valley Builders LLC matches the NY DOS filing and the payout account (MOCK registry)",
      sov: "6 SoV lines sum to 120,000 RLUSD = principal",
      ranges: "All 6 lines inside Hudson Valley cost ranges; framing at the 58th percentile (MOCK cost table)",
      permit: "Building permit BP-2026-0912 and stamped plans on file",
      site: "418 Maple St geocodes inside parcel 56.26-3-14",
      record: "23 completed projects (MOCK registry); first Drawproof project",
      load: "1 open project vs. stated capacity of 4",
    }),
    [birch.id]: verification("medium", iso("2026-07-10T14:15:00Z"), {
      licence: "NY HIC licence 2019-07731 active (MOCK registry)",
      insurance: "GL-6120088, $1M aggregate, in force (MOCK registry)",
      entity: "Catskill Homes Inc. matches the NY DOS filing (MOCK registry)",
      sov: "3 SoV lines sum to 60,000 RLUSD = principal",
      ranges: "All lines inside Hudson Valley renovation ranges (MOCK cost table)",
      permit: "Alteration permit AP-2026-0331 on file",
      site: "27 Birch Rd geocodes inside the parcel",
      record: "9 completed projects (MOCK registry)",
      load: "2 open projects vs. stated capacity of 3",
    }),
    [oak.id]: verification("low", iso("2026-02-02T14:15:00Z"), {
      licence: "NY GC licence 2014-11902 active (MOCK registry)",
      insurance: "GL-5530417, $5M aggregate, in force (MOCK registry)",
      entity: "Ridgeline Commercial LLC matches the NY DOS filing (MOCK registry)",
      sov: "3 SoV lines sum to 90,000 RLUSD = principal",
      ranges: "All lines inside Beacon cost ranges (MOCK cost table)",
      permit: "Building permit B-2026-0044 on file",
      site: "112 Oak Ave geocodes inside the parcel",
      record: "11 completed projects (MOCK registry)",
      load: "1 open project vs. stated capacity of 5",
    }),
    [elm.id]: verification("low", iso("2026-10-20T14:15:00Z"), {
      licence: "NY HIC licence 2017-04418 active through Mar 2028 (MOCK registry)",
      insurance: "GL-7731902, $2M aggregate, in force to Jun 2027 (MOCK registry)",
      entity: "Hudson Valley Builders LLC matches the NY DOS filing (MOCK registry)",
      sov: "3 SoV lines sum to 96,000 RLUSD = principal",
      ranges: "All lines inside Hudson Valley cost ranges (MOCK cost table)",
      permit: "Building permit BP-2026-1004 on file",
      site: "61 Elm St geocodes inside the parcel",
      record: "23 completed projects; Maple St in progress, 0 failed milestones",
      load: "2 open projects vs. stated capacity of 4",
    }),
  };
  const assign = (insp: Inspector, score: number, reasons: string[], others: [Inspector, number][]): InspectorAssignment => ({
    inspectors: [insp.address],
    scores: Object.fromEntries([[insp.address, score], ...others.map(([i, s]) => [i.address, s])]),
    reasons,
  });
  const assignments: Record<string, InspectorAssignment> = {
    [maple.id]: assign(DANA, 0.92, ["12 km from site", "Trades match: concrete, carpentry", "2 open audits", "Audits agreed with the suite 96% of the time"], [[MARCUS, 0.81], [PRIYA, 0.44]]),
    [birch.id]: assign(MARCUS, 0.88, ["9 km from site", "Trades match: carpentry", "1 open audit"], [[DANA, 0.79], [PRIYA, 0.52]]),
    [oak.id]: assign(MARCUS, 0.9, ["31 km from site", "Trades match: carpentry, roofing", "0 open audits"], [[DANA, 0.74], [PRIYA, 0.61]]),
    [elm.id]: assign(DANA, 0.9, ["2 km from site", "Trades match: concrete, carpentry"], [[MARCUS, 0.83], [PRIYA, 0.41]]),
  };

  const projects = [maple, elm, cedar, birch, oak];
  const spvs: Party[] = projects.filter((p) => p.chain.spv).map((p) => ({ address: p.chain.spv!, name: `${p.name} project account`, role: "spv", detail: "3-of-4 multisig · master key disabled" }));
  const builders = [HVB, RIDGELINE, CATSKILL, KINGSTON];
  const inspectors = [DANA, MARCUS, PRIYA];
  const parties: Party[] = [
    PLATFORM,
    RELEASE_SERVICE,
    AI_AGENT,
    TRUSTEE,
    ...INVESTORS,
    ...builders.map((b): Party => ({ address: b.address, name: b.name, role: "builder", detail: `Lic. ${b.licenseNumber}` })),
    ...inspectors.map((i): Party => ({ address: i.address, name: i.name, role: "inspector", detail: `${i.licenseNumber} · ${i.firm}` })),
    ...spvs,
  ];

  events.sort((a, b) => a.at.localeCompare(b.at));

  const db: MockDb = {
    parties,
    builders,
    inspectors,
    projects,
    investments,
    holdings,
    events,
    verifications,
    assignments,
    evidence,
    audits,
    attestations,
    checks,
    vaults,
    loans,
    resubmitted: {},
    balances: {
      [HVB.address]: "4120.00",
      [CATSKILL.address]: "26310.00",
      [RIDGELINE.address]: "1880.00",
      [KINGSTON.address]: "2500.00",
      [maple.chain.spv!]: "0.00",
      [birch.chain.spv!]: "0.00",
      [oak.chain.spv!]: "0.00",
      [elm.chain.spv!]: "0.00",
    },
    seq: 0,
  };

  const script: MockScript = {
    verdicts: demoVerdicts(maple, evidence),
    missingAudit: (p, m, at) =>
      suiteResult(m, p, "fail", 0.99, "1 required check failed: no signed inspector audit.", [
        check("required_evidence_present", "pass", "All required items present"),
        check("gps_within_site", "pass", `Photos within the ${p.siteGeo.radiusM} m site geofence`),
        check("photo_fresh", "pass", "Photos taken after this escrow was created"),
        check("no_duplicate_photo", "pass", "No match against any photo on the platform"),
        check("invoice_matches_budget", "pass", "Invoices within ±10% of the SoV lines"),
        check("inspector_audit_present", "fail", "No signed audit from the assigned inspector for this milestone"),
        check("audit_checklist_complete", "skipped", "No audit to read"),
        check("stage_visually_consistent", "pass", "Photos match the SoV visual criteria"),
        check("audit_matches_evidence", "skipped", "No audit to compare against"),
        check("document_consistency", "pass", "Documents agree on address, dates and parties"),
      ], at),
    genericPass: genericPassFor,
    verifications: {
      [cedar.id]: (at) =>
        verification("medium", at, {
          licence: "NY HIC licence 2021-10254 active through Aug 2027 (MOCK registry)",
          insurance: "GL-8841203, $1M aggregate, in force to Feb 2027 (MOCK registry)",
          entity: "Kingston Craft Homes LLC matches the NY DOS filing and the payout account (MOCK registry)",
          sov: "4 SoV lines sum to 80,000 RLUSD = principal",
          ranges: "All 4 lines inside Hudson Valley cost ranges; framing at the 71st percentile (MOCK cost table)",
          permit: "ADU permit ADU-2026-0117 and stamped plans on file",
          site: "9 Cedar Ln geocodes inside parcel 41.3-2-9",
          record: "4 completed projects (MOCK registry); first Drawproof project",
          load: "1 open project vs. stated capacity of 2",
        }),
    },
    genericVerification: (at) =>
      verification("medium", at, {
        licence: "Licence active (MOCK registry)",
        insurance: "Insurance in force (MOCK registry)",
        entity: "Entity matches the payout account (MOCK registry)",
        sov: "SoV lines sum to the principal",
        ranges: "Line amounts inside regional cost ranges (MOCK cost table)",
        permit: "Permit and plans on file",
        site: "Site address geocodes",
        record: "Track record on file (MOCK registry)",
        load: "Open load within stated capacity",
      }),
    assignments: { [cedar.id]: assign(MARCUS, 0.91, ["14 km from site", "Trades match: carpentry, roofing", "1 open audit", "Robot/sensor auditors would use the same interface"], [[DANA, 0.84], [PRIYA, 0.38]]) },
    genericAssignment: assign(DANA, 0.85, ["Closest verified inspector with matching trades"], [[MARCUS, 0.8], [PRIYA, 0.4]]),
  };

  return { db, script };
}

/** Canned all-green suite for milestones without a dedicated fixture. */
function genericPassFor(p: Project, m: Milestone, at: string): ChecksStatus {
  return suiteResult(m, p, "pass", 0.91, `All ${SUITE.length} required checks passed.`, [
    check("required_evidence_present", "pass", "All required items present"),
    check("gps_within_site", "pass", `Photos within the ${p.siteGeo.radiusM} m site geofence`),
    check("photo_fresh", "pass", "Photos taken after this escrow was created"),
    check("no_duplicate_photo", "pass", "No match against any photo on the platform"),
    check("invoice_matches_budget", "pass", "Invoices within ±10% of the SoV lines"),
    check("inspector_audit_present", "pass", "Signed by the assigned inspector, attested on-chain"),
    check("audit_checklist_complete", "pass", "Every SoV line marked done"),
    check("stage_visually_consistent", "pass", "Photos match the SoV visual criteria"),
    check("audit_matches_evidence", "pass", "Inspector's checklist agrees with the builder's evidence"),
    check("document_consistency", "pass", "Documents agree on address, dates and parties"),
  ], at);
}
