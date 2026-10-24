// Offline: v2 SPV signer list + local quorum check.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSignerQuorum, SPV_QUORUM, spvSignerEntries } from "../src/spv.ts";

const S = { platform: "rPlatform", builder: "rBuilder", inspector: "rInspector", trustee: "rTrustee" };
const list = { quorum: SPV_QUORUM, signers: spvSignerEntries(S).map((e) => ({ account: e.SignerEntry.Account, weight: e.SignerEntry.SignerWeight })) };

test("v2 list = platform, builder, inspector, trustee, weight 1 each, quorum 3", () => {
  assert.equal(SPV_QUORUM, 3);
  assert.deepEqual(list.signers, [
    { account: "rPlatform", weight: 1 },
    { account: "rBuilder", weight: 1 },
    { account: "rInspector", weight: 1 },
    { account: "rTrustee", weight: 1 },
  ]);
});

test("duplicate signer accounts rejected", () => {
  assert.throws(() => spvSignerEntries({ ...S, trustee: "rPlatform" }), /distinct/);
});

test("any 3 of 4 reach quorum, 2 do not, no single party can block", () => {
  const all = Object.values(S);
  for (const left of all) assert.equal(checkSignerQuorum(list, all.filter((a) => a !== left)).ok, true, `without ${left}`);
  const two = checkSignerQuorum(list, ["rPlatform", "rBuilder"]);
  assert.deepEqual(two, { ok: false, weight: 2, quorum: 3, unknown: [], duplicates: [] });
  assert.equal(checkSignerQuorum(list, all).ok, true);
});

test("AI key (not on the list) or a duplicate signature never counts", () => {
  const ai = checkSignerQuorum(list, ["rPlatform", "rBuilder", "rAiAgent"]);
  assert.equal(ai.ok, false);
  assert.deepEqual(ai.unknown, ["rAiAgent"]);
  const dup = checkSignerQuorum(list, ["rPlatform", "rPlatform", "rBuilder"]);
  assert.equal(dup.ok, false);
  assert.equal(dup.weight, 2);
  assert.deepEqual(dup.duplicates, ["rPlatform"]);
});
