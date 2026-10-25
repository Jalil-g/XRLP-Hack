import type { VerifierMode } from "./types.ts";

export const DEFAULT_MODEL = "claude-opus-5-5";
/** Used when VERIFIER_PROVIDER=nova and VERIFIER_MODEL does not name a Nova model. */
export const NOVA_DEFAULT_MODEL = "global.amazon.nova-2-lite-v1:0";

export type VerifierProvider = "anthropic" | "bedrock" | "nova";
export function resolveProvider(env: Record<string, string | undefined> = process.env): VerifierProvider {
  const value = env.VERIFIER_PROVIDER?.trim().toLowerCase() || "anthropic";
  if (value !== "anthropic" && value !== "bedrock" && value !== "nova") throw new Error("VERIFIER_PROVIDER must be anthropic, bedrock or nova.");
  return value;
}

export function liveCredentialsAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return !!(resolveProvider(env) === "anthropic" ? env.ANTHROPIC_API_KEY : env.AWS_BEARER_TOKEN_BEDROCK);
}

export function resolveMode(override?: VerifierMode): VerifierMode {
  if (override) return override;
  const env = (process.env.VERIFIER_MODE ?? "mock").trim().toLowerCase();
  return env === "live" ? "live" : "mock";
}

export function resolveModel(override?: string): string {
  const model = override ?? (process.env.VERIFIER_MODEL?.trim() || DEFAULT_MODEL);
  const provider = resolveProvider();
  if (provider === "nova") return model.includes("nova") ? model : NOVA_DEFAULT_MODEL;
  return provider === "bedrock" && !model.startsWith("anthropic.") ? `anthropic.${model}` : model;
}

export function resolveDataDir(override?: string): string {
  return override ?? process.env.DATA_DIR ?? ".data";
}
