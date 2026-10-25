import { writeFile } from "node:fs/promises";
import { runEvaluation } from "../src/eval.ts";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const value = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
try {
  const mode = value("--mode") ?? "mock";
  if (mode !== "mock" && mode !== "live") throw new Error("--mode must be mock or live.");
  const result = await runEvaluation({ mode, repeat: value("--repeat") ? Number(value("--repeat")) : undefined, only: value("--only") });
  for (const row of result.rows) console.log(`${row.passed ? "PASS" : "MISMATCH"} ${row.key} #${row.repetition} ${row.actual} (${row.seconds}s) ${row.errors.join("; ")}`);
  console.log(`${result.rows.filter((row) => row.passed).length}/${result.rows.length} scenario runs matched; mode=${result.mode}; live stability requires 3 uncached matches per scenario.`);
  const path = value("--output");
  if (path) await writeFile(path, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  process.exitCode = result.passed ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Evaluation unavailable.");
  process.exitCode = 2;
}
