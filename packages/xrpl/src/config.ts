// Runtime configuration (env + repo paths). Devnet only.
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();

const fromRoot = (p: string) => (isAbsolute(p) ? p : resolve(REPO_ROOT, p));

export const config = {
  network: process.env.XRPL_NETWORK ?? "devnet",
  wsUrl: process.env.XRPL_WS_URL ?? "wss://s.devnet.rippletest.net:51233",
  faucetHost: process.env.XRPL_FAUCET_HOST ?? "faucet.devnet.rippletest.net",
  dataDir: fromRoot(process.env.DATA_DIR ?? ".data"),
  walletsFile: fromRoot(process.env.WALLETS_FILE ?? ".data/wallets.json"),
};

/** Throws on any mainnet endpoint or network name. Exported so other packages (core's LEDGER_MODE=devnet) reuse the same guard. */
export function assertNotMainnet(wsUrl: string, network: string): void {
  if (/mainnet|s1\.ripple\.com|s2\.ripple\.com|xrplcluster/i.test(wsUrl) || network === "mainnet") {
    throw new Error(`Refusing to run against mainnet (${wsUrl}). Devnet only.`);
  }
}

assertNotMainnet(config.wsUrl, config.network);

/** Mock RLUSD: 40-char hex currency code for "RLUSD". */
export const RLUSD_CURRENCY = "524C555344000000000000000000000000000000";
