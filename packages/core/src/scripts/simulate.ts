// pnpm --filter @xrlp/core simulate
// Runs docs/04-demo-script.md end to end through CoreService (in-memory, fake ledger + verifier, real ReleaseService)
// and prints the on-chain timeline.
import { FakeClock } from "../clock.ts";
import { DAY_MS } from "../clock.ts";
import { demoCancelAfter, MAPLE_ID, OAK_ID, seedDemo, SEED_BACKDATE_MS } from "../demo/scenario.ts";
import { isDomainError } from "../errors.ts";
import { createCore } from "../factory.ts";

const clock = new FakeClock(new Date(Date.now() - SEED_BACKDATE_MS));
const core = createCore({ inMemory: true, clock, cancelAfterFor: demoCancelAfter });
const svc = core.service;
let step = 0;
const section = (t: string) => console.log(`\n== ${++step}. ${t} ==`);
const log = (l: string) => console.log(`  ${l}`);

section("Pre-stage (seed)");
await seedDemo(svc, clock, log);

const maple = await svc.getProject(MAPLE_ID);
const [m1, m2] = maple.project.milestones;

section("Beat 3 — money shot: run checks on Maple M1");
const r1 = await svc.runChecks(MAPLE_ID, m1!.id);
log(`verdict ${r1.verdict.decision} (${r1.verdict.confidence}) -> released ${r1.release?.explorerUrl}`);

section("Beat 4 — fraud held: run checks on Maple M2");
const r2 = await svc.runChecks(MAPLE_ID, m2!.id);
for (const c of r2.verdict.checks.filter((c) => c.result === "fail")) log(`RED ${c.check}: ${c.reason}`);

section("Beat 5 — ledger says no");
const steal = await svc.tryStealDemo(MAPLE_ID, m2!.id);
log(`${steal.result} ${steal.explorerUrl}`);

section("Beat 6 — stall -> keeper tick (Oak Ave)");
const tick = await svc.keeperTick();
for (const e of tick.events) log(`${e.kind} ${e.amount ?? ""} ${e.explorerUrl}`);
log(`Oak Ave status: ${(await svc.getProject(OAK_ID)).project.status}`);

section("Guards");
try {
  await svc.withdraw(MAPLE_ID, { investor: maple.investments[0]!.investor, amount: "1" });
} catch (e) {
  if (!isDomainError(e)) throw e;
  log(`withdraw before RedemptionDate -> ${e.code}`);
}
clock.advance(400 * DAY_MS);
const w = await svc.withdraw(OAK_ID, { investor: maple.investments[0]!.investor, amount: "100" });
log(`withdraw after RedemptionDate -> ${w.events[0]?.kind}`);

section("Final");
const d = await svc.getProject(MAPLE_ID);
for (const m of d.project.milestones) log(`${m.title.padEnd(22)} ${m.amount.padStart(8)}  ${m.status}  checks: ${d.checks[m.id]?.outcome}`);
section(`Maple St on-chain timeline (${d.events.length} txs)`);
for (const e of [...d.events].reverse()) console.log(`  ${e.at.slice(0, 16)}  ${e.kind.padEnd(22)} ${(e.result ?? "").padEnd(25)} ${e.explorerUrl}`);
console.log("\nSIMULATION OK");
