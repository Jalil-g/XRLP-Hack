import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDirectory } from "../lib/directory.ts";
import type { Party } from "../lib/contract.ts";

test("a successfully empty directory is different from a failed load", async () => {
  assert.deepEqual(await loadDirectory({ listParties: async () => [], listBuilders: async () => [] }), {
    parties: [], builders: [], directoryUnavailable: false,
  });
  const down = async (): Promise<never> => { throw new Error("service down"); };
  assert.deepEqual(await loadDirectory({ listParties: down, listBuilders: down }), {
    parties: [], builders: [], directoryUnavailable: true,
  });
});

test("a partial directory preserves the successful side and reports the missing data", async () => {
  const party: Party = { address: "rDemo", name: "Demo investor", role: "investor" };
  const result = await loadDirectory({ listParties: async () => [party], listBuilders: async () => { throw new Error("failed"); } });
  assert.deepEqual(result.parties, [party]);
  assert.deepEqual(result.builders, []);
  assert.equal(result.directoryUnavailable, true);
});
