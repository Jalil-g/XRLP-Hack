// Runs the verifier on every fixture scenario and pretty-prints the verdicts.
//   pnpm --filter @xrlp/verifier demo            (mock mode, no key needed)
//   VERIFIER_MODE=live pnpm --filter @xrlp/verifier demo   (calls Claude)
//   pnpm --filter @xrlp/verifier demo -- --json  (raw Verdict JSON)
import { policyFor, resolveMode, resolveModel, verifyBuilder, verifyMilestoneDetailed } from "../src/index.ts";
import { builder, builderOnboardingInput, project, SCENARIOS } from "../fixtures/scenarios.ts";

const json = process.argv.includes("--json");
const only = process.argv.find((a) => /^[A-Z]$/.test(a));
const tty = process.stdout.isTTY;
const c = (code: number, s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const ICON = { pass: c(32, "✔ PASS"), fail: c(31, "✘ FAIL"), needs_human: c(33, "◆ NEEDS HUMAN") } as const;
const RES = { pass: c(32, "pass"), fail: c(31, "FAIL"), warn: c(33, "warn"), skipped: c(90, "skip") } as const;

const mode = resolveMode();
console.log(c(1, `\nXRLP evidence verifier — mode: ${mode}${mode === "live" ? ` (${resolveModel()})` : " (deterministic checks are real; LLM checks are canned)"}`));
console.log(c(90, "The AI checks that evidence is CONSISTENT (place, time, originality, paperwork, budget). A human inspector checks QUALITY.\n"));

let mismatches = 0;
for (const s of SCENARIOS.filter((x) => !only || x.key === only)) {
  if (s.pending) {
    console.log(`[${s.key}] PENDING ${s.pending}: ${s.title}`);
    continue;
  }
  const { verdict, checks } = await verifyMilestoneDetailed(await s.input());
  if (json) {
    console.log(JSON.stringify(verdict, null, 2));
    continue;
  }
  const ok = verdict.decision === s.expect;
  if (!ok) mismatches++;
  console.log(c(1, `[${s.key}] ${s.title}`));
  console.log(`    ${ICON[verdict.decision]}  confidence ${verdict.confidence}  ·  inspectors required: ${verdict.policy.requiredInspectors}  ·  model: ${verdict.model}${ok ? "" : c(31, `  (expected ${s.expect}!)`)}`);
  for (const ch of checks) {
    const esc = ch.escalation === "none" || ch.escalation === "ignore" ? "" : c(90, ` → ${ch.escalation}`);
    console.log(`    ${RES[ch.result].padEnd(tty ? 13 : 4)} ${ch.check.padEnd(29)} ${c(90, ch.reason)}${esc}`);
  }
  console.log(`    ${c(1, "Summary:")} ${verdict.summary}\n`);
}

if (!json && !only) {
  const b = await verifyBuilder(await builderOnboardingInput());
  console.log(c(1, `[Builder onboarding] ${builder.name}`));
  console.log(`    ${ICON[b.decision]}  suggested tier: ${b.suggestedRiskTier}  ·  registry is mock: ${b.registryIsMock}`);
  for (const ch of b.checks) console.log(`    ${RES[ch.result].padEnd(tty ? 13 : 4)} ${ch.check.padEnd(29)} ${c(90, ch.reason)}`);

  console.log(c(1, "\n[Policy matrix] how strictness varies (same project, different builder tier / amount)"));
  for (const tier of ["low", "medium", "high"] as const) {
    for (const amount of ["25000.00", "60000.00"]) {
      const p = policyFor(project, { ...builder, riskTier: tier }, { ...project.milestones[0]!, amount });
      const t = p.thresholds;
      console.log(
        `    tier=${tier.padEnd(6)} amount=${amount.padStart(9)}  inspectors=${p.requiredInspectors}  gps→${p.checks.gps_within_site.onFail.padEnd(11)} ` +
          `invoice −${t.invoiceUnderTolerancePct}%  maxAge=${t.maxPhotoAgeDays}d  phash≤${t.phashFailDistance}  minAIconf=${t.minLlmConfidence}`,
      );
    }
  }
  console.log(mismatches ? c(31, `\n${mismatches} scenario(s) did not match expectations.`) : c(32, "\nAll scenarios produced the expected decision."));
}
process.exitCode = mismatches ? 1 : 0;
