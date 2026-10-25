// CORE-09: .env loading (shell wins) + boot validation. .env.example must boot as-is and document every var core reads.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseEnv } from "node:util";
import { findRepoRoot, loadEnvFile, releaseKeyFromEnv, validateCoreEnv } from "../src/env.ts";

const ROOT = findRepoRoot()!;
const example = () => parseEnv(readFileSync(join(ROOT, ".env.example"), "utf8")) as Record<string, string>;
const KEY64 = "ab".repeat(32);

describe("loadEnvFile", () => {
  it("sets missing keys only; the shell wins; returns names; missing file is a no-op", () => {
    const dir = mkdtempSync(join(tmpdir(), "core-env-"));
    const file = join(dir, ".env");
    writeFileSync(file, "LEDGER_MODE=devnet # inline comment\nKEEPER=1\nQUOTED=\"a b\"\n");
    const env: Record<string, string | undefined> = { LEDGER_MODE: "fake" };
    assert.deepEqual(loadEnvFile(file, env).sort(), ["KEEPER", "QUOTED"]);
    assert.deepEqual(env, { LEDGER_MODE: "fake", KEEPER: "1", QUOTED: "a b" });
    assert.deepEqual(loadEnvFile(join(dir, "nope"), env), []);
  });
});

describe("validateCoreEnv", () => {
  it(".env.example boots as-is (placeholders count as unset)", () => {
    const r = validateCoreEnv(example());
    assert.deepEqual(r.problems, []);
    assert.equal(r.summary, "ledger=fake verifier=fake keeper=off release-key=file");
    assert.equal(releaseKeyFromEnv(example()), undefined);
  });

  it("collects every problem at once", () => {
    const r = validateCoreEnv({ LEDGER_MODE: "mainnet", VERIFIER_MODE: "real", KEEPER: "yes", PORT: "99999", RELEASE_KEY: "short", DEMO_CANCEL_AFTER_S: "60,x" });
    assert.equal(r.problems.length, 6, r.problems.join("\n"));
  });

  it("live verifier needs a real key (anthropic) or AWS_REGION (bedrock); mock needs nothing", () => {
    assert.match(validateCoreEnv({ VERIFIER_MODE: "live", ANTHROPIC_API_KEY: "sk-ant-REPLACE_ME" }).problems.join(), /ANTHROPIC_API_KEY/);
    assert.deepEqual(validateCoreEnv({ VERIFIER_MODE: "live", ANTHROPIC_API_KEY: "sk-ant-real" }).problems, []);
    assert.match(validateCoreEnv({ VERIFIER_MODE: "live", VERIFIER_PROVIDER: "bedrock" }).problems.join(), /AWS_REGION/);
    assert.match(validateCoreEnv({ VERIFIER_MODE: "live", VERIFIER_PROVIDER: "nova" }).problems.join(), /AWS_REGION/);
    assert.deepEqual(validateCoreEnv({ VERIFIER_MODE: "live", CORE_VERIFIER: "fake" }).problems, [], "CORE_VERIFIER=fake wins");
    assert.match(validateCoreEnv({ VERIFIER_MODE: "live", ANTHROPIC_API_KEY: "k" }).summary, /verifier=verifier\/live\/anthropic/);
  });

  it("devnet: XRPL_NETWORK must be devnet, never a mainnet URL; RELEASE_KEY from either name", () => {
    assert.match(validateCoreEnv({ LEDGER_MODE: "devnet", XRPL_NETWORK: "testnet" }).problems.join(), /devnet-only/);
    assert.match(validateCoreEnv({ LEDGER_MODE: "devnet", XRPL_WS_URL: "wss://xrplcluster.com" }).problems.join(), /mainnet/);
    const ok = validateCoreEnv({ LEDGER_MODE: "devnet", RELEASE_KEY: KEY64 });
    assert.deepEqual([ok.problems, ok.warnings], [[], []]);
    assert.match(validateCoreEnv({ LEDGER_MODE: "devnet" }).warnings.join(), /release-vault\.key/);
    assert.equal(releaseKeyFromEnv({ RELEASE_VAULT_KEY: KEY64 }), KEY64);
  });

  it("every env var core's src reads is documented in .env.example", () => {
    const documented = readFileSync(join(ROOT, ".env.example"), "utf8");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".ts") ? [join(dir, f)] : []));
    const used = new Set<string>();
    for (const f of files(join(ROOT, "packages/core/src")))
      for (const m of readFileSync(f, "utf8").matchAll(/env\??\.([A-Z][A-Z0-9_]*)/g)) used.add(m[1]!);
    const legacy = new Set(["RELEASE_VAULT_KEY"]);
    const missing = [...used].filter((k) => !legacy.has(k) && !new RegExp(`^#?\\s*${k}=`, "m").test(documented));
    assert.deepEqual(missing, []);
  });
});
