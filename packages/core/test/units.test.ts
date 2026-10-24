import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Attestation } from "@xrlp/shared";
import {
  assertMilestoneTransition,
  assertProjectTransition,
  canMilestoneTransition,
  conditionFromFulfillment,
  DomainError,
  evaluateQuorum,
  FileStore,
  fromMicro,
  fulfillmentMatches,
  generateMilestoneCondition,
  isCondition,
  MemoryStore,
  splitByShares,
  toMicro,
} from "../src/index.ts";

const att = (role: Attestation["role"], signer: string, decision: Attestation["decision"] = "approve"): Attestation => ({
  milestoneId: "m",
  role,
  signer,
  decision,
  notes: "",
  at: "2026-10-25T00:00:00.000Z",
});

describe("state machine", () => {
  it("allows the documented milestone path", () => {
    const path = ["pending", "escrowed", "evidence_submitted", "ai_reviewed", "inspected", "released"] as const;
    for (let i = 1; i < path.length; i++) assert.ok(canMilestoneTransition(path[i - 1]!, path[i]!), `${path[i - 1]} -> ${path[i]}`);
    assert.ok(canMilestoneTransition("rejected", "evidence_submitted"), "resubmit after rejection");
    assert.ok(canMilestoneTransition("expired", "refunded"));
  });

  it("rejects illegal milestone transitions with a clear error", () => {
    assert.throws(
      () => assertMilestoneTransition("m1", "escrowed", "released"),
      (e: unknown) => e instanceof DomainError && e.code === "ILLEGAL_TRANSITION" && /escrowed -> released/.test(e.message),
    );
    assert.throws(() => assertMilestoneTransition("m1", "released", "refunded"), DomainError);
    assert.throws(() => assertMilestoneTransition("m1", "evidence_submitted", "inspected"), DomainError);
    assert.throws(() => assertMilestoneTransition("m1", "refunded", "escrowed"), DomainError);
  });

  it("enforces project order", () => {
    assertProjectTransition("p", "draft", "terms_locked");
    assert.throws(() => assertProjectTransition("p", "draft", "funding"), /draft -> funding/);
    assert.throws(() => assertProjectTransition("p", "completed", "repaying"), DomainError);
    assert.throws(() => assertProjectTransition("p", "funding", "escrowed"), DomainError);
  });
});

describe("quorum (inspector w2, AI w1, platform w1, quorum 3)", () => {
  it("inspector alone is not enough", () => {
    const q = evaluateQuorum([att("inspector", "rA")], 1);
    assert.equal(q.met, false);
    assert.equal(q.weight, 2);
    assert.match(q.missing.join(), /second inspector, AI pass, or platform/);
  });
  it("inspector + AI pass releases", () => assert.equal(evaluateQuorum([att("inspector", "rA"), att("ai_agent", "rAI")], 1).met, true));
  it("inspector + platform releases", () => assert.equal(evaluateQuorum([att("inspector", "rA"), att("platform", "rP")], 1).met, true));
  it("two inspectors release", () => assert.equal(evaluateQuorum([att("inspector", "rA"), att("inspector", "rB")], 1).met, true));
  it("AI + platform without an inspector never releases (platform can't move money alone)", () => {
    const q = evaluateQuorum([att("ai_agent", "rAI"), att("platform", "rP")], 1);
    assert.equal(q.met, false);
    assert.match(q.missing.join(), /inspector/);
  });
  it("policy requiring 2 inspectors is enforced even when weight >= 3", () => {
    assert.equal(evaluateQuorum([att("inspector", "rA"), att("ai_agent", "rAI"), att("platform", "rP")], 2).met, false);
    assert.equal(evaluateQuorum([att("inspector", "rA"), att("inspector", "rB")], 2).met, true);
  });
  it("any reject blocks", () => {
    const q = evaluateQuorum([att("inspector", "rA"), att("ai_agent", "rAI"), att("inspector", "rB", "reject")], 1);
    assert.equal(q.met, false);
    assert.equal(q.rejected, true);
  });
  it("same inspector twice counts once", () => assert.equal(evaluateQuorum([att("inspector", "rA"), att("inspector", "rA")], 1).met, false));
});

describe("money", () => {
  it("round-trips and formats", () => {
    assert.equal(fromMicro(toMicro("25000")), "25000.00");
    assert.equal(fromMicro(toMicro("0.123456")), "0.123456");
    assert.throws(() => toMicro("1.2345678"), DomainError);
    assert.throws(() => toMicro("-5"), DomainError);
  });
  it("splits by template shares and sums exactly", () => {
    const parts = splitByShares("120000.00", [0.25, 0.3, 0.2, 0.25]);
    assert.deepEqual(parts, ["30000.00", "36000.00", "24000.00", "30000.00"]);
    const odd = splitByShares("100000.01", [0.3, 0.4, 0.3]);
    assert.equal(odd.reduce((a, x) => a + toMicro(x), 0n), toMicro("100000.01"));
  });
});

describe("crypto-conditions", () => {
  it("generates matching PREIMAGE-SHA-256 condition/fulfillment", () => {
    const { condition, fulfillment } = generateMilestoneCondition();
    assert.ok(isCondition(condition));
    assert.equal(conditionFromFulfillment(fulfillment), condition);
    assert.ok(fulfillmentMatches(condition, fulfillment));
    assert.ok(!fulfillmentMatches(condition, generateMilestoneCondition().fulfillment));
    assert.ok(!fulfillmentMatches(condition, "garbage"));
  });
});

describe("stores", () => {
  for (const [name, make] of [
    ["MemoryStore", () => new MemoryStore()],
    ["FileStore", () => new FileStore(mkdtempSync(join(tmpdir(), "core-store-")))],
  ] as const) {
    it(`${name}: commits on success, discards on throw, reads are copies`, async () => {
      const s = make();
      await s.write((db) => db.inspectors.push({ address: "rA", name: "A", licenseNumber: "1", createdAt: "x" }));
      await assert.rejects(
        s.write((db) => {
          db.inspectors.push({ address: "rB", name: "B", licenseNumber: "2", createdAt: "x" });
          throw new Error("boom");
        }),
      );
      await s.read((db) => db.inspectors.push({ address: "rC", name: "C", licenseNumber: "3", createdAt: "x" }));
      assert.deepEqual(await s.read((db) => db.inspectors.map((i) => i.address)), ["rA"]);
    });
  }

  it("FileStore persists across instances, serializes concurrent writes, leaves no temp files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "core-store-"));
    const a = new FileStore(dir);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => a.write((db) => db.inspectors.push({ address: `r${i}`, name: "", licenseNumber: "", createdAt: "" }))),
    );
    const b = new FileStore(dir);
    assert.equal(await b.read((db) => db.inspectors.length), 20);
    assert.deepEqual(readdirSync(dir), ["core-db.json"]);
  });
});
