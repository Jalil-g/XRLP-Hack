// Runtime configuration (env + repo paths). Devnet only.
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

// ---------------------------------------------------------------- mainnet guard (security review M1)

/** `server_info.network_id` of the XRPL devnet. Mainnet is 0, testnet 1 (Vault + Lending aren't enabled there). */
export const DEVNET_NETWORK_ID = 2;

/** Hosts / labels that are never devnet: mainnet (Ripple, community clusters) and testnet. A fast check before connecting. */
const NOT_DEVNET_URL = /mainnet|testnet|altnet|xrplcluster|xrpl\.ws|xrpl\.link|ripple\.com/i;
const NOT_DEVNET_LABEL = /^(main|mainnet|livenet|production|test|testnet|altnet)$/i;

/** Throws unless the configured endpoint and network label could be devnet. Pure. */
export function assertDevnetEndpoint(c: { wsUrl: string; network: string }): void {
  if (NOT_DEVNET_URL.test(c.wsUrl) || NOT_DEVNET_LABEL.test(c.network.trim())) {
    throw new Error(`Refusing to run against ${c.wsUrl} (XRPL_NETWORK=${c.network}): devnet only (never mainnet; Vault/Lending are not on testnet).`);
  }
}

/**
 * Throws unless the connected server reports the expected `network_id`: devnet's 2, or `XRPL_NETWORK_ID` for another
 * custom network (≥ 2). Mainnet (0 / absent) and testnet (1) are never accepted, whatever the URL says. Pure.
 */
export function assertDevnetNetworkId(reported: unknown, env: Record<string, string | undefined> = process.env, wsUrl = config.wsUrl): void {
  const want = env.XRPL_NETWORK_ID ? Number(env.XRPL_NETWORK_ID) : DEVNET_NETWORK_ID;
  if (!Number.isInteger(want) || want < 2) throw new Error(`XRPL_NETWORK_ID must be an integer >= 2 (0 = mainnet and 1 = testnet are never allowed), got ${env.XRPL_NETWORK_ID}`);
  if (reported !== want) {
    throw new Error(`Refusing to use ${wsUrl}: it reports network_id ${reported === undefined ? "(none: mainnet?)" : JSON.stringify(reported)}, expected ${want} (devnet). Devnet only.`);
  }
}

assertDevnetEndpoint(config);

// ---------------------------------------------------------------- secret paths (security review L2)

/**
 * Why `path` must not hold secrets (seeds, run records): it is inside the repo (PUBLIC) but not covered by .gitignore,
 * which ignores `.data/` directories and files named exactly `wallets.json`. `undefined` = fine (outside the repo, or
 * ignored). Pure.
 */
export function secretPathProblem(path: string, kind: "file" | "dir", repoRoot = REPO_ROOT): string | undefined {
  const rel = relative(repoRoot, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  if (rel.split(sep).includes(".data")) return undefined;
  if (kind === "file" && basename(path) === "wallets.json") return undefined;
  return `${path} is inside the repo but not git-ignored (only .data/ directories and files named wallets.json are); the repo is PUBLIC. Use e.g. .data/wallets.<you>.json`;
}

/** Throws if `path` would put secrets in a tracked location (see secretPathProblem). Returns `path`. */
export function assertSecretPath(path: string, kind: "file" | "dir", what: string): string {
  const problem = secretPathProblem(path, kind);
  if (problem) throw new Error(`${what}: ${problem}`);
  return path;
}

assertSecretPath(config.walletsFile, "file", "WALLETS_FILE");
assertSecretPath(config.dataDir, "dir", "DATA_DIR");

/** Mock RLUSD: 40-char hex currency code for "RLUSD". */
export const RLUSD_CURRENCY = "524C555344000000000000000000000000000000";
