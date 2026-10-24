import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "xrpl";
import {
  SoftwareSigner,
  conditionFromPreimage,
  createReleaseCondition,
  recoverFulfillment,
  memoryPreimageStore,
  derivePreimage,
} from "../src/index.ts";

test("empty preimage matches the XRPL docs vector", async () => {
  const s = await conditionFromPreimage("");
  assert.equal(s.fulfillment, "A0028000");
  assert.equal(s.condition, "A0258020E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855810100");
});

test("32-byte preimage encodes cost 32", async () => {
  const s = await conditionFromPreimage("11".repeat(32));
  assert.match(s.fulfillment, /^A0228020(11){32}$/);
  assert.match(s.condition, /^A0258020[0-9A-F]{64}810120$/);
});

test("device-style derivation is deterministic per signer+milestone and never stores the preimage", async () => {
  const signer = new SoftwareSigner(Wallet.generate());
  const a = await derivePreimage(signer, "p1/m1");
  assert.equal((await derivePreimage(signer, "p1/m1")).preimage, a.preimage);
  assert.notEqual((await derivePreimage(signer, "p1/m2")).preimage, a.preimage);

  const store = memoryPreimageStore();
  const cond = await createReleaseCondition(store, "p1/m1", { source: "device", signer });
  assert.equal(cond, a.condition);
  assert.equal((await store.get("p1/m1"))?.preimage, undefined);
  assert.equal(await recoverFulfillment(store, "p1/m1", signer), a.fulfillment);
  await assert.rejects(recoverFulfillment(store, "p1/m1", new SoftwareSigner(Wallet.generate())), /does not match/);
});

test("random secret round-trips through the store", async () => {
  const store = memoryPreimageStore();
  const cond = await createReleaseCondition(store, "m9", { source: "random" });
  const ful = await recoverFulfillment(store, "m9");
  assert.equal((await conditionFromPreimage(ful.slice(8))).condition, cond);
});
