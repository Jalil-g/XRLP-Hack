// Demo wallet store (.data/wallets.json, gitignored). Devnet seeds only — never commit.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Wallet } from "xrpl";
import { config } from "./config.ts";
import { getClient, isNotFound } from "./client.ts";

/** Demo roles (Direction v2). See docs/03-architecture.md "Accounts". */
export const WALLET_ROLES = [
  "issuer",
  "platform",
  "releaseService",
  "builder",
  "investor1",
  "investor2",
  "investor3",
  "inspector1",
  "inspector2",
  "inspector3",
  "aiAgent",
  "trustee",
] as const;
export type WalletRole = (typeof WALLET_ROLES)[number];

/** v1 role names carried over to a v2 role so an existing (funded, trust-lined) account is reused. */
export const LEGACY_ROLE_RENAMES: Readonly<Record<string, WalletRole>> = {
  inspectorA: "inspector1",
  inspectorB: "inspector2",
};

/**
 * Roles that hold RLUSD and so need a trust line to the issuer. releaseService, trustee, inspectors and aiAgent only
 * sign (SPV multisig, EscrowFinish, 1-drop XRP attestations), so they get no trust line.
 */
export const RLUSD_HOLDERS = ["platform", "builder", "investor1", "investor2", "investor3"] as const satisfies readonly WalletRole[];

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
  /** Wallets of roles that no longer exist (kept, never deleted, so no devnet seed is lost). */
  retired?: Record<string, StoredWallet>;
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

// ---------------------------------------------------------------- pure wallet-file logic (offline, unit-tested)

export interface WalletFileMigration {
  file: WalletFile;
  /** Roles that got a freshly generated wallet. */
  added: WalletRole[];
  /** Legacy role -> v2 role (same account). */
  renamed: [string, WalletRole][];
  /** Unknown roles moved to `retired`. */
  retired: string[];
  /** True if `file` differs from the input and must be saved. */
  changed: boolean;
}

const generateStored = (): StoredWallet => {
  const w = Wallet.generate();
  return { address: w.classicAddress, seed: w.seed! };
};

/**
 * Bring a wallet file up to the current WALLET_ROLES without touching wallets that already exist:
 * legacy roles are renamed (LEGACY_ROLE_RENAMES), missing roles are generated, unknown roles are retired.
 * `undefined` -> a brand-new file. Throws on a network mismatch (devnet seeds are useless elsewhere).
 */
export function migrateWalletFile(
  existing: WalletFile | undefined,
  opts: { network: string; generate?: () => StoredWallet; now?: () => Date },
): WalletFileMigration {
  const generate = opts.generate ?? generateStored;
  if (existing && existing.network !== opts.network) {
    throw new Error(`wallet file is for ${existing.network}, not ${opts.network}; use another WALLETS_FILE or --fresh`);
  }
  const src: Record<string, StoredWallet> = { ...(existing?.wallets ?? {}) };
  const retiredIn: Record<string, StoredWallet> = { ...(existing?.retired ?? {}) };
  const renamed: [string, WalletRole][] = [];
  for (const [legacy, role] of Object.entries(LEGACY_ROLE_RENAMES)) {
    if (src[legacy] && !src[role]) {
      src[role] = src[legacy]!;
      delete src[legacy];
      renamed.push([legacy, role]);
    }
  }
  const wallets = {} as Record<WalletRole, StoredWallet>;
  const added: WalletRole[] = [];
  for (const role of WALLET_ROLES) {
    const w = src[role];
    if (w?.address && w.seed) wallets[role] = w;
    else {
      wallets[role] = generate();
      added.push(role);
    }
    delete src[role];
  }
  const retired = Object.keys(src);
  for (const k of retired) {
    let key = k;
    for (let i = 2; retiredIn[key] && retiredIn[key]!.address !== src[k]!.address; i++) key = `${k}#${i}`;
    retiredIn[key] = src[k]!;
  }
  const file: WalletFile = {
    network: existing?.network ?? opts.network,
    createdAt: existing?.createdAt ?? (opts.now?.() ?? new Date()).toISOString(),
    wallets,
    spvs: existing?.spvs ?? {},
    ...(Object.keys(retiredIn).length ? { retired: retiredIn } : {}),
  };
  return { file, added, renamed, retired, changed: !existing || added.length > 0 || renamed.length > 0 || retired.length > 0 || !existing.spvs };
}

export interface RlusdTarget {
  role: WalletRole;
  /** Top the holder up to at least this much RLUSD. */
  target: number;
}

/** Who gets minted how much RLUSD by bootstrap (top-up targets, so re-runs mint nothing). */
export function rlusdTopUpPlan(opts: { investorRlusd?: number; platformRlusd?: number; builderRlusd?: number } = {}): RlusdTarget[] {
  return [
    ...(["investor1", "investor2", "investor3"] as const).map((role) => ({ role, target: opts.investorRlusd ?? 50_000 })),
    { role: "platform", target: opts.platformRlusd ?? 25_000 },
    { role: "builder", target: opts.builderRlusd ?? 1_000 },
  ];
}

// ---------------------------------------------------------------- store + network

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
    if (isNotFound(e)) return 0;
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
 * Ensure every demo role has a funded devnet account. Reuses the wallet file when present (adding missing
 * roles, renaming v1 roles, never regenerating existing ones); tops up any account below `minXrp`.
 * Does NOT configure tokens (see bootstrapWallets).
 */
export async function ensureFundedWallets(opts: { fresh?: boolean; minXrp?: number; log?: (s: string) => void } = {}): Promise<DemoWallets> {
  const log = opts.log ?? (() => {});
  const minXrp = opts.minXrp ?? 30;
  const m = migrateWalletFile(opts.fresh ? undefined : loadWalletFile(), { network: config.network });
  if (m.changed) {
    saveWalletFile(m.file);
    if (m.added.length === WALLET_ROLES.length) log(`generated ${m.added.length} wallets -> ${config.walletsFile}`);
    else if (m.added.length) log(`added roles ${m.added.join(", ")} -> ${config.walletsFile}`);
    for (const [from, to] of m.renamed) log(`renamed role ${from} -> ${to} (same account)`);
    if (m.retired.length) log(`retired roles ${m.retired.join(", ")} (kept under "retired")`);
  }
  const wallets = walletsFromFile(m.file);
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
