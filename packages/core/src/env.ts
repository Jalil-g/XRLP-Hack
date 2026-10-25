// CORE-09. Core's environment: load the repo-root .env (never overriding the shell), then validate everything core reads at
// boot and report every problem at once. Secrets are never printed; the boot summary names modes only.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

type Env = Record<string, string | undefined>;

export function findRepoRoot(from = dirname(fileURLToPath(import.meta.url))): string | undefined {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/** Sets each key of `file` that `env` doesn't already have (shell wins). Returns the keys it set (names only). */
export function loadEnvFile(file: string, env: Env = process.env): string[] {
  if (!existsSync(file)) return [];
  const parsed = parseEnv(readFileSync(file, "utf8"));
  const set: string[] = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (env[k] !== undefined) continue;
    env[k] = v;
    set.push(k);
  }
  return set;
}

/** .env.example placeholders count as unset. */
export const isPlaceholder = (v: string | undefined) => !v || v.includes("REPLACE_ME");

/** RELEASE_KEY (RELEASE_VAULT_KEY is the older name) or undefined -> FilePreimageVault generates DATA_DIR/release-vault.key. */
export function releaseKeyFromEnv(env: Env): string | undefined {
  const v = env.RELEASE_KEY ?? env.RELEASE_VAULT_KEY;
  return isPlaceholder(v) ? undefined : v!.trim();
}

const oneOf = (env: Env, key: string, allowed: readonly string[], fallback: string, problems: string[]): string => {
  const v = (env[key] ?? fallback).trim().toLowerCase();
  if (!allowed.includes(v)) problems.push(`${key}="${env[key]}" must be one of ${allowed.join(" | ")}`);
  return v;
};

export interface CoreEnvReport {
  problems: string[];
  warnings: string[];
  /** One line, no secrets. */
  summary: string;
}

export function validateCoreEnv(env: Env): CoreEnvReport {
  const problems: string[] = [];
  const warnings: string[] = [];

  const ledger = oneOf(env, "LEDGER_MODE", ["fake", "devnet"], "fake", problems);
  const vmode = oneOf(env, "VERIFIER_MODE", ["mock", "live"], "mock", problems);
  const provider = oneOf(env, "VERIFIER_PROVIDER", ["anthropic", "bedrock", "nova"], "anthropic", problems);
  if (env.CORE_VERIFIER !== undefined) oneOf(env, "CORE_VERIFIER", ["fake", "verifier"], "fake", problems);
  const keeper = oneOf(env, "KEEPER", ["0", "1", "true", "false"], "0", problems);

  if (env.PORT !== undefined) {
    const port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push(`PORT="${env.PORT}" must be an integer 1-65535`);
  }

  const releaseKey = releaseKeyFromEnv(env);
  if (releaseKey && !/^[0-9a-fA-F]{64}$/.test(releaseKey))
    problems.push("RELEASE_KEY must be 64 hex chars (openssl rand -hex 32)");
  if (!releaseKey && ledger === "devnet")
    warnings.push("RELEASE_KEY unset: the release service generates DATA_DIR/release-vault.key (fine for a demo; don't delete it mid-demo)");

  const usesVerifier = env.CORE_VERIFIER === "verifier" || (env.CORE_VERIFIER === undefined && vmode === "live");
  if (usesVerifier && vmode === "live") {
    if (provider === "anthropic" && isPlaceholder(env.ANTHROPIC_API_KEY))
      problems.push("VERIFIER_MODE=live with VERIFIER_PROVIDER=anthropic needs ANTHROPIC_API_KEY (set it in .env)");
    if ((provider === "bedrock" || provider === "nova") && !env.AWS_REGION) problems.push(`VERIFIER_PROVIDER=${provider} needs AWS_REGION (and AWS_BEARER_TOKEN_BEDROCK)`);
  }

  if (ledger === "devnet") {
    const network = env.XRPL_NETWORK ?? "devnet";
    if (network !== "devnet") problems.push(`LEDGER_MODE=devnet needs XRPL_NETWORK=devnet, got "${network}" (Vault/Loan are devnet-only)`);
    if (/mainnet|s1\.ripple\.com|s2\.ripple\.com|xrplcluster/i.test(env.XRPL_WS_URL ?? "")) problems.push(`XRPL_WS_URL points at mainnet: ${env.XRPL_WS_URL}`);
  }

  const cancel = env.DEMO_CANCEL_AFTER_S?.trim();
  if (cancel && cancel.split(",").some((x) => !/^\d+$/.test(x.trim()) || Number(x) <= 0))
    problems.push(`DEMO_CANCEL_AFTER_S="${cancel}" must be comma-separated positive integers (seconds)`);

  const verifier = usesVerifier ? `verifier/${vmode}/${provider}` : vmode === "live" ? "fake (CORE_VERIFIER=fake)" : "fake";
  const summary = `ledger=${ledger} verifier=${verifier} keeper=${keeper === "1" || keeper === "true" ? "on" : "off"} release-key=${releaseKey ? "env" : "file"}`;
  return { problems, warnings, summary };
}
