// pnpm --filter @xrlp/xrpl bootstrap [--fresh]
// Funds all demo roles on devnet, configures RLUSD issuer + trust lines, writes .data/wallets.json.
import { bootstrapWallets, config, disconnect, rlusdBalance, WALLET_ROLES } from "../src/index.ts";

const fresh = process.argv.includes("--fresh");
try {
  const { wallets, txs } = await bootstrapWallets({ fresh, log: (s) => console.log("  " + s) });
  console.log(`\nwallets: ${config.walletsFile}`);
  for (const role of WALLET_ROLES) {
    const a = wallets[role].classicAddress;
    const bal = role === "issuer" ? "-" : await rlusdBalance(a, wallets.issuer.classicAddress);
    console.log(`  ${role.padEnd(11)} ${a}  RLUSD ${bal}`);
  }
  for (const t of txs) console.log(`  ${String(t.tx.TransactionType).padEnd(12)} ${t.explorerUrl}`);
} finally {
  await disconnect();
}
