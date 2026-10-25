import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CheckResult, Verdict } from "@xrlp/shared";
import { FIXTURES_DIR, SCENARIOS } from "../fixtures/scenarios.ts";
import { projectInput } from "../fixtures/project-scenarios.ts";
import { verdictHash } from "./hash.ts";
import { verifyMilestone } from "./verifyMilestone.ts";
import { verifyProject } from "./verifyProject.ts";
import type { VerifierMode } from "./types.ts";

const Expectation = z.object({ key: z.string(), expect: z.enum(["pass", "fail", "needs_human"]), failingChecks: z.array(z.string()), warnChecks: z.array(z.string()).default([]) });
export type EvalExpectation = z.infer<typeof Expectation>;
export interface EvalRow {
  key: string; repetition: number; mode: VerifierMode; expected: string; actual: string;
  passed: boolean; errors: string[]; seconds: number; model: string; hash?: string;
}

export function expectationErrors(expectation: EvalExpectation, actual: { decision: string; checks: CheckResult[] }): string[] {
  const errors: string[] = [];
  if (actual.decision !== expectation.expect) errors.push(`decision ${actual.decision}, expected ${expectation.expect}`);
  for (const [names, expected] of [[expectation.failingChecks, "fail"], [expectation.warnChecks, "warn"]] as const) {
    for (const check of names) if (actual.checks.find((c) => c.check === check)?.result !== expected) errors.push(`${check} must be ${expected}`);
  }
  return errors;
}

async function manifests(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isDirectory()) result.push(...await manifests(join(directory, item.name)));
    else if (item.name === "manifest.json") result.push(join(directory, item.name));
  }
  return result.sort();
}

/** Serial, cache-disabled live eval. A repeat is an independent model request, never a cache hit. */
export async function runEvaluation(options: { mode?: VerifierMode; repeat?: number; only?: string } = {}) {
  const mode = options.mode ?? "mock";
  const repeat = options.repeat ?? (mode === "live" ? 3 : 1);
  if (!["mock", "live"].includes(mode) || !Number.isInteger(repeat) || repeat < 1 || repeat > 3) throw new Error("Use mock/live and repeat 1..3.");
  if (mode === "live" && !process.env.ANTHROPIC_API_KEY) throw new Error("Live evaluation requires ANTHROPIC_API_KEY; no live result was measured.");
  const expectations: EvalExpectation[] = [];
  for (const file of await manifests(FIXTURES_DIR)) {
    const manifest = z.object({ scenarios: z.array(Expectation) }).parse(JSON.parse(await readFile(file, "utf8")));
    expectations.push(...manifest.scenarios);
  }
  const selected = expectations.filter((e) => !options.only || e.key === options.only);
  if (!selected.length) throw new Error("No matching manifest scenarios.");
  if (new Set(selected.map((e) => e.key)).size !== selected.length) throw new Error("Duplicate manifest scenario keys.");
  const rows: EvalRow[] = [];
  for (const expectation of selected) for (let repetition = 1; repetition <= repeat; repetition++) {
    const start = performance.now();
    try {
      let decision: string, checks: CheckResult[], model: string, hash: string | undefined;
      if (expectation.key.startsWith("project-")) {
        const result = await verifyProject({ ...projectInput(expectation.key), mode });
        decision = result.decision; checks = [...result.identity, ...result.feasibility, ...result.capability]; model = result.model;
      } else {
        const scenario = SCENARIOS.find((s) => s.key === expectation.key);
        if (!scenario) throw new Error("No fixture input builder for manifest scenario.");
        const result: Verdict = await verifyMilestone({ ...(await scenario.input()), mode }, { cacheDir: false });
        decision = result.decision; checks = result.checks; model = result.model; hash = verdictHash(result);
      }
      const errors = expectationErrors(expectation, { decision, checks });
      rows.push({ key: expectation.key, repetition, mode, expected: expectation.expect, actual: decision, passed: !errors.length, errors, seconds: Math.round((performance.now() - start) / 10) / 100, model, ...(hash ? { hash } : {}) });
    } catch {
      rows.push({ key: expectation.key, repetition, mode, expected: expectation.expect, actual: "error", passed: false, errors: ["Evaluation threw; scenario not verified."], seconds: Math.round((performance.now() - start) / 10) / 100, model: "unavailable" });
    }
  }
  return { mode, repeat, liveCallsRequested: mode === "live" ? rows.length : 0, passed: rows.every((row) => row.passed), rows };
}
