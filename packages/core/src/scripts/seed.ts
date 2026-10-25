// pnpm --filter @xrlp/core seed
// Wipes DATA_DIR (core-db.json, fake-ledger.json, release-vault.json) and writes the pre-staged demo (docs/04-demo-script.md).
// Same as POST /api/admin/demo/reset { seed: "maple-st" }. Fake ledger only; on devnet use the XRPL prestage script.
import { join } from "node:path";
import { createCore } from "../factory.ts";

const core = createCore();
await core.service.resetDemo({ seed: "maple-st" });
const projects = await core.service.listProjects();
console.log(`Seeded ${projects.length} projects -> ${join(core.dataDir!, "core-db.json")}`);
for (const p of projects) console.log(`  - ${p.name.padEnd(22)} ${p.status.padEnd(9)} ${p.raised}/${p.principal} RLUSD`);
