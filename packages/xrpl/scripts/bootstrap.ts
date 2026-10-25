// pnpm --filter @xrlp/xrpl bootstrap [--fresh] [--no-credentials] [--pre-verify-builder] [--platform-rlusd=N]
// Funds all demo roles on devnet, configures RLUSD issuer + trust lines, mints RLUSD, grants the demo credentials
// (KYC_INVESTOR investor1/2 — never investor3 —, VERIFIED_INSPECTOR inspector1..3), writes WALLETS_FILE
// (default .data/wallets.json). Idempotent: re-running reuses the file, adds missing roles, and submits 0 txs once
// everything is in place. Platform RLUSD target: --platform-rlusd=N or BOOTSTRAP_PLATFORM_RLUSD (default 25 000).
import { bootstrapWallets, config, DEFAULT_PLATFORM_RLUSD, disconnect, rlusdBalance, RLUSD_HOLDERS, WALLET_ROLES } from "../src/index.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const valueOf = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const num = (raw: string | undefined, what: string): number | undefined => {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${what} must be a non-negative number, got ${raw}`);
  return n;
};

const platformRlusd = num(valueOf("platform-rlusd") ?? process.env.BOOTSTRAP_PLATFORM_RLUSD, "platform RLUSD") ?? DEFAULT_PLATFORM_RLUSD;
try {
  const { wallets, txs, credentials } = await bootstrapWallets({
    fresh: flag("fresh"),
    credentials: !flag("no-credentials"),
    preVerifyBuilder: flag("pre-verify-builder"),
    platformRlusd,
    log: (s) => console.log("  " + s),
  });
  console.log(`\nwallets: ${config.walletsFile}   (platform RLUSD target ${platformRlusd})`);
  for (const role of WALLET_ROLES) {
    const a = wallets[role].classicAddress;
    const holds = (RLUSD_HOLDERS as readonly string[]).includes(role);
    const bal = holds ? await rlusdBalance(a, wallets.issuer.classicAddress) : "-";
    const creds = credentials.filter((c) => c.role === role).map((c) => `${c.type}:${c.status}`).join(" ");
    console.log(`  ${role.padEnd(14)} ${a}  RLUSD ${String(bal).padEnd(10)} ${creds}`);
  }
  console.log(`\n${txs.length} tx submitted${txs.length ? ":" : " (already bootstrapped)"}`);
  for (const t of txs) console.log(`  ${String(t.tx.TransactionType).padEnd(16)} ${t.explorerUrl}`);
} finally {
  await disconnect();
}
