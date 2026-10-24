// pnpm --filter @xrlp/core simulate
// Runs docs/04-demo-script.md end-to-end through CoreService with fakes (in-memory) and prints the timeline.
import { FakeClock } from "../clock.ts";
import {
  DEMO,
  MAPLE_ID,
  MAPLE_M,
  mapleExpireMilestone3,
  mapleMilestone1,
  mapleMilestone2Fraud,
  mapleToEscrowed,
  registerParticipants,
  verifyBuilder,
} from "../demo/scenario.ts";
import { isDomainError } from "../errors.ts";
import { createCore } from "../factory.ts";
import { FakeLedger } from "../fakes/fake-ledger.ts";
import { FakeVerifier } from "../fakes/fake-verifier.ts";
import { MemoryInspectorKeyring, type InspectorKeyring } from "../fakes/inspector-keyring.ts";
import { generateMilestoneCondition } from "../conditions.ts";

const clock = new FakeClock("2026-10-25T14:00:00Z");
const delayMs = Number(process.env.FAKE_LEDGER_DELAY_MS ?? 0);
const core = createCore({ inMemory: true, clock, ledger: new FakeLedger({ clock, delayMs }), verifier: new FakeVerifier(clock) });
const keyrings = new Map<string, InspectorKeyring>();
const keyringFor = (a: string) => {
  if (!keyrings.has(a)) keyrings.set(a, new MemoryInspectorKeyring(a));
  return keyrings.get(a)!;
};

let step = 0;
const section = (title: string) => console.log(`\n== ${++step}. ${title} ==`);
const log = (l: string) => console.log(`  ${l}`);
const expectRejected = async (what: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
    throw new Error(`EXPECTED FAILURE DID NOT HAPPEN: ${what}`);
  } catch (e) {
    if (!isDomainError(e)) throw e;
    log(`(guard) ${what} -> ${e.code}: ${e.message}`);
  }
};

section("Participants + builder verification");
await registerParticipants(core, log);
await verifyBuilder(core, DEMO.builders.hudson.id, log);

section("Project + locked terms + funding + loan close -> escrows");
await mapleToEscrowed(core, clock, keyringFor, log);

section("Milestone 1 (Foundation) — the money shot");
await expectRejected("release foundation before any review", () =>
  core.service.releaseMilestone(MAPLE_ID, MAPLE_M.foundation, { fulfillment: keyringFor(DEMO.inspectors[0].address).fulfillmentFor(MAPLE_M.foundation)! }),
);
await mapleMilestone1(core, clock, keyringFor, log);

section("Milestone 2 (Framing) — fraud caught");
await mapleMilestone2Fraud(core, clock, log);
await expectRejected("inspector tries to approve a rejected milestone", () =>
  core.service.inspectorAttest(MAPLE_ID, MAPLE_M.framing, { inspector: DEMO.inspectors[0].address, decision: "approve" }),
);
await expectRejected("release framing with a forged fulfillment", () =>
  core.service.releaseMilestone(MAPLE_ID, MAPLE_M.framing, { fulfillment: generateMilestoneCondition().fulfillment }),
);

section("Stall — Milestone 3 escrow expires, refund flows back to the vault");
await mapleExpireMilestone3(core, clock, log);

section("Final state");
const d = await core.read.getProjectDetail(MAPLE_ID);
log(`Project status: ${d.project.status}${d.stalledReason ? ` (${d.stalledReason})` : ""}`);
for (const m of d.milestones) log(`  ${m.title.padEnd(38)} ${m.amount.padStart(10)}  ${m.status}`);
log(`Vault: deposits ${d.vault.deposits}, loaned ${d.vault.loaned}, repaid ${d.vault.repaid}, withdrawn ${d.vault.withdrawn}, outstanding ${d.vault.outstanding}`);
for (const inv of DEMO.investors) {
  const p = await core.read.getInvestorPortfolio(inv.address);
  log(`${inv.name.padEnd(15)} deposited ${p.totals.deposited.padStart(10)}  withdrawn ${p.totals.withdrawn.padStart(10)}  value ${p.totals.currentValue}`);
}
const dash = await core.read.getBuilderDashboard(DEMO.builders.hudson.id);
log(`Builder: released ${dash.totals.released}, still locked ${dash.totals.locked}, next: ${dash.projects[0]?.nextAction}`);

section(`On-chain timeline (${d.timeline.length} txs)`);
for (const e of d.timeline) {
  const mTitle = e.milestoneId ? d.milestones.find((m) => m.id === e.milestoneId)?.title : undefined;
  console.log(`  ${e.at.slice(0, 16)}  ${e.kind.padEnd(19)} ${(e.amount ?? "").padStart(10)}  ${(mTitle ?? "").padEnd(18)} ${e.explorerUrl}`);
}
console.log("\nSIMULATION OK");
