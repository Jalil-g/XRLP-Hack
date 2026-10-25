// XRPL-13b: record real devnet Batch txs into test/fixtures/ for the offline rollback-detection / resume tests.
//   NODE_USE_ENV_PROXY=1 pnpm --filter @xrlp/xrpl exec tsx scripts/capture-batch-fixtures.ts \
//     <label>=<batch hash> [<label>=<batch hash> ...] [--history=<label>:<spv address>]
// Read-only (no txs, no wallets). Per Batch → test/fixtures/batch-<label>.json: the outer `tx` result plus, per inner tx,
// the `tx` lookup pinned to the Batch's own ledger: the validated inner tx, or rippled's txnNotFound payload with
// `searched_all` (= provably not applied). --history → test/fixtures/history-<label>.json: the SPV's `account_tx`
// (LoanSet / Batch / Escrow* entries only).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { explorerTxUrl } from "@xrlp/shared";
import { innerTxHash } from "../src/batch.ts";
import { disconnect, getClient } from "../src/client.ts";

const FIXTURES = join(import.meta.dirname, "..", "test", "fixtures");
type Json = Record<string, unknown>;

async function rpc(req: Json): Promise<Json> {
  const client = await getClient();
  try {
    return ((await client.request(req as never)) as { result: Json }).result;
  } catch (e) {
    const data = (e as { data?: Json }).data;
    if (data?.error) return data; // recorded rippled error payload (txnNotFound + searched_all)
    throw e;
  }
}

function save(name: string, body: Json): void {
  mkdirSync(FIXTURES, { recursive: true });
  const file = join(FIXTURES, name);
  writeFileSync(file, JSON.stringify({ capturedAt: new Date().toISOString(), network: "devnet", ...body }, null, 1) + "\n");
  console.log(`wrote ${file}`);
}

try {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--history=")) {
      const [label, spv] = arg.slice("--history=".length).split(":");
      const r = await rpc({ command: "account_tx", account: spv, ledger_index_min: -1, ledger_index_max: -1, limit: 200, forward: false });
      // Only what the resume parsers read (+ the Batches, which they must ignore): keeps the fixture small.
      const keep = new Set(["LoanSet", "Batch", "EscrowCreate", "EscrowFinish", "EscrowCancel"]);
      const txs = (r.transactions as { tx_json?: Json }[]).filter((t) => keep.has(String(t.tx_json?.TransactionType)));
      save(`history-${label}.json`, { description: `account_tx of SPV ${spv} (newest first; ${[...keep].join("/")} only)`, spv, transactions: txs });
      continue;
    }
    const [label, hash] = arg.split("=");
    if (!label || !hash) throw new Error(`expected <label>=<batch hash>, got ${arg}`);
    const outer = await rpc({ command: "tx", transaction: hash });
    if (outer.error || (outer.tx_json as Json | undefined)?.TransactionType !== "Batch") throw new Error(`${hash} is not a validated Batch: ${JSON.stringify(outer).slice(0, 200)}`);
    const ledgerIndex = Number(outer.ledger_index);
    const raw = ((outer.tx_json as Json).RawTransactions as { RawTransaction: Json }[]).map((r) => r.RawTransaction);
    const inners = [];
    for (const t of raw) {
      const h = innerTxHash(t as never);
      inners.push({ hash: h, lookup: await rpc({ command: "tx", transaction: h, min_ledger: ledgerIndex, max_ledger: ledgerIndex }) });
    }
    save(`batch-${label}.json`, { description: `Batch ${explorerTxUrl(hash)} (ledger ${ledgerIndex}) + ranged lookups of its ${inners.length} inner txs`, outer, inners });
  }
} finally {
  await disconnect();
}
