// Demo wallet store (.data/wallets.json, gitignored). Devnet seeds only — never commit.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Wallet } from "xrpl";
import { config } from "./config.ts";
import { getClient } from "./client.ts";

export const WALLET_ROLES = [
  "issuer",
  "platform",
  "builder",
  "investor1",
  "investor2",
  "investor3",
  "inspectorA",
  "inspectorB",
  "aiAgent",
] as const;
export type WalletRole = (typeof WALLET_ROLES)[number];

export interface StoredWallet {
  address: string;
  seed: string;
}

export interface WalletFile {
  network: string;
  createdAt: string;
  wallets: Record<WalletRole, StoredWallet>;
  /** Per-project SPV accounts (master key disabled after setup; seed kept only for reference). */
  spvs: Record<string, StoredWallet>;
}

export type DemoWallets = Record<WalletRole, Wallet>;

export function loadWalletFile(): WalletFile | undefined {
  if (!existsSync(config.walletsFile)) return undefined;
  return JSON.parse(readFileSync(config.walletsFile, "utf8")) as WalletFile;
}

export function saveWalletFile(f: WalletFile): void {
  mkdirSync(dirname(config.walletsFile), { recursive: true });
  writeFileSync(config.walletsFile, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 });
}

export function walletsFromFile(f: WalletFile): DemoWallets {
  const out = {} as DemoWallets;
  for (const role of WALLET_ROLES) {
    const w = f.wallets[role];
    if (!w) throw new Error(`wallets.json missing role ${role}; re-run bootstrap`);
    out[role] = Wallet.fromSeed(w.seed);
  }
  return out;
}

/** Load wallets from .data/wallets.json (throws if bootstrap hasn't run). */
export function loadWallets(): DemoWallets {
  const f = loadWalletFile();
  if (!f) throw new Error(`No wallets at ${config.walletsFile}. Run: pnpm --filter @xrlp/xrpl bootstrap`);
  return walletsFromFile(f);
}

/** Resolve a role name, a known demo address (r...), or pass a Wallet through. */
export function resolveWallet(w: WalletRole | string | Wallet): Wallet {
  if (typeof w !== "string") return w;
  const all = loadWallets();
  if ((WALLET_ROLES as readonly string[]).includes(w)) return all[w as WalletRole];
  const hit = Object.values(all).find((x) => x.classicAddress === w);
  if (!hit) throw new Error(`no demo wallet for ${w} (role name or address from .data/wallets.json expected)`);
  return hit;
}

export async function xrpBalance(address: string): Promise<number> {
  const client = await getClient();
  try {
    return Number(await client.getXrpBalance(address));
  } catch (e) {
    if (String((e as Error).message).includes("actNotFound") || String((e as Error).message).includes("Account not found")) return 0;
    throw e;
  }
}

/** Fund (or top up) a wallet from the devnet faucet. */
export async function fundFromFaucet(wallet?: Wallet): Promise<Wallet> {
  const client = await getClient();
  for (let attempt = 1; ; attempt++) {
    try {
      const { wallet: funded } = await client.fundWallet(wallet ?? null, { faucetHost: config.faucetHost });
      return funded;
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

/**
 * Ensure every demo role has a funded devnet account. Reuses .data/wallets.json when present;
 * tops up any account below `minXrp`. Does NOT configure tokens (see setupRlusd).
 */
export async function ensureFundedWallets(opts: { fresh?: boolean; minXrp?: number; log?: (s: string) => void } = {}): Promise<DemoWallets> {
  const log = opts.log ?? (() => {});
  const minXrp = opts.minXrp ?? 30;
  let file = opts.fresh ? undefined : loadWalletFile();
  if (!file) {
    const wallets = {} as Record<WalletRole, StoredWallet>;
    for (const role of WALLET_ROLES) {
      const w = Wallet.generate();
      wallets[role] = { address: w.classicAddress, seed: w.seed! };
    }
    file = { network: config.network, createdAt: new Date().toISOString(), wallets, spvs: {} };
    saveWalletFile(file);
    log(`generated ${WALLET_ROLES.length} wallets -> ${config.walletsFile}`);
  }
  const wallets = walletsFromFile(file);
  for (const role of WALLET_ROLES) {
    const bal = await xrpBalance(wallets[role].classicAddress);
    if (bal < minXrp) {
      await fundFromFaucet(wallets[role]);
      log(`funded ${role} ${wallets[role].classicAddress} (was ${bal} XRP)`);
    }
  }
  return wallets;
}

export function rememberSpv(projectId: string, w: Wallet): void {
  const f = loadWalletFile();
  if (!f) throw new Error("wallets.json missing");
  f.spvs[projectId] = { address: w.classicAddress, seed: w.seed! };
  saveWalletFile(f);
}
