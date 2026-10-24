// The demo story (docs/04-demo-script.md) as reusable steps. Used by `seed`, `simulate` and tests.
// Addresses are deterministic fakes; when the devnet adapter lands, swap them for the funded wallets
// produced by @xrlp/xrpl's bootstrap (TODO).
import type { XrplAddress } from "@xrlp/shared";
import type { FakeClock } from "../clock.ts";
import type { InspectorKeyring } from "../fakes/inspector-keyring.ts";
import type { Core } from "../factory.ts";
import { fakeAddress } from "../ids.ts";
import type { CreateProjectInput, RegisterBuilderInput } from "../service.ts";
import { demoDoc, demoPhoto, nearby } from "./fixtures.ts";

export type Log = (line: string) => void;
export type KeyringFor = (inspector: XrplAddress) => InspectorKeyring;

const HOUR = 3_600_000;

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
    empire: {
      id: "bld-empire-commercial",
      name: "Empire Commercial Partners",
      address: fakeAddress("builder:empire"),
      licenseNumber: "NY-GC-2012-00931",
      insurancePolicy: "GL-10077-EC",
      completedProjects: 22,
      riskTier: "low",
    },
  } satisfies Record<string, RegisterBuilderInput & { id: string; address: string }>,
  investors: [
    { name: "Ava Chen", address: fakeAddress("investor:ava") },
    { name: "Marcus Johnson", address: fakeAddress("investor:marcus") },
    { name: "Priya Patel", address: fakeAddress("investor:priya") },
  ],
  inspectors: [
    { name: "Dana Ruiz (Hudson Code Inspections)", address: fakeAddress("inspector:dana"), licenseNumber: "NYS-CEO-3341" },
    { name: "Tom Becker (Valley Site Services)", address: fakeAddress("inspector:tom"), licenseNumber: "NYS-CEO-5120" },
  ],
  maple: {
    id: "maple-st-duplex",
    name: "Maple St Duplex",
    siteAddress: "48 Maple St, Beacon, NY 12508",
    siteGeo: { lat: 41.5048, lng: -73.9696, radiusM: 150 },
  },
} as const;

export const MAPLE_ID = DEMO.maple.id;
export const ms = (projectId: string, n: number, key: string) => `${projectId}-m${n}-${key}`;
export const MAPLE_M = {
  foundation: ms(MAPLE_ID, 1, "foundation"),
  framing: ms(MAPLE_ID, 2, "framing"),
  dryIn: ms(MAPLE_ID, 3, "dry_in"),
  finish: ms(MAPLE_ID, 4, "finish"),
};

const dana = DEMO.inspectors[0].address;
const tom = DEMO.inspectors[1].address;

export async function registerParticipants(core: Core, log: Log = () => {}): Promise<void> {
  const { service } = core;
  for (const b of Object.values(DEMO.builders)) await service.registerBuilder(b);
  for (const i of DEMO.investors) {
    const { event } = await service.registerInvestor(i);
    log(`KYC_INVESTOR credential -> ${i.name}  ${event.explorerUrl}`);
  }
  for (const i of DEMO.inspectors) await service.registerInspector(i);
}

export async function verifyBuilder(core: Core, builderId: string, log: Log = () => {}) {
  const r = await core.service.verifyBuilder(builderId, [
    { kind: "license", filename: "gc-license.pdf", fields: { status: "active" } },
    { kind: "insurance", filename: "coi-general-liability.pdf", fields: { status: "active" } },
    { kind: "track_record", filename: "completed-projects.csv" },
  ]);
  log(`AI builder review: ${r.verification.ok ? "OK" : "REJECTED"} — ${r.verification.reasons.join("; ")}`);
  if (r.event) log(`VERIFIED_BUILDER credential -> ${r.builder.name}  ${r.event.explorerUrl}`);
  return r;
}

/** Condition-holding inspector generates one condition per milestone on their own device and submits them. */
export async function supplyConditions(core: Core, projectId: string, inspector: XrplAddress, keyrings: KeyringFor) {
  const p = (await core.read.getProjectDetail(projectId)).project;
  const kr = keyrings(inspector);
  return core.service.submitMilestoneConditions(projectId, {
    inspector,
    conditions: p.milestones.map((m) => ({ milestoneId: m.id, condition: kr.conditionFor(m.id) })),
  });
}

export function mapleInput(clock: FakeClock): CreateProjectInput {
  return {
    id: DEMO.maple.id,
    builderId: DEMO.builders.hudson.id,
    name: DEMO.maple.name,
    type: "residential_new",
    siteAddress: DEMO.maple.siteAddress,
    siteGeo: DEMO.maple.siteGeo,
    description:
      "Two-family new build on a 0.2-acre infill lot, two blocks from Main St. 2 x 3BR/2BA units, ~2,600 sq ft total. Permits issued.",
    terms: {
      principal: "120000.00",
      interestRateBps: 1100,
      termDays: 270,
      paymentIntervalDays: 30,
      fundingDeadline: new Date(clock.now().getTime() + 14 * 24 * HOUR).toISOString(),
    },
    inspectors: [dana, tom],
  };
}

/** Steps 3-5: project from template, terms locked, funding opened, 3 investors fund, loan closes -> escrows. */
export async function mapleToEscrowed(core: Core, clock: FakeClock, keyrings: KeyringFor, log: Log = () => {}, stopAt?: "funding") {
  const { service } = core;
  const p = await service.createProject(mapleInput(clock));
  log(`Project "${p.name}" created from residential_new template: ${p.milestones.map((m) => `${m.title} ${m.amount}`).join(" | ")}`);
  await service.lockTerms(p.id);
  log("Terms locked by platform");
  await service.openFunding(p.id);
  await supplyConditions(core, p.id, dana, keyrings);
  log("Inspector Dana generated escrow conditions on her device (fulfillments never leave it)");
  if (stopAt === "funding") return;
  const amounts = ["50000.00", "40000.00", "30000.00"];
  for (const [i, inv] of DEMO.investors.entries()) {
    clock.advance(HOUR);
    const r = await service.invest(p.id, { investor: inv.address, amount: amounts[i]! });
    log(`${inv.name} deposits ${amounts[i]} RLUSD -> vault  ${r.event.explorerUrl}`);
    if (r.project.status === "escrowed") log(`Fully funded -> LoanSet to SPV + ${r.project.milestones.length} escrows created`);
  }
}

export function mapleFoundationEvidence(clock: FakeClock) {
  const geo = DEMO.maple.siteGeo;
  const t = clock.now();
  return [
    demoPhoto({ label: "Foundation — wide shot", filename: "foundation-wide.jpg", takenAt: t, gps: nearby(geo, 10), hue: 25 }),
    demoPhoto({ label: "Foundation — anchor bolts", filename: "foundation-bolts.jpg", takenAt: t, gps: nearby(geo, 15), hue: 28 }),
    demoPhoto({ label: "Foundation — slab close-up", filename: "foundation-slab.jpg", takenAt: t, gps: nearby(geo, 5), hue: 22 }),
    demoDoc({ kind: "invoice", filename: "concrete-rebar-invoice.pdf", title: "Hudson Ready-Mix invoice #4471", invoiceTotal: "27850.00" }),
    demoDoc({ kind: "document", filename: "footing-inspection.pdf", title: "Footing inspection — PASSED" }),
  ];
}

/** Step 6: evidence -> AI pass -> inspector signs + hands over fulfillment -> escrow finishes. */
export async function mapleMilestone1(core: Core, clock: FakeClock, keyrings: KeyringFor, log: Log = () => {}) {
  const { service } = core;
  clock.advance(21 * 24 * HOUR);
  await service.submitEvidence(MAPLE_ID, MAPLE_M.foundation, { evidence: mapleFoundationEvidence(clock) });
  log("Builder uploads foundation evidence (3 photos, invoice, footing sign-off)");
  clock.advance(HOUR);
  const { verdict } = await service.runAiReview(MAPLE_ID, MAPLE_M.foundation);
  log(`AI verdict: ${verdict.decision.toUpperCase()} (${verdict.confidence}) — ${verdict.summary}`);
  for (const c of verdict.checks) log(`   [${c.result}] ${c.check}: ${c.reason}`);
  clock.advance(2 * HOUR);
  const r = await service.inspectorAttest(MAPLE_ID, MAPLE_M.foundation, {
    inspector: dana,
    decision: "approve",
    notes: "On site 10:40. Slab cured, anchor bolts per plan.",
    fulfillment: keyrings(dana).fulfillmentFor(MAPLE_M.foundation),
  });
  log(`Inspector Dana approves  ${r.attestation.txHash}`);
  if (r.released) log(`Escrow finished -> ${r.milestone.amount} RLUSD to builder  ${r.released.explorerUrl}`);
  return r;
}

/** Step 7: builder reuses an old photo -> AI fail -> money stays locked. */
export async function mapleMilestone2Fraud(core: Core, clock: FakeClock, log: Log = () => {}) {
  const { service } = core;
  const geo = DEMO.maple.siteGeo;
  // Reuse a foundation photo byte-for-byte + an old photo from a different job.
  const reused = (await core.read.getProjectDetail(MAPLE_ID)).milestones[0]!.evidence[0]!;
  clock.advance(30 * 24 * HOUR);
  const t = clock.now();
  await service.submitEvidence(MAPLE_ID, MAPLE_M.framing, {
    evidence: [
      { kind: "photo", filename: "framing-north.jpg", mimeType: reused.mimeType, uri: reused.uri, sha256: reused.sha256, meta: reused.meta },
      demoPhoto({ label: "Framing — east wall", filename: "framing-east.jpg", takenAt: "2024-05-02T15:00:00Z", gps: nearby(geo, 12), hue: 40 }),
      demoPhoto({ label: "Framing — south wall", filename: "framing-south.jpg", takenAt: t, gps: nearby(geo, 8), hue: 42 }),
      demoPhoto({ label: "Framing — trusses", filename: "framing-trusses.jpg", takenAt: t, gps: nearby(geo, 6), hue: 44 }),
      demoDoc({ kind: "invoice", filename: "lumber-package.pdf", title: "Lumber package invoice", invoiceTotal: "33400.00" }),
    ],
  });
  log("Builder uploads framing evidence (one photo reused from foundation, one from 2024)");
  clock.advance(HOUR);
  const { verdict, milestone } = await service.runAiReview(MAPLE_ID, MAPLE_M.framing);
  log(`AI verdict: ${verdict.decision.toUpperCase()} — ${verdict.summary}`);
  for (const c of verdict.checks.filter((c) => c.result === "fail")) log(`   [fail] ${c.check}: ${c.reason}`);
  log(`Milestone status: ${milestone.status} — ${milestone.amount} RLUSD stays in escrow`);
  return { verdict, milestone };
}

/** Step 8: fast-forward past milestone 3's CancelAfter -> EscrowCancel -> LoanPay back to vault -> investors withdraw. */
export async function mapleExpireMilestone3(core: Core, clock: FakeClock, log: Log = () => {}) {
  const { service } = core;
  const m3 = (await core.read.getProjectDetail(MAPLE_ID)).project.milestones[2]!;
  clock.set(new Date(new Date(m3.cancelAfter!).getTime() + HOUR));
  log(`Fast-forward to ${clock.now().toISOString().slice(0, 10)} (past "${m3.title}" CancelAfter)`);
  const r = await service.expireMilestone(MAPLE_ID, m3.id);
  log(`EscrowCancel -> ${m3.amount} RLUSD back to SPV  ${r.events[0]!.explorerUrl}`);
  log(`SPV LoanPay -> vault  ${r.events[1]!.explorerUrl}`);
  for (const inv of DEMO.investors) {
    const w = await service.withdraw(MAPLE_ID, { investor: inv.address });
    log(`${inv.name} withdraws ${w.amount} RLUSD  ${w.event.explorerUrl}`);
  }
  return r;
}

/** Two more marketplace projects at different stages. */
export async function seedOtherProjects(core: Core, clock: FakeClock, keyrings: KeyringFor, log: Log = () => {}) {
  const { service } = core;
  const deadline = (days: number) => new Date(clock.now().getTime() + days * 24 * HOUR).toISOString();

  // Elm Ave — renovation, ~45% funded.
  const elm = await service.createProject({
    id: "elm-ave-brownstone",
    builderId: DEMO.builders.catskill.id,
    name: "Elm Ave Brownstone Renovation",
    type: "residential_renovation",
    siteAddress: "112 Elm Ave, Kingston, NY 12401",
    siteGeo: { lat: 41.9304, lng: -74.0004, radiusM: 100 },
    description: "Gut renovation of an 1890s brownstone into 2 units: new MEP, kitchens, baths, restored facade.",
    terms: { principal: "85000.00", interestRateBps: 1200, termDays: 180, paymentIntervalDays: 30, fundingDeadline: deadline(10) },
    inspectors: [dana, tom],
  });
  await service.lockTerms(elm.id);
  await service.openFunding(elm.id);
  await supplyConditions(core, elm.id, dana, keyrings);
  await service.invest(elm.id, { investor: DEMO.investors[1].address, amount: "25000.00" });
  await service.invest(elm.id, { investor: DEMO.investors[2].address, amount: "13000.00" });
  log(`"${elm.name}" funding: 38000 / 85000 RLUSD`);

  // Riverside — commercial, escrowed, milestone 1 released, milestone 2 waiting on inspectors.
  const rv = await service.createProject({
    id: "riverside-commons",
    builderId: DEMO.builders.empire.id,
    name: "Riverside Commons Retail",
    type: "commercial_small",
    siteAddress: "5 River Rd, Newburgh, NY 12550",
    siteGeo: { lat: 41.5034, lng: -74.0104, radiusM: 200 },
    description: "Single-storey 8,000 sq ft retail strip (4 bays) on a cleared riverside pad. Two pre-leased anchors.",
    terms: { principal: "400000.00", interestRateBps: 1000, termDays: 365, paymentIntervalDays: 30, fundingDeadline: deadline(7) },
    inspectors: [dana, tom],
  });
  await service.lockTerms(rv.id);
  await service.openFunding(rv.id);
  await supplyConditions(core, rv.id, dana, keyrings);
  await service.invest(rv.id, { investor: DEMO.investors[0].address, amount: "150000.00" });
  await service.invest(rv.id, { investor: DEMO.investors[1].address, amount: "150000.00" });
  await service.invest(rv.id, { investor: DEMO.investors[2].address, amount: "100000.00" });
  const geo = rv.siteGeo;
  const photos = (prefix: string, n: number, hue: number) =>
    Array.from({ length: n }, (_, i) =>
      demoPhoto({ label: `${prefix} ${i + 1}`, filename: `${prefix.toLowerCase().replace(/\W+/g, "-")}-${i + 1}.jpg`, takenAt: clock.now(), gps: nearby(geo, 10 + i * 5), hue }),
    );
  clock.advance(HOUR);
  const m1 = ms(rv.id, 1, "site_foundation");
  await service.submitEvidence(rv.id, m1, {
    evidence: [...photos("Site + foundation", 4, 15), demoDoc({ kind: "document", filename: "geotech.pdf", title: "Geotech + foundation inspection" })],
  });
  await service.runAiReview(rv.id, m1);
  await service.inspectorAttest(rv.id, m1, { inspector: tom, decision: "approve", notes: "Footings and slab per plan." });
  await service.inspectorAttest(rv.id, m1, {
    inspector: dana,
    decision: "approve",
    notes: "Concur.",
    fulfillment: keyrings(dana).fulfillmentFor(m1),
  });
  clock.advance(HOUR);
  const m2 = ms(rv.id, 2, "structure");
  await service.submitEvidence(rv.id, m2, {
    evidence: [...photos("Steel frame + envelope", 5, 200), demoDoc({ kind: "invoice", filename: "steel.pdf", title: "Structural steel invoice", invoiceTotal: "152000.00" })],
  });
  await service.runAiReview(rv.id, m2);
  log(`"${rv.name}" escrowed: milestone 1 released, milestone 2 awaiting 2 inspectors`);
}

export type SeedStage = "fresh" | "verified" | "funding" | "escrowed" | "m1-released" | "fraud-caught";
export const SEED_STAGES: SeedStage[] = ["fresh", "verified", "funding", "escrowed", "m1-released", "fraud-caught"];

/** How far before "now" the seed clock should start so the story ends just before now. */
export const SEED_START_OFFSET_MS: Record<SeedStage, number> = {
  fresh: 2 * HOUR,
  verified: 2 * HOUR,
  funding: 2 * HOUR,
  escrowed: 6 * HOUR,
  "m1-released": 22 * 24 * HOUR,
  "fraud-caught": 52 * 24 * HOUR,
};

/** Seed the marketplace with Maple St at `stage` (other projects are created last so their deadlines are fresh). */
export async function seedDemo(core: Core, clock: FakeClock, keyrings: KeyringFor, stage: SeedStage, log: Log = () => {}) {
  await registerParticipants(core, log);
  await verifyBuilder(core, DEMO.builders.catskill.id);
  await verifyBuilder(core, DEMO.builders.empire.id);
  if (stage !== "fresh") await verifyBuilder(core, DEMO.builders.hudson.id, log);
  if (!["fresh", "verified"].includes(stage)) {
    await mapleToEscrowed(core, clock, keyrings, log, stage === "funding" ? "funding" : undefined);
    if (stage === "m1-released" || stage === "fraud-caught") await mapleMilestone1(core, clock, keyrings, log);
    if (stage === "fraud-caught") await mapleMilestone2Fraud(core, clock, log);
  }
  await seedOtherProjects(core, clock, keyrings, log);
}
