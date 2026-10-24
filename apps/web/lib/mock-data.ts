// In-memory mock backend. Server-only (uses node:crypto). Mirrors what @xrlp/core will provide:
// read models (getMarketplace, getProjectDetail, ...) + actions (invest, submitEvidence, ...).
// State lives on globalThis so route handlers and server components share it and it survives HMR.
import { createHash } from "node:crypto";
import {
  MILESTONE_TEMPLATES,
  TWO_INSPECTOR_THRESHOLD,
  explorerTxUrl,
  type Attestation,
  type Builder,
  type ChainEvent,
  type CheckResult,
  type Evidence,
  type Investment,
  type Milestone,
  type Project,
  type Verdict,
} from "@xrlp/shared";
import { evidenceArtUri } from "./evidence-art";
import type {
  AttestInput,
  AttestResult,
  BuilderDashboard,
  BuilderProjectView,
  DemoAction,
  DemoResult,
  DemoState,
  DemoStep,
  EvidenceUpload,
  FundsBreakdown,
  InspectionTask,
  InspectorQueue,
  InvestInput,
  InvestResult,
  InvestorPortfolio,
  InvestorPosition,
  MarketplaceView,
  MilestoneRef,
  MilestoneView,
  Party,
  ProjectDetail,
  ProjectSummary,
  Quorum,
  SignerSlot,
  SubmitEvidenceInput,
  VaultState,
} from "./types";
import { fromCents, toCents } from "./utils";

// ---------------------------------------------------------------- ids

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const sha = (s: string) => createHash("sha256").update(s).digest();
const hex64 = (seed: string) => sha(seed).toString("hex").toUpperCase();
function address(seed: string): string {
  const bytes = [...sha(`addr:${seed}`), ...sha(`addr2:${seed}`)];
  return "r" + bytes.slice(0, 33).map((b) => B58[b % 58]).join("");
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- parties

export const DEMO_PROJECT_ID = "maple-st-duplex";

const PLATFORM: Party = { address: address("platform"), name: "Keystone Platform", role: "platform", detail: "Vault & loan broker owner" };
const AI_AGENT: Party = { address: address("ai-agent"), name: "AI Verifier", role: "ai_agent", detail: "Evidence consistency agent" };
const INSPECTORS: Party[] = [
  { address: address("inspector-dana"), name: "Dana Okafor, PE", role: "inspector", detail: "NY lic. PE-089412 · Catskill Inspection Group" },
  { address: address("inspector-marcus"), name: "Marcus Lindqvist", role: "inspector", detail: "ICC cert. 5381207 · Hudson Code Services" },
];
const INVESTORS: Party[] = [
  { address: address("investor-ava"), name: "Ava Chen", role: "investor", detail: "Accredited · KYC verified" },
  { address: address("investor-northbridge"), name: "Northbridge Family Office", role: "investor", detail: "Institutional · KYC verified" },
  { address: address("investor-marco"), name: "Marco Ruiz", role: "investor", detail: "Accredited · KYC verified" },
];
const [DANA, MARCUS] = INSPECTORS as [Party, Party];
const [AVA, NORTHBRIDGE, MARCO] = INVESTORS as [Party, Party, Party];

/** Planned demo deposits for Maple St (step 4 of the demo script). */
const MAPLE_PLAN: { investor: Party; amount: string }[] = [
  { investor: AVA, amount: "45000.00" },
  { investor: NORTHBRIDGE, amount: "50000.00" },
  { investor: MARCO, amount: "25000.00" },
];

/** Known photo fingerprints from other projects — feeds the duplicate-photo check. */
const PHOTO_INDEX: Record<string, string> = {
  "phash:oak-ave-framing-0412": "Oak Ave Townhouse (Hudson Valley Builders), framing stage, Mar 2025",
};

// ---------------------------------------------------------------- state

interface ProjectLedger {
  totalShares: number; // 6dp precision kept as float — shares are not money
  interestPaidCents: number;
  principalRepaidCents: number;
  refundedCents: number;
  holdings: Record<string, number>; // investor address → shares
  releaseKeyHolder: Record<string, string>; // milestoneId → inspector address
}

interface MockState {
  builders: Builder[];
  projects: Project[];
  investments: Investment[];
  events: ChainEvent[];
  evidence: Record<string, Evidence[]>;
  verdicts: Record<string, Verdict>;
  attestations: Attestation[];
  ledgers: Record<string, ProjectLedger>;
  seq: number;
}

const g = globalThis as unknown as { __xrlpMock?: MockState };
function db(): MockState {
  g.__xrlpMock ??= seed();
  return g.__xrlpMock;
}

function nextHash(s: MockState, label: string) {
  s.seq += 1;
  return hex64(`live:${label}:${s.seq}:${Date.now()}`);
}

function pushEvent(s: MockState, e: Omit<ChainEvent, "explorerUrl" | "txHash"> & { txHash?: string }): ChainEvent {
  const txHash = e.txHash ?? nextHash(s, e.kind);
  const ev: ChainEvent = { ...e, txHash, explorerUrl: explorerTxUrl(txHash) };
  s.events.push(ev);
  return ev;
}

const iso = (d: string) => new Date(d).toISOString();
const addDays = (isoStr: string, days: number) => new Date(new Date(isoStr).getTime() + days * 86_400_000).toISOString();

// ---------------------------------------------------------------- seed

function makeMilestones(projectId: string, type: Project["type"], principal: string): Milestone[] {
  const total = toCents(principal);
  const templates = MILESTONE_TEMPLATES[type];
  let allocated = 0;
  return templates.map((t, i) => {
    const cents = i === templates.length - 1 ? total - allocated : Math.round((total * t.defaultShare) / 100) * 100;
    allocated += cents;
    return {
      id: `${projectId}:${t.key}`,
      index: i,
      templateKey: t.key,
      title: t.title,
      amount: fromCents(cents),
      requiredInspectors: cents / 100 >= TWO_INSPECTOR_THRESHOLD ? 2 : 1,
      status: "pending",
    };
  });
}

/** Evidence fixtures for a milestone. `fraud` reuses a photo from another job site. */
function fixtureEvidence(project: Project, m: Milestone, at: string, opts: { fraud?: boolean; seed: string; escrowOpenedAt?: string }): Evidence[] {
  const template = MILESTONE_TEMPLATES[project.type].find((t) => t.key === m.templateKey);
  if (!template) return [];
  const out: Evidence[] = [];
  const atMs = new Date(at).getTime();
  // Genuine photos are taken shortly before upload, but never before the escrow opened.
  const escrowMs = opts.escrowOpenedAt ? new Date(opts.escrowOpenedAt).getTime() : 0;
  const takenAt = (i: number) => new Date(Math.max(escrowMs + 1000 * (i + 1), atMs - (6 - i) * 47 * 60_000)).toISOString();
  const geoJitter = [0.00008, -0.00011, 0.00005, 0.00013, -0.00006, 0.0001];
  for (const req of template.requiredEvidence) {
    for (let i = 0; i < req.minCount; i++) {
      const id = `${m.id}:${opts.seed}:${req.kind}-${i + 1}`;
      const isFraudPhoto = !!opts.fraud && req.kind === "photo" && i === 1;
      if (req.kind === "photo") {
        const fname = isFraudPhoto ? "IMG_0412.jpg" : `IMG_${2040 + i * 3 + m.index * 17}.jpg`;
        out.push({
          id,
          kind: "photo",
          filename: fname,
          mimeType: "image/jpeg",
          uri: isFraudPhoto ? evidenceArtUri("framing", 4) : evidenceArtUri(m.templateKey, i + 1),
          sha256: hex64(`file:${id}`).toLowerCase(),
          meta: isFraudPhoto
            ? { takenAt: iso("2025-03-14T15:22:00Z"), perceptualHash: "phash:oak-ave-framing-0412" }
            : {
                takenAt: takenAt(i),
                gps: { lat: project.siteGeo.lat + (geoJitter[i] ?? 0), lng: project.siteGeo.lng + (geoJitter[i + 1] ?? 0) },
                perceptualHash: `phash:${id}`,
              },
          uploadedAt: at,
        });
      } else if (req.kind === "invoice") {
        out.push({
          id,
          kind: "invoice",
          filename: `${m.templateKey}-invoice-${4410 + m.index}.pdf`,
          mimeType: "application/pdf",
          uri: evidenceArtUri("invoice", 1),
          sha256: hex64(`file:${id}`).toLowerCase(),
          meta: { invoiceTotal: fromCents(Math.round(toCents(m.amount) * 0.947)) },
          uploadedAt: at,
        });
      } else {
        out.push({
          id,
          kind: req.kind,
          filename: `${m.templateKey}-${req.kind === "document" ? "signoff" : "report"}.pdf`,
          mimeType: "application/pdf",
          uri: evidenceArtUri("document", 1),
          sha256: hex64(`file:${id}`).toLowerCase(),
          meta: {},
          uploadedAt: at,
        });
      }
    }
  }
  return out;
}

function seed(): MockState {
  const s: MockState = { builders: [], projects: [], investments: [], events: [], evidence: {}, verdicts: {}, attestations: [], ledgers: {}, seq: 0 };

  const hvb: Builder = {
    id: "hudson-valley-builders",
    name: "Hudson Valley Builders",
    address: address("builder-hvb"),
    licenseNumber: "NY-HIC-2017-04418",
    insurancePolicy: "GL-7731902 · $2M aggregate",
    completedProjects: 23,
    riskTier: "low",
    verified: true,
    credentialTx: hex64("seed:cred:hvb"),
  };
  const ridgeline: Builder = {
    id: "ridgeline-commercial",
    name: "Ridgeline Commercial",
    address: address("builder-ridgeline"),
    licenseNumber: "NY-GC-2014-11902",
    insurancePolicy: "GL-5530417 · $5M aggregate",
    completedProjects: 11,
    riskTier: "medium",
    verified: true,
    credentialTx: hex64("seed:cred:ridgeline"),
  };
  s.builders.push(hvb, ridgeline);

  const mkProject = (p: Omit<Project, "milestones" | "chain" | "status"> & { status?: Project["status"] }): Project => {
    const project: Project = {
      ...p,
      status: p.status ?? "funding",
      milestones: makeMilestones(p.id, p.type, p.terms.principal),
      chain: {
        spv: address(`spv:${p.id}`),
        vaultId: hex64(`vault:${p.id}`),
        loanBrokerId: hex64(`broker:${p.id}`),
        shareMptIssuanceId: hex64(`mpt:${p.id}`).slice(0, 48),
      },
    };
    s.projects.push(project);
    s.ledgers[project.id] = { totalShares: 0, interestPaidCents: 0, principalRepaidCents: 0, refundedCents: 0, holdings: {}, releaseKeyHolder: {} };
    project.milestones.forEach((m, i) => {
      s.ledgers[project.id]!.releaseKeyHolder[m.id] = (i % 2 === 0 ? DANA : MARCUS).address;
    });
    return project;
  };

  const setupEvents = (p: Project, builder: Builder, at: string) => {
    pushEvent(s, { projectId: p.id, kind: "credential_issued", actor: PLATFORM.address, at: addDays(at, -12), txHash: builder.credentialTx });
    pushEvent(s, { projectId: p.id, kind: "vault_created", actor: PLATFORM.address, at, txHash: hex64(`seed:vault:${p.id}`) });
    pushEvent(s, { projectId: p.id, kind: "loan_broker_created", actor: PLATFORM.address, at: addDays(at, 0.01), txHash: hex64(`seed:broker:${p.id}`) });
  };

  const deposit = (p: Project, investor: Party, amount: string, at: string) => {
    const tx = hex64(`seed:deposit:${p.id}:${investor.address}:${at}`);
    applyDeposit(s, p, investor.address, amount, at, tx);
  };

  // --- Project 1: Maple St Duplex — the live demo project. Starts mid-funding.
  const maple = mkProject({
    id: DEMO_PROJECT_ID,
    name: "Maple St Duplex",
    type: "residential_new",
    builderId: hvb.id,
    siteAddress: "418 Maple St, Kingston, NY 12401",
    siteGeo: { lat: 41.9312, lng: -74.0004, radiusM: 60 },
    description:
      "Ground-up side-by-side duplex, 2 × 3BR/2.5BA (1,450 sq ft each) on a 0.22-acre infill lot. Pre-leased to a local property manager; permits issued Sep 2026.",
    terms: {
      principal: "120000.00",
      interestRateBps: 1050,
      termDays: 365,
      paymentIntervalDays: 30,
      fundingDeadline: iso("2026-11-07T23:59:00Z"),
    },
  });
  setupEvents(maple, hvb, iso("2026-10-20T14:05:00Z"));
  deposit(maple, AVA, "45000.00", iso("2026-10-22T16:41:00Z"));

  // --- Project 2: Rhinebeck Farmhouse Renovation — escrowed; milestone 1 awaiting second inspector.
  const rhine = mkProject({
    id: "rhinebeck-farmhouse",
    name: "Rhinebeck Farmhouse Renovation",
    type: "residential_renovation",
    builderId: hvb.id,
    siteAddress: "77 Mill Rd, Rhinebeck, NY 12572",
    siteGeo: { lat: 41.9268, lng: -73.9124, radiusM: 80 },
    description: "Full gut renovation of an 1890s farmhouse: new MEP, insulation, kitchen and baths. Owner-occupied resale.",
    terms: { principal: "140000.00", interestRateBps: 1125, termDays: 270, paymentIntervalDays: 30, fundingDeadline: iso("2026-09-20T23:59:00Z") },
  });
  setupEvents(rhine, hvb, iso("2026-09-01T15:00:00Z"));
  deposit(rhine, NORTHBRIDGE, "80000.00", iso("2026-09-04T13:12:00Z"));
  deposit(rhine, AVA, "35000.00", iso("2026-09-06T18:30:00Z"));
  deposit(rhine, MARCO, "25000.00", iso("2026-09-09T11:02:00Z"));
  closeLoanInternal(s, rhine, iso("2026-09-15T15:30:00Z"), true);
  {
    const m = rhine.milestones[0]!;
    const at = iso("2026-10-20T19:10:00Z");
    s.evidence[m.id] = fixtureEvidence(rhine, m, at, { seed: "seed" });
    m.status = "evidence_submitted";
    reviewInternal(s, rhine, m, iso("2026-10-20T19:12:00Z"), true);
    attestInternal(s, rhine, m, { signer: DANA.address, decision: "approve", notes: "Rough-in matches plans; panel upgrade to 200A confirmed on site." }, iso("2026-10-22T15:48:00Z"), true);
  }

  // --- Project 3: Beacon Main St Mixed-Use — two milestones released, a repayment made, final milestone needs a human.
  const beacon = mkProject({
    id: "beacon-main-st",
    name: "Beacon Main St Mixed-Use",
    type: "commercial_small",
    builderId: ridgeline.id,
    siteAddress: "502 Main St, Beacon, NY 12508",
    siteGeo: { lat: 41.5048, lng: -73.9696, radiusM: 90 },
    description: "Two-story mixed-use infill: ground-floor retail with two apartments above. Anchor tenant LOI signed.",
    terms: { principal: "240000.00", interestRateBps: 1200, termDays: 365, paymentIntervalDays: 30, fundingDeadline: iso("2026-06-30T23:59:00Z") },
  });
  setupEvents(beacon, ridgeline, iso("2026-06-02T15:00:00Z"));
  deposit(beacon, NORTHBRIDGE, "150000.00", iso("2026-06-05T14:00:00Z"));
  deposit(beacon, MARCO, "50000.00", iso("2026-06-11T10:20:00Z"));
  deposit(beacon, AVA, "40000.00", iso("2026-06-18T21:45:00Z"));
  closeLoanInternal(s, beacon, iso("2026-07-01T15:00:00Z"), true);
  const beaconDates = [
    ["2026-08-03T17:00:00Z", "2026-08-05T14:20:00Z"],
    ["2026-09-25T16:30:00Z", "2026-09-28T13:05:00Z"],
  ] as const;
  beacon.milestones.slice(0, 2).forEach((m, i) => {
    const [subAt, signAt] = beaconDates[i]!;
    s.evidence[m.id] = fixtureEvidence(beacon, m, iso(subAt), { seed: "seed" });
    m.status = "evidence_submitted";
    reviewInternal(s, beacon, m, addDays(iso(subAt), 0.002), true);
    attestInternal(s, beacon, m, { signer: DANA.address, decision: "approve", notes: "Verified on site." }, iso(signAt), true);
    attestInternal(s, beacon, m, { signer: MARCUS.address, decision: "approve", notes: "Concur." }, addDays(iso(signAt), 0.05), true);
  });
  repayInternal(s, beacon, iso("2026-10-01T15:00:00Z"), true);
  {
    const m = beacon.milestones[2]!;
    const at = iso("2026-10-21T20:15:00Z");
    const ev = fixtureEvidence(beacon, m, at, { seed: "seed" });
    const inv = ev.find((e) => e.kind === "invoice");
    if (inv) inv.meta = { invoiceTotal: fromCents(Math.round(toCents(m.amount) * 1.08)) };
    else
      ev.push({
        id: `${m.id}:seed:invoice-x`,
        kind: "invoice",
        filename: "fitout-change-order-17.pdf",
        mimeType: "application/pdf",
        uri: evidenceArtUri("invoice", 1),
        sha256: hex64("file:beacon-co17").toLowerCase(),
        meta: { invoiceTotal: fromCents(Math.round(toCents(m.amount) * 1.08)) },
        uploadedAt: at,
      });
    s.evidence[m.id] = ev;
    m.status = "evidence_submitted";
    reviewInternal(s, beacon, m, addDays(at, 0.002), true);
  }

  s.events.sort((a, b) => a.at.localeCompare(b.at));
  return s;
}

// ---------------------------------------------------------------- internal mutations

function applyDeposit(s: MockState, p: Project, investor: string, amount: string, at: string, txHash?: string) {
  const ledger = s.ledgers[p.id]!;
  const price = sharePriceOf(s, p);
  const shares = toCents(amount) / 100 / price;
  ledger.totalShares += shares;
  ledger.holdings[investor] = (ledger.holdings[investor] ?? 0) + shares;
  const ev = pushEvent(s, { projectId: p.id, kind: "vault_deposit", actor: investor, amount, at, txHash });
  s.investments.push({ projectId: p.id, investor, amount, tx: ev.txHash, at });
  const raised = raisedCents(s, p.id);
  if (raised >= toCents(p.terms.principal) && p.status === "funding") p.status = "funded";
  return { ev, shares, price };
}

function closeLoanInternal(s: MockState, p: Project, at: string, seeded = false) {
  const h = (k: string) => (seeded ? hex64(`seed:${k}:${p.id}`) : undefined);
  p.chain.loanId = hex64(`loan:${p.id}`);
  pushEvent(s, { projectId: p.id, kind: "loan_set", actor: p.chain.spv, amount: p.terms.principal, at, txHash: h("loanset") });
  p.milestones.forEach((m, i) => {
    const createTx = h(`escrow:${m.id}`) ?? nextHash(s, `escrow:${m.id}`);
    m.status = "escrowed";
    m.cancelAfter = addDays(at, 60 * (i + 1));
    m.escrow = {
      owner: p.chain.spv!,
      offerSequence: 1200 + i * 3 + (s.seq % 7),
      condition: `A0258020${hex64(`cond:${m.id}`)}810120`,
      createTx,
    };
    pushEvent(s, { projectId: p.id, milestoneId: m.id, kind: "escrow_created", actor: p.chain.spv, amount: m.amount, at: addDays(at, 0.00002 * (i + 1)), txHash: createTx });
  });
  p.status = "escrowed";
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Deterministic mock of @xrlp/verifier. Same contract (Verdict); swap for the real one via core. */
function mockVerify(s: MockState, p: Project, m: Milestone, at: string): Verdict {
  const evidence = s.evidence[m.id] ?? [];
  const template = MILESTONE_TEMPLATES[p.type].find((t) => t.key === m.templateKey);
  const builder = s.builders.find((b) => b.id === p.builderId)!;
  const checks: CheckResult[] = [];
  const photos = evidence.filter((e) => e.kind === "photo");
  const escrowOpened = s.events.find((e) => e.kind === "escrow_created" && e.milestoneId === m.id)?.at;

  // 1. required evidence
  const missing = (template?.requiredEvidence ?? [])
    .map((r) => ({ r, have: evidence.filter((e) => e.kind === r.kind).length }))
    .filter((x) => x.have < x.r.minCount);
  checks.push({
    check: "required_evidence_present",
    result: missing.length ? "fail" : "pass",
    reason: missing.length
      ? `Missing ${missing.map((x) => `${x.r.minCount - x.have} ${x.r.kind}${x.r.minCount - x.have > 1 ? "s" : ""}`).join(", ")} required by the ${template?.title} template`
      : `All ${template?.requiredEvidence.length ?? 0} required evidence items present (${evidence.length} files)`,
    evidenceIds: [],
  });

  // 2. GPS
  const withGps = photos.filter((e) => e.meta.gps);
  const far = withGps.map((e) => ({ e, d: haversineM(e.meta.gps!, p.siteGeo) })).filter((x) => x.d > p.siteGeo.radiusM);
  const noGps = photos.filter((e) => !e.meta.gps);
  if (far.length) {
    checks.push({ check: "gps_within_site", result: "fail", reason: `${far[0]!.e.filename} taken ${(far[0]!.d / 1000).toFixed(1)} km from site`, evidenceIds: far.map((x) => x.e.id) });
  } else if (withGps.length) {
    const maxD = Math.max(...withGps.map((e) => haversineM(e.meta.gps!, p.siteGeo)));
    checks.push({
      check: "gps_within_site",
      result: noGps.length ? "warn" : "pass",
      reason: noGps.length
        ? `${noGps.map((e) => e.filename).join(", ")} has no GPS metadata (stripped EXIF)`
        : `Photo GPS within ${Math.max(1, Math.round(maxD))} m of site (geofence ${p.siteGeo.radiusM} m)`,
      evidenceIds: noGps.map((e) => e.id),
    });
  } else if (photos.length) {
    checks.push({ check: "gps_within_site", result: "warn", reason: "No GPS metadata on any photo — inspector must confirm location", evidenceIds: [] });
  }

  // 3. freshness
  const stale = photos.filter((e) => e.meta.takenAt && escrowOpened && e.meta.takenAt < escrowOpened);
  if (stale.length) {
    const d = new Date(stale[0]!.meta.takenAt!).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    checks.push({ check: "photo_fresh", result: "fail", reason: `${stale[0]!.filename} EXIF date ${d} predates this escrow`, evidenceIds: stale.map((e) => e.id) });
  } else if (photos.some((e) => e.meta.takenAt)) {
    checks.push({ check: "photo_fresh", result: "pass", reason: "All photo timestamps fall after the escrow opened", evidenceIds: [] });
  }

  // 4. duplicates
  const dupes = photos.filter((e) => e.meta.perceptualHash && PHOTO_INDEX[e.meta.perceptualHash]);
  checks.push(
    dupes.length
      ? { check: "no_duplicate_photo", result: "fail", reason: `${dupes[0]!.filename} is a duplicate of a photo from ${PHOTO_INDEX[dupes[0]!.meta.perceptualHash!]}`, evidenceIds: dupes.map((e) => e.id) }
      : { check: "no_duplicate_photo", result: "pass", reason: "No matches across 1,284 indexed photos from all projects", evidenceIds: [] },
  );

  // 5. invoice vs budget
  const invoices = evidence.filter((e) => e.kind === "invoice");
  if (invoices.length) {
    const total = invoices.reduce((acc, e) => acc + toCents(e.meta.invoiceTotal), 0);
    const ratio = total / toCents(m.amount);
    const fmt = (c: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(c / 100);
    if (!total) checks.push({ check: "invoice_matches_budget", result: "warn", reason: "Invoice totals could not be extracted", evidenceIds: invoices.map((e) => e.id) });
    else
      checks.push({
        check: "invoice_matches_budget",
        result: ratio > 1.05 ? "warn" : ratio < 0.5 ? "warn" : "pass",
        reason:
          ratio > 1.05
            ? `Invoices total ${fmt(total)} RLUSD — ${Math.round((ratio - 1) * 100)}% over the ${fmt(toCents(m.amount))} budget line`
            : `Invoices total ${fmt(total)} RLUSD vs ${fmt(toCents(m.amount))} budget line (${Math.round(ratio * 100)}%)`,
        evidenceIds: invoices.map((e) => e.id),
      });
  }

  // 6. visual stage
  if (photos.length && template) {
    checks.push({
      check: "stage_visually_consistent",
      result: "pass",
      reason: `Photos consistent with ${template.title.toLowerCase()}: ${template.visualCriteria.slice(0, 2).join("; ")}`,
      evidenceIds: photos.map((e) => e.id),
    });
  }

  const fails = checks.filter((c) => c.result === "fail");
  const warns = checks.filter((c) => c.result === "warn");
  const decision: Verdict["decision"] = fails.length ? "fail" : warns.length ? "needs_human" : "pass";
  const summary =
    decision === "pass"
      ? `Evidence is consistent with ${template?.title ?? "this milestone"}: location, timing, documents and budget all check out.`
      : decision === "fail"
        ? `Evidence rejected: ${fails.map((c) => c.reason.charAt(0).toLowerCase() + c.reason.slice(1)).join("; ")}.`
        : `Mostly consistent, but ${warns.length} item${warns.length > 1 ? "s need" : " needs"} a human look: ${warns[0]!.reason.toLowerCase()}.`;

  return {
    milestoneId: m.id,
    decision,
    confidence: decision === "pass" ? 0.94 : decision === "fail" ? 0.97 : 0.72,
    summary,
    checks,
    policy: { projectType: p.type, riskTier: builder.riskTier, requiredInspectors: m.requiredInspectors },
    model: "mock",
    createdAt: at,
  };
}

function addAttestation(s: MockState, p: Project, m: Milestone, a: Omit<Attestation, "txHash" | "milestoneId">, seeded: boolean): Attestation {
  const txHash = seeded ? hex64(`seed:attest:${m.id}:${a.signer}:${a.at}`) : undefined;
  const ev = pushEvent(s, { projectId: p.id, milestoneId: m.id, kind: "approval_attested", actor: a.signer, at: a.at, txHash });
  const att: Attestation = { ...a, milestoneId: m.id, txHash: ev.txHash };
  s.attestations = s.attestations.filter((x) => !(x.milestoneId === m.id && x.signer === a.signer));
  s.attestations.push(att);
  return att;
}

function reviewInternal(s: MockState, p: Project, m: Milestone, at: string, seeded = false): Verdict {
  const verdict = mockVerify(s, p, m, at);
  s.verdicts[m.id] = verdict;
  if (verdict.decision === "fail") {
    m.status = "rejected";
    addAttestation(s, p, m, { role: "ai_agent", signer: AI_AGENT.address, decision: "reject", notes: verdict.summary, at }, seeded);
    return verdict;
  }
  m.status = "ai_reviewed";
  if (verdict.decision === "pass") {
    addAttestation(s, p, m, { role: "ai_agent", signer: AI_AGENT.address, decision: "approve", notes: verdict.summary, at }, seeded);
  }
  // Platform co-signs that the milestone matches the locked terms. Weight 1 — can never release alone.
  addAttestation(s, p, m, { role: "platform", signer: PLATFORM.address, decision: "approve", notes: "Milestone, amount and evidence set match locked terms.", at: addDays(at, 0.0003) }, seeded);
  return verdict;
}

function quorumOf(s: MockState, m: Milestone): Quorum {
  const atts = s.attestations.filter((a) => a.milestoneId === m.id);
  const slot = (party: Party, role: SignerSlot["role"], weight: number, mandatory: boolean): SignerSlot => ({
    role,
    address: party.address,
    name: party.name,
    weight,
    mandatory,
    attestation: atts.find((a) => a.signer === party.address) ?? null,
  });
  const signers = [slot(DANA, "inspector", 2, true), slot(MARCUS, "inspector", 2, true), slot(AI_AGENT, "ai_agent", 1, false), slot(PLATFORM, "platform", 1, false)];
  const approvals = signers.filter((x) => x.attestation?.decision === "approve");
  const collected = approvals.reduce((acc, x) => acc + x.weight, 0);
  const inspectorsSigned = approvals.filter((x) => x.role === "inspector").length;
  const anyReject = signers.some((x) => x.attestation?.decision === "reject" && x.role === "inspector");
  return {
    required: 3,
    collected,
    inspectorsRequired: m.requiredInspectors,
    inspectorsSigned,
    met: !anyReject && collected >= 3 && inspectorsSigned >= m.requiredInspectors,
    signers,
  };
}

function releaseInternal(s: MockState, p: Project, m: Milestone, at: string, seeded = false): ChainEvent {
  const builder = s.builders.find((b) => b.id === p.builderId)!;
  const txHash = seeded ? hex64(`seed:finish:${m.id}`) : undefined;
  const ev = pushEvent(s, { projectId: p.id, milestoneId: m.id, kind: "escrow_finished", actor: builder.address, amount: m.amount, at, txHash });
  m.status = "released";
  if (m.escrow) m.escrow.finishTx = ev.txHash;
  settleProjectStatus(p);
  return ev;
}

function attestInternal(
  s: MockState,
  p: Project,
  m: Milestone,
  input: { signer: string; decision: "approve" | "reject"; notes: string },
  at: string,
  seeded = false,
): AttestResult {
  const inspector = INSPECTORS.find((i) => i.address === input.signer);
  if (!inspector) throw new ApiError("Signer is not an inspector on this project", 403);
  if (!["ai_reviewed", "inspected"].includes(m.status)) throw new ApiError(`Milestone is ${m.status}; nothing to inspect`, 409);
  const attestation = addAttestation(s, p, m, { role: "inspector", signer: inspector.address, decision: input.decision, notes: input.notes, at }, seeded);
  if (input.decision === "reject") {
    m.status = "rejected";
    return { attestation, release: null };
  }
  m.status = "inspected";
  const q = quorumOf(s, m);
  // The key holder's signature reveals the escrow fulfillment; once quorum is met the escrow finishes.
  const keyHolderSigned = q.signers.some((x) => x.address === s.ledgers[p.id]!.releaseKeyHolder[m.id] && x.attestation?.decision === "approve");
  const release = q.met && keyHolderSigned ? releaseInternal(s, p, m, addDays(at, 0.00005), seeded) : null;
  return { attestation, release };
}

function repayInternal(s: MockState, p: Project, at: string, seeded = false): ChainEvent {
  const ledger = s.ledgers[p.id]!;
  const principal = toCents(p.terms.principal);
  const outstanding = principal - ledger.principalRepaidCents - ledger.refundedCents;
  if (outstanding <= 0) throw new ApiError("Loan is fully repaid", 409);
  const periods = Math.max(1, Math.round(p.terms.termDays / p.terms.paymentIntervalDays));
  const principalPart = Math.min(outstanding, Math.round(principal / periods));
  const interest = Math.round((outstanding * p.terms.interestRateBps * p.terms.paymentIntervalDays) / (10_000 * 365));
  ledger.principalRepaidCents += principalPart;
  ledger.interestPaidCents += interest;
  const txHash = seeded ? hex64(`seed:pay:${p.id}:${at}`) : undefined;
  const ev = pushEvent(s, { projectId: p.id, kind: "loan_payment", actor: p.chain.spv, amount: fromCents(principalPart + interest), at, txHash });
  if (p.status === "escrowed") p.status = "repaying";
  if (outstanding - principalPart <= 0) p.status = "completed";
  return ev;
}

function settleProjectStatus(p: Project) {
  const open = p.milestones.some((m) => !["released", "refunded"].includes(m.status));
  if (!open && p.status === "escrowed") p.status = "repaying";
}

// ---------------------------------------------------------------- derived values

function raisedCents(s: MockState, projectId: string) {
  return s.investments.filter((i) => i.projectId === projectId).reduce((acc, i) => acc + toCents(i.amount), 0);
}

function sharePriceOf(s: MockState, p: Project) {
  const l = s.ledgers[p.id]!;
  if (l.totalShares <= 0) return 1;
  return (raisedCents(s, p.id) + l.interestPaidCents) / 100 / l.totalShares;
}

function fundsOf(s: MockState, p: Project): FundsBreakdown {
  const l = s.ledgers[p.id]!;
  const raised = raisedCents(s, p.id);
  const closed = !!p.chain.loanId;
  const sum = (statuses: Milestone["status"][]) => p.milestones.filter((m) => statuses.includes(m.status)).reduce((a, m) => a + toCents(m.amount), 0);
  return {
    target: p.terms.principal,
    raised: fromCents(raised),
    awaitingClose: fromCents(closed ? 0 : raised),
    escrowed: fromCents(closed ? sum(["escrowed", "evidence_submitted", "ai_reviewed", "inspected", "rejected", "expired"]) : 0),
    released: fromCents(sum(["released"])),
    repaid: fromCents(l.principalRepaidCents),
    refunded: fromCents(l.refundedCents),
    interestPaid: fromCents(l.interestPaidCents),
  };
}

function vaultOf(s: MockState, p: Project): VaultState {
  const l = s.ledgers[p.id]!;
  const price = sharePriceOf(s, p);
  return {
    sharePrice: price.toFixed(6),
    totalShares: l.totalShares.toFixed(6),
    totalAssets: fromCents(raisedCents(s, p.id) + l.interestPaidCents),
  };
}

function summaryOf(s: MockState, p: Project): ProjectSummary {
  const builder = s.builders.find((b) => b.id === p.builderId)!;
  const raised = raisedCents(s, p.id);
  const target = toCents(p.terms.principal);
  return {
    project: p,
    builder,
    funding: {
      raised: fromCents(raised),
      target: p.terms.principal,
      pct: target ? Math.min(100, (raised / target) * 100) : 0,
      investorCount: new Set(s.investments.filter((i) => i.projectId === p.id).map((i) => i.investor)).size,
      deadline: p.terms.fundingDeadline,
    },
    funds: fundsOf(s, p),
    currentMilestone: p.milestones.find((m) => !["released", "refunded"].includes(m.status)) ?? null,
    milestonesReleased: p.milestones.filter((m) => m.status === "released").length,
  };
}

function directoryOf(s: MockState): Record<string, Party> {
  const dir: Record<string, Party> = {};
  for (const party of [PLATFORM, AI_AGENT, ...INSPECTORS, ...INVESTORS]) dir[party.address] = party;
  for (const b of s.builders) dir[b.address] = { address: b.address, name: b.name, role: "builder", detail: `Lic. ${b.licenseNumber}` };
  for (const p of s.projects) if (p.chain.spv) dir[p.chain.spv] = { address: p.chain.spv, name: `${p.name} SPV`, role: "spv", detail: "Project account · master key disabled" };
  return dir;
}

function milestoneViewOf(s: MockState, p: Project, m: Milestone): MilestoneView {
  const quorum = quorumOf(s, m);
  const keyHolder = s.ledgers[p.id]!.releaseKeyHolder[m.id];
  return {
    milestone: m,
    template: MILESTONE_TEMPLATES[p.type].find((t) => t.key === m.templateKey) ?? null,
    evidence: s.evidence[m.id] ?? [],
    verdict: s.verdicts[m.id] ?? null,
    attestations: s.attestations.filter((a) => a.milestoneId === m.id),
    quorum,
    releaseKeyHolder: INSPECTORS.find((i) => i.address === keyHolder) ?? null,
    canRelease: quorum.met && ["ai_reviewed", "inspected"].includes(m.status),
  };
}

function findProject(s: MockState, id: string) {
  const p = s.projects.find((x) => x.id === id);
  if (!p) throw new ApiError(`Unknown project ${id}`, 404);
  return p;
}

function findMilestone(s: MockState, ref: MilestoneRef) {
  const p = findProject(s, ref.projectId);
  const m = p.milestones.find((x) => x.id === ref.milestoneId);
  if (!m) throw new ApiError(`Unknown milestone ${ref.milestoneId}`, 404);
  return { p, m };
}

const now = () => new Date().toISOString();

// ================================================================ public read models

export function listParties() {
  const s = db();
  return {
    investors: INVESTORS,
    inspectors: INSPECTORS,
    builders: s.builders.map((b) => ({ id: b.id, name: b.name, address: b.address })),
    platform: PLATFORM,
    aiAgent: AI_AGENT,
  };
}

export function getMarketplace(): MarketplaceView {
  const s = db();
  const projects = s.projects.map((p) => summaryOf(s, p));
  const sum = (f: (x: ProjectSummary) => string) => fromCents(projects.reduce((a, x) => a + toCents(f(x)), 0));
  return {
    stats: {
      totalCommitted: sum((x) => x.funds.raised),
      lockedInEscrow: sum((x) => x.funds.escrowed),
      releasedOnProof: sum((x) => x.funds.released),
      milestonesVerified: projects.reduce((a, x) => a + x.milestonesReleased, 0),
      verifiedBuilders: s.builders.filter((b) => b.verified).length,
      activeProjects: projects.filter((x) => !["completed", "draft"].includes(x.project.status)).length,
    },
    projects,
  };
}

export function getProjectDetail(id: string): ProjectDetail {
  const s = db();
  const p = findProject(s, id);
  return {
    ...summaryOf(s, p),
    milestones: p.milestones.map((m) => milestoneViewOf(s, p, m)),
    timeline: s.events.filter((e) => e.projectId === id).sort((a, b) => b.at.localeCompare(a.at)),
    investments: s.investments.filter((i) => i.projectId === id),
    vault: vaultOf(s, p),
    directory: directoryOf(s),
  };
}

export function getInvestorPortfolio(investorAddress: string): InvestorPortfolio {
  const s = db();
  const investor = INVESTORS.find((i) => i.address === investorAddress);
  if (!investor) throw new ApiError("Unknown investor", 404);
  const positions: InvestorPosition[] = [];
  for (const p of s.projects) {
    const l = s.ledgers[p.id]!;
    const shares = l.holdings[investor.address] ?? 0;
    if (!shares) continue;
    const ownership = shares / l.totalShares;
    const funds = fundsOf(s, p);
    const pr = (v: string) => fromCents(toCents(v) * ownership);
    const price = sharePriceOf(s, p);
    positions.push({
      summary: summaryOf(s, p),
      deposited: fromCents(s.investments.filter((i) => i.projectId === p.id && i.investor === investor.address).reduce((a, i) => a + toCents(i.amount), 0)),
      shares: shares.toFixed(6),
      sharePrice: price.toFixed(6),
      value: fromCents(shares * price * 100),
      ownership,
      exposure: {
        awaitingClose: pr(funds.awaitingClose),
        escrowed: pr(funds.escrowed),
        released: fromCents(Math.max(0, (toCents(funds.released) - toCents(funds.repaid)) * ownership)),
        returned: fromCents((toCents(funds.repaid) + toCents(funds.refunded)) * ownership),
      },
    });
  }
  const tot = (f: (x: InvestorPosition) => string) => fromCents(positions.reduce((a, x) => a + toCents(f(x)), 0));
  const projectIds = new Set(positions.map((x) => x.summary.project.id));
  return {
    investor,
    positions,
    totals: {
      deposited: tot((x) => x.deposited),
      value: tot((x) => x.value),
      awaitingClose: tot((x) => x.exposure.awaitingClose),
      escrowed: tot((x) => x.exposure.escrowed),
      released: tot((x) => x.exposure.released),
      returned: tot((x) => x.exposure.returned),
    },
    events: s.events.filter((e) => projectIds.has(e.projectId)).sort((a, b) => b.at.localeCompare(a.at)),
    directory: directoryOf(s),
  };
}

export function getInspectorQueue(inspectorAddress: string): InspectorQueue {
  const s = db();
  const inspector = INSPECTORS.find((i) => i.address === inspectorAddress);
  if (!inspector) throw new ApiError("Unknown inspector", 404);
  const pending: InspectionTask[] = [];
  const completed: InspectionTask[] = [];
  for (const p of s.projects) {
    const builder = s.builders.find((b) => b.id === p.builderId)!;
    for (const m of p.milestones) {
      const view = milestoneViewOf(s, p, m);
      const mine = view.attestations.find((a) => a.signer === inspector.address) ?? null;
      const task = { project: p, builder, milestone: view, mine };
      if (mine) completed.push(task);
      else if (["ai_reviewed", "inspected"].includes(m.status) && !view.quorum.met) pending.push(task);
    }
  }
  completed.sort((a, b) => (b.mine?.at ?? "").localeCompare(a.mine?.at ?? ""));
  return { inspector, pending, completed };
}

export function getBuilderDashboard(builderId: string): BuilderDashboard {
  const s = db();
  const builder = s.builders.find((b) => b.id === builderId);
  if (!builder) throw new ApiError("Unknown builder", 404);
  const projects: BuilderProjectView[] = s.projects
    .filter((p) => p.builderId === builderId)
    .map((p) => {
      const m = p.milestones.find((x) => !["released", "refunded", "pending"].includes(x.status));
      return { summary: summaryOf(s, p), current: m ? milestoneViewOf(s, p, m) : null };
    });
  const tot = (f: (x: BuilderProjectView) => string) => fromCents(projects.reduce((a, x) => a + toCents(f(x)), 0));
  return {
    builder,
    projects,
    totals: { raised: tot((x) => x.summary.funds.raised), released: tot((x) => x.summary.funds.released), escrowed: tot((x) => x.summary.funds.escrowed) },
    payouts: s.events.filter((e) => e.kind === "escrow_finished" && e.actor === builder.address).sort((a, b) => b.at.localeCompare(a.at)),
  };
}

// ================================================================ public actions

export function invest(input: InvestInput): InvestResult {
  const s = db();
  const p = findProject(s, input.projectId);
  if (p.status !== "funding") throw new ApiError("This project is not accepting deposits", 409);
  if (!INVESTORS.some((i) => i.address === input.investor)) throw new ApiError("Investor lacks a KYC_INVESTOR credential", 403);
  const amount = toCents(input.amount);
  const remaining = toCents(p.terms.principal) - raisedCents(s, p.id);
  if (amount <= 0) throw new ApiError("Amount must be positive");
  if (amount > remaining) throw new ApiError(`Only ${fromCents(remaining)} RLUSD left to raise`, 409);
  const { ev, shares, price } = applyDeposit(s, p, input.investor, fromCents(amount), now());
  return { investment: s.investments[s.investments.length - 1]!, sharesIssued: shares.toFixed(6), sharePrice: price.toFixed(6), event: ev };
}

export function closeLoan(projectId: string): ChainEvent[] {
  const s = db();
  const p = findProject(s, projectId);
  if (p.status !== "funded") throw new ApiError(`Project must be fully funded to close (is ${p.status})`, 409);
  const before = s.events.length;
  closeLoanInternal(s, p, now());
  return s.events.slice(before);
}

export function submitEvidence(input: SubmitEvidenceInput): MilestoneView {
  const s = db();
  const { p, m } = findMilestone(s, input);
  if (!["escrowed", "rejected"].includes(m.status)) throw new ApiError(`Milestone is ${m.status}; evidence not accepted`, 409);
  if (!input.files.length) throw new ApiError("Attach at least one file");
  const at = now();
  s.evidence[m.id] = input.files.map((f: EvidenceUpload, i) => ({
    id: `${m.id}:up${s.seq + 1}:${i}`,
    kind: f.kind,
    filename: f.filename,
    mimeType: f.mimeType,
    uri: f.uri ?? (f.kind === "photo" ? evidenceArtUri(m.templateKey, 1) : evidenceArtUri(f.kind === "invoice" ? "invoice" : "document", 1)),
    sha256: f.sha256,
    meta: f.meta ?? {},
    uploadedAt: at,
  }));
  s.seq += 1;
  delete s.verdicts[m.id];
  s.attestations = s.attestations.filter((a) => a.milestoneId !== m.id);
  m.status = "evidence_submitted";
  return milestoneViewOf(s, p, m);
}

export function runAiReview(ref: MilestoneRef): Verdict {
  const s = db();
  const { p, m } = findMilestone(s, ref);
  if (m.status !== "evidence_submitted") throw new ApiError(`Milestone is ${m.status}; submit evidence first`, 409);
  return reviewInternal(s, p, m, now());
}

export function inspectorAttest(input: AttestInput): AttestResult {
  const s = db();
  const { p, m } = findMilestone(s, input);
  return attestInternal(s, p, m, input, now());
}

export function releaseMilestone(ref: MilestoneRef): ChainEvent {
  const s = db();
  const { p, m } = findMilestone(s, ref);
  if (!quorumOf(s, m).met) throw new ApiError("Signer quorum not met", 409);
  if (m.status === "released") throw new ApiError("Already released", 409);
  return releaseInternal(s, p, m, now());
}

/** Fast-forward: CancelAfter passes → EscrowCancel (funds back to project account) → LoanPay back to the vault. */
export function expireMilestone(ref: MilestoneRef): ChainEvent[] {
  const s = db();
  const { p, m } = findMilestone(s, ref);
  if (["released", "refunded", "pending"].includes(m.status)) throw new ApiError(`Milestone is ${m.status}`, 409);
  const at = now();
  m.cancelAfter = addDays(at, -0.001);
  m.status = "expired";
  const cancel = pushEvent(s, { projectId: p.id, milestoneId: m.id, kind: "escrow_cancelled", actor: p.chain.spv, amount: m.amount, at });
  if (m.escrow) m.escrow.cancelTx = cancel.txHash;
  m.status = "refunded";
  s.ledgers[p.id]!.refundedCents += toCents(m.amount);
  const pay = pushEvent(s, { projectId: p.id, milestoneId: m.id, kind: "loan_payment", actor: p.chain.spv, amount: m.amount, at: addDays(at, 0.00004) });
  p.status = "stalled";
  return [cancel, pay];
}

export function repay(projectId: string): ChainEvent {
  const s = db();
  const p = findProject(s, projectId);
  if (!p.chain.loanId) throw new ApiError("Loan has not closed yet", 409);
  return repayInternal(s, p, now());
}

export function resetMockState() {
  g.__xrlpMock = seed();
}

// ================================================================ demo script driver (docs/04-demo-script.md)

function demoTargets(s: MockState) {
  const p = findProject(s, DEMO_PROJECT_ID);
  const raised = raisedCents(s, p.id);
  const nextDeposit = MAPLE_PLAN.find((d) => !s.investments.some((i) => i.projectId === p.id && i.investor === d.investor.address));
  const submittable = p.milestones.find((m) => ["escrowed", "rejected"].includes(m.status));
  const inspectable = p.milestones.find((m) => ["ai_reviewed", "inspected"].includes(m.status));
  const expirable = [...p.milestones].reverse().find((m) => m.status === "escrowed");
  return { p, raised, nextDeposit, submittable, inspectable, expirable };
}

export function getDemoState(): DemoState {
  const s = db();
  const t = demoTargets(s);
  const remaining = toCents(t.p.terms.principal) - t.raised;
  const steps: DemoStep[] = [
    {
      action: "advance_funding",
      scriptStep: 4,
      title: "Investor deposits RLUSD",
      description: "VaultDeposit into the project vault; share tokens are minted.",
      enabled: t.p.status === "funding" && remaining > 0,
      hint: t.p.status !== "funding" ? "Funding complete" : `${(t.nextDeposit?.investor ?? MARCO).name} deposits ${new Intl.NumberFormat("en-US").format(Math.min(remaining, toCents(t.nextDeposit?.amount ?? fromCents(remaining))) / 100)} RLUSD`,
    },
    {
      action: "close_loan",
      scriptStep: 5,
      title: "Close loan → create escrows",
      description: "LoanSet to the project account, then one EscrowCreate per milestone.",
      enabled: t.p.status === "funded",
      hint: t.p.status === "funded" ? `${t.p.milestones.length} escrows will be created` : t.p.chain.loanId ? "Loan closed" : "Needs full funding",
    },
    {
      action: "submit_good_evidence",
      scriptStep: 6,
      title: "Builder submits genuine evidence",
      description: "Photos with on-site GPS, fresh timestamps, matching invoice → AI review.",
      enabled: !!t.submittable && !t.inspectable,
      hint: t.submittable ? `For ${t.submittable.title}` : "No escrow awaiting evidence",
    },
    {
      action: "inspector_approve",
      scriptStep: 6,
      title: "Inspector signs → escrow releases",
      description: "Key-holding inspector signs and reveals the fulfillment; EscrowFinish pays the builder.",
      enabled: !!t.inspectable,
      hint: t.inspectable ? `${t.inspectable.title} · key held by ${INSPECTORS.find((i) => i.address === s.ledgers[t.p.id]!.releaseKeyHolder[t.inspectable!.id])?.name}` : "Nothing awaiting inspection",
    },
    {
      action: "submit_fraud_evidence",
      scriptStep: 7,
      title: "Builder reuses an old photo",
      description: "Includes a photo from the Oak Ave project with a 2025 EXIF date → AI fails it.",
      enabled: !!t.submittable && !t.inspectable,
      hint: t.submittable ? `For ${t.submittable.title}` : "No escrow awaiting evidence",
    },
    {
      action: "fast_forward_expiry",
      scriptStep: 8,
      title: "Fast-forward: escrow expires",
      description: "CancelAfter passes → EscrowCancel back to the project account → repaid to the vault.",
      enabled: !!t.expirable,
      hint: t.expirable ? `Expires ${t.expirable.title}` : "No untouched escrow left",
    },
    {
      action: "repay",
      scriptStep: 9,
      title: "Builder repays an instalment",
      description: "LoanPay from the project account → vault grows → share price rises.",
      enabled: !!t.p.chain.loanId && t.p.status !== "completed",
      hint: t.p.chain.loanId ? "Principal + interest for one period" : "Loan not closed",
    },
  ];
  return {
    project: summaryOf(s, t.p),
    steps,
    log: s.events.filter((e) => e.projectId === t.p.id).sort((a, b) => b.at.localeCompare(a.at)),
  };
}

export function runDemoAction(action: DemoAction): DemoResult {
  const s = db();
  const before = s.events.length;
  const done = (message: string): DemoResult => ({ message, events: s.events.slice(before) });
  if (action === "reset") {
    resetMockState();
    return { message: "Demo reset to start state", events: [] };
  }
  const t = demoTargets(s);
  switch (action) {
    case "advance_funding": {
      const remaining = toCents(t.p.terms.principal) - t.raised;
      const d = t.nextDeposit ?? { investor: MARCO, amount: fromCents(remaining) };
      const amount = fromCents(Math.min(remaining, toCents(d.amount)));
      invest({ projectId: t.p.id, investor: d.investor.address, amount });
      return done(`${d.investor.name} deposited ${amount} RLUSD`);
    }
    case "close_loan":
      closeLoan(t.p.id);
      return done("Loan closed and milestone escrows created");
    case "submit_good_evidence":
    case "submit_fraud_evidence": {
      if (!t.submittable) throw new ApiError("No milestone awaiting evidence", 409);
      const fraud = action === "submit_fraud_evidence";
      const m = t.submittable;
      const escrowOpenedAt = s.events.find((e) => e.kind === "escrow_created" && e.milestoneId === m.id)?.at;
      const files = fixtureEvidence(t.p, m, now(), { fraud, seed: `demo${s.seq}`, escrowOpenedAt }).map(({ kind, filename, mimeType, sha256, uri, meta }) => ({ kind, filename, mimeType, sha256, uri, meta }));
      submitEvidence({ projectId: t.p.id, milestoneId: m.id, files });
      const v = runAiReview({ projectId: t.p.id, milestoneId: m.id });
      return done(`${m.title}: AI verdict ${v.decision.toUpperCase()}`);
    }
    case "inspector_approve": {
      if (!t.inspectable) throw new ApiError("Nothing awaiting inspection", 409);
      const m = t.inspectable;
      const ledger = s.ledgers[t.p.id]!;
      const keyHolder = ledger.releaseKeyHolder[m.id]!;
      const order = [keyHolder, ...INSPECTORS.map((i) => i.address).filter((a) => a !== keyHolder)];
      let release: ChainEvent | null = null;
      for (const signer of order) {
        if (quorumOf(s, m).met) break;
        if (s.attestations.some((a) => a.milestoneId === m.id && a.signer === signer)) continue;
        release = inspectorAttest({ projectId: t.p.id, milestoneId: m.id, signer, decision: "approve", notes: "Work matches template criteria; verified on site." }).release ?? release;
      }
      return done(release ? `${m.title} released: ${m.amount} RLUSD to builder` : `${m.title} signed; awaiting more signers`);
    }
    case "fast_forward_expiry": {
      if (!t.expirable) throw new ApiError("No untouched escrow to expire", 409);
      expireMilestone({ projectId: t.p.id, milestoneId: t.expirable.id });
      return done(`${t.expirable.title} escrow expired; ${t.expirable.amount} RLUSD back to project account and repaid to vault`);
    }
    case "repay": {
      const ev = repay(t.p.id);
      return done(`Instalment of ${ev.amount} RLUSD paid to the vault`);
    }
  }
}
