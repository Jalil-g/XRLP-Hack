import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { expectationErrors, runEvaluation } from "../src/eval.ts";

test("recursive manifest eval exercises milestones, projects and adversarial fixtures through real mock paths", async () => {
  const report = await runEvaluation({ mode: "mock", repeat: 2 });
  assert.equal(report.passed, true, JSON.stringify(report.rows.filter((row) => !row.passed)));
  assert.equal(report.rows.length, 28);
  assert.equal(report.liveCallsRequested, 0);
  for (const key of ["A", "B", "C", "D", "E", "project-pass", "project-expired-insurance", "project-over-market"]) assert.equal(report.rows.filter((row) => row.key === key).length, 2);
});

test("missing or wrong failing/warning checks and decision mismatches cannot score green", () => {
  const expected = { key: "test", expect: "fail" as const, failingChecks: ["gate"], warnChecks: ["other"] };
  assert.equal(expectationErrors(expected, { decision: "pass", checks: [] }).length, 3);
});

test("live CLI without credentials exits before any requested calls", () => {
  const env = { ...process.env }; delete env.ANTHROPIC_API_KEY;
  const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/eval.ts", "--mode", "live", "--only", "A"], { cwd: new URL("..", import.meta.url), env, encoding: "utf8" });
  assert.equal(child.status, 2);
  assert.match(child.stderr, /no live result was measured/);
});
