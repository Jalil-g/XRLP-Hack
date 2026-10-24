// pnpm --filter @xrlp/xrpl bootstrap [--fresh]
// Funds all demo roles on devnet, configures RLUSD issuer + trust lines, writes WALLETS_FILE (default .data/wallets.json).
// Idempotent: re-running reuses the file, adds missing roles, and submits 0 txs once everything is in place.
import { bootstrapWallets, config, disconnect, rlusdBalance, RLUSD_HOLDERS, WALLET_ROLES } from "../src/index.ts";

const fresh = process.argv.includes("--fresh");
try {
  const { wallets, txs } = await bootstrapWallets({ fresh, log: (s) => console.log("  " + s) });
  console.log(`\nwallets: ${config.walletsFile}`);
  for (const role of WALLET_ROLES) {
    const a = wallets[role].classicAddress;
    const holds = (RLUSD_HOLDERS as readonly string[]).includes(role);
    const bal = holds ? await rlusdBalance(a, wallets.issuer.classicAddress) : "-";
    console.log(`  ${role.padEnd(14)} ${a}  RLUSD ${bal}`);
  }
  console.log(`\n${txs.length} tx submitted${txs.length ? ":" : " (already bootstrapped)"}`);
  for (const t of txs) console.log(`  ${String(t.tx.TransactionType).padEnd(12)} ${t.explorerUrl}`);
} finally {
  await disconnect();
}
