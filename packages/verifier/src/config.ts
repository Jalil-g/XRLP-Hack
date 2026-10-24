import type { VerifierMode } from "./types.ts";

export const DEFAULT_MODEL = "claude-opus-5-5";

export function resolveMode(override?: VerifierMode): VerifierMode {
  if (override) return override;
  const env = (process.env.VERIFIER_MODE ?? "mock").trim().toLowerCase();
  return env === "live" ? "live" : "mock";
}

export function resolveModel(override?: string): string {
  return override ?? process.env.VERIFIER_MODEL?.trim() ?? DEFAULT_MODEL;
}

export function resolveDataDir(override?: string): string {
  return override ?? process.env.DATA_DIR ?? ".data";
}
