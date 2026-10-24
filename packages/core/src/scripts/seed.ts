// pnpm --filter @xrlp/core seed [--stage=funding] [--keep]
// Writes demo data to DATA_DIR/core-db.json (default <repo>/.data). Wipes existing core data unless --keep.
// Stages: fresh | verified | funding (default) | escrowed | m1-released | fraud-caught
import { rmSync } from "node:fs";
import { join } from "node:path";
import { FakeClock } from "../clock.ts";
import { seedDemo, SEED_STAGES, SEED_START_OFFSET_MS, type SeedStage } from "../demo/scenario.ts";
import { createCore } from "../factory.ts";
import { FakeLedger } from "../fakes/fake-ledger.ts";
import { FakeVerifier } from "../fakes/fake-verifier.ts";
import { FileInspectorKeyring, type InspectorKeyring } from "../fakes/inspector-keyring.ts";
import { resolveDataDir } from "../file-store.ts";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const stage = (arg("stage") ?? "funding") as SeedStage;
if (!SEED_STAGES.includes(stage)) {
  console.error(`Unknown --stage=${stage}. One of: ${SEED_STAGES.join(", ")}`);
  process.exit(1);
}

const dataDir = resolveDataDir();
const clock = new FakeClock(new Date(Date.now() - SEED_START_OFFSET_MS[stage]));
// Seed always uses fakes (fake tx hashes); the real devnet flow is driven live by @xrlp/xrpl.
const core = createCore({ dataDir, clock, ledger: new FakeLedger({ clock }), verifier: new FakeVerifier(clock) });

if (!process.argv.includes("--keep")) {
  await core.store.reset();
  rmSync(join(dataDir, "inspector-keyrings"), { recursive: true, force: true });
}
const keyrings = new Map<string, InspectorKeyring>();
const keyringFor = (a: string) => {
  if (!keyrings.has(a)) keyrings.set(a, new FileInspectorKeyring(a, dataDir));
  return keyrings.get(a)!;
};

await seedDemo(core, clock, keyringFor, stage, (l) => console.log(`  ${l}`));
const market = await core.read.getMarketplace();
console.log(`\nSeeded ${market.length} projects (Maple St stage: ${stage}) -> ${join(dataDir, "core-db.json")}`);
for (const p of market) console.log(`  - ${p.name.padEnd(32)} ${p.status.padEnd(10)} ${p.raised}/${p.principal} RLUSD (${p.fundedPct}%)`);
console.log(`Inspector keyrings (demo stand-in for inspector devices): ${join(dataDir, "inspector-keyrings")}`);
