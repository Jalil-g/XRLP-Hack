// Offline: wallet-file migration + RLUSD plan (no devnet).
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { config } from "../src/config.ts";
import {
  credentialPlan,
  DEFAULT_PLATFORM_RLUSD,
  migrateWalletFile,
  NO_KYC_ROLES,
  platformRlusdFor,
  RLUSD_HOLDERS,
  rlusdTopUpPlan,
  loadWalletFile,
  saveWalletFile,
  WALLET_ROLES,
  type StoredWallet,
  type WalletFile,
} from "../src/wallets.ts";

let n = 0;
const gen = (): StoredWallet => ({ address: `rGEN${++n}`, seed: `sGEN${n}` });
const sw = (tag: string): StoredWallet => ({ address: `r${tag}`, seed: `s${tag}` });
const NOW = () => new Date("2026-10-24T12:00:00.000Z");

/** A v1 wallet file (inspectorA/inspectorB, no releaseService/trustee/inspector1..3). */
function v1File(): WalletFile {
  const wallets: Record<string, StoredWallet> = {};
  for (const r of ["issuer", "platform", "builder", "investor1", "investor2", "investor3", "inspectorA", "inspectorB", "aiAgent"]) wallets[r] = sw(r);
  return { network: "devnet", createdAt: "2026-10-23T00:00:00.000Z", wallets: wallets as WalletFile["wallets"], spvs: { p1: sw("spv1") } };
}

test("no file -> every role generated", () => {
  const m = migrateWalletFile(undefined, { network: "devnet", generate: gen, now: NOW });
  assert.equal(m.changed, true);
  assert.deepEqual(m.added, [...WALLET_ROLES]);
  assert.deepEqual(Object.keys(m.file.wallets), [...WALLET_ROLES]);
  assert.equal(m.file.createdAt, "2026-10-24T12:00:00.000Z");
  assert.deepEqual(m.file.spvs, {});
  assert.equal(new Set(Object.values(m.file.wallets).map((w) => w.address)).size, WALLET_ROLES.length);
});

test("v1 file -> inspectorA/B renamed, only new roles generated, existing wallets + spvs untouched", () => {
  const before = v1File();
  const m = migrateWalletFile(before, { network: "devnet", generate: gen });
  assert.equal(m.changed, true);
  assert.deepEqual(m.renamed, [["inspectorA", "inspector1"], ["inspectorB", "inspector2"]]);
  assert.deepEqual(m.added, ["releaseService", "inspector3", "trustee"]);
  assert.deepEqual(m.retired, []);
  assert.deepEqual(m.file.wallets.inspector1, sw("inspectorA"));
  assert.deepEqual(m.file.wallets.inspector2, sw("inspectorB"));
  for (const r of ["issuer", "platform", "builder", "investor1", "investor2", "investor3", "aiAgent"] as const) assert.deepEqual(m.file.wallets[r], sw(r));
  assert.equal("inspectorA" in m.file.wallets, false);
  assert.deepEqual(m.file.spvs, { p1: sw("spv1") });
  assert.equal(m.file.createdAt, before.createdAt);
  assert.deepEqual(before.wallets, v1File().wallets, "input not mutated");
});

test("migrated file is a fixed point (second run changes nothing)", () => {
  const once = migrateWalletFile(v1File(), { network: "devnet", generate: gen }).file;
  const twice = migrateWalletFile(once, { network: "devnet", generate: () => assert.fail("must not generate") });
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.added, []);
  assert.deepEqual(twice.file, once);
});

test("legacy role whose v2 slot is taken is retired, not lost", () => {
  const f = v1File();
  (f.wallets as Record<string, StoredWallet>).inspector1 = sw("i1");
  (f.wallets as Record<string, StoredWallet>).oldRole = sw("old");
  const m = migrateWalletFile(f, { network: "devnet", generate: gen });
  assert.deepEqual(m.file.wallets.inspector1, sw("i1"));
  assert.deepEqual(m.file.wallets.inspector2, sw("inspectorB"));
  assert.deepEqual(m.retired.sort(), ["inspectorA", "oldRole"]);
  assert.deepEqual(m.file.retired, { inspectorA: sw("inspectorA"), oldRole: sw("old") });
  // re-run keeps retired as is
  const again = migrateWalletFile(m.file, { network: "devnet", generate: gen });
  assert.equal(again.changed, false);
  assert.deepEqual(again.file.retired, m.file.retired);
});

test("a role entry without a seed is regenerated", () => {
  const f = migrateWalletFile(undefined, { network: "devnet", generate: gen }).file;
  (f.wallets as Record<string, unknown>).trustee = { address: "rBROKEN" };
  const m = migrateWalletFile(f, { network: "devnet", generate: () => sw("newTrustee") });
  assert.deepEqual(m.added, ["trustee"]);
  assert.deepEqual(m.file.wallets.trustee, sw("newTrustee"));
});

test("network mismatch throws", () => {
  assert.throws(() => migrateWalletFile({ ...v1File(), network: "testnet" }, { network: "devnet" }), /testnet/);
});

test("RLUSD plan: investors 50k, platform 25k, builder >= 250 (fee); all targets are trust-line holders", () => {
  const plan = rlusdTopUpPlan();
  assert.deepEqual(plan, [
    { role: "investor1", target: 50_000 },
    { role: "investor2", target: 50_000 },
    { role: "investor3", target: 50_000 },
    { role: "platform", target: 25_000 },
    { role: "builder", target: 1_000 },
  ]);
  for (const t of plan) assert.ok((RLUSD_HOLDERS as readonly string[]).includes(t.role));
  assert.ok(plan.find((t) => t.role === "builder")!.target >= 250);
  assert.deepEqual(rlusdTopUpPlan({ investorRlusd: 1, platformRlusd: 2, builderRlusd: 3 }).map((t) => t.target), [1, 1, 1, 2, 3]);
  assert.equal((RLUSD_HOLDERS as readonly string[]).includes("issuer"), false);
});

test("credential plan: KYC investor1/2 (never investor3), VERIFIED_INSPECTOR x3, builder only when pre-verified", () => {
  const plan = credentialPlan().map((g) => `${g.role}:${g.type}`);
  assert.deepEqual(plan, [
    "investor1:KYC_INVESTOR",
    "investor2:KYC_INVESTOR",
    "inspector1:VERIFIED_INSPECTOR",
    "inspector2:VERIFIED_INSPECTOR",
    "inspector3:VERIFIED_INSPECTOR",
  ]);
  assert.deepEqual([...NO_KYC_ROLES], ["investor3"]);
  for (const r of NO_KYC_ROLES) assert.equal(credentialPlan({ preVerifyBuilder: true }).some((g) => g.role === r), false, `${r} must stay uncredentialed (tecNO_AUTH beat)`);
  assert.equal(plan.some((g) => g.startsWith("builder:")), false, "VERIFIED_BUILDER is earned, not pre-issued");
  assert.deepEqual(credentialPlan({ preVerifyBuilder: true }).at(-1), { role: "builder", type: "VERIFIED_BUILDER" });
});

test("platform RLUSD budget: default covers 3 concurrent demo projects (prestage A/B/C), sized via platformRlusdFor", () => {
  const demo = (principal: string) => ({ principal, interestRateBps: 1000, termDays: 30, paymentIntervalDays: 15 });
  // one 30k project: cover 3 328 (10% of principal+interest, +10% headroom) + 10% slack -> 4 000
  assert.equal(platformRlusdFor([demo("30000")]), 4_000);
  assert.equal(platformRlusdFor([demo("30000"), demo("30000"), demo("30000")]), 11_000);
  // all 150k of investor money across 3 projects fits the default with room to spare
  assert.ok(platformRlusdFor([demo("50000"), demo("50000"), demo("50000")]) <= DEFAULT_PLATFORM_RLUSD);
  assert.ok(platformRlusdFor([demo("68000"), demo("68000"), demo("68000")]) <= DEFAULT_PLATFORM_RLUSD);
  assert.ok(platformRlusdFor([demo("70000"), demo("70000"), demo("70000")]) > DEFAULT_PLATFORM_RLUSD);
  assert.equal(platformRlusdFor([]), 0);
  assert.equal(rlusdTopUpPlan().find((t) => t.role === "platform")!.target, DEFAULT_PLATFORM_RLUSD);
});

test("M7: saveWalletFile writes atomically, owner-only (0600 even over an existing 0644 file), no temp file left", () => {
  const dir = mkdtempSync(join(tmpdir(), "xrlp-wallets-"));
  const prev = config.walletsFile;
  config.walletsFile = join(dir, "wallets.json");
  try {
    writeFileSync(config.walletsFile, "{}", { mode: 0o644 });
    const file = migrateWalletFile(undefined, { network: "devnet" }).file;
    saveWalletFile(file);
    assert.equal(statSync(config.walletsFile).mode & 0o777, 0o600);
    assert.deepEqual(loadWalletFile(), file);
    assert.deepEqual(readdirSync(dir), ["wallets.json"], "temp file renamed away");
  } finally {
    config.walletsFile = prev;
  }
});
