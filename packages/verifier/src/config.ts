import type { VerifierMode } from "./types.ts";

export const DEFAULT_MODEL = "claude-opus-5-5";

export type VerifierProvider = "anthropic" | "bedrock";
export function resolveProvider(env: Record<string, string | undefined> = process.env): VerifierProvider {
  const value = env.VERIFIER_PROVIDER?.trim().toLowerCase() || "anthropic";
  if (value !== "anthropic" && value !== "bedrock") throw new Error("VERIFIER_PROVIDER must be anthropic or bedrock.");
  return value;
}

export function liveCredentialsAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return !!(resolveProvider(env) === "bedrock" ? env.AWS_BEARER_TOKEN_BEDROCK : env.ANTHROPIC_API_KEY);
}

export function resolveMode(override?: VerifierMode): VerifierMode {
  if (override) return override;
  const env = (process.env.VERIFIER_MODE ?? "mock").trim().toLowerCase();
  return env === "live" ? "live" : "mock";
}

export function resolveModel(override?: string): string {
  const model = override ?? (process.env.VERIFIER_MODEL?.trim() || DEFAULT_MODEL);
  return resolveProvider() === "bedrock" && !model.startsWith("anthropic.") ? `anthropic.${model}` : model;
}

export function resolveDataDir(override?: string): string {
  return override ?? process.env.DATA_DIR ?? ".data";
}
