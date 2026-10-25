import assert from "node:assert/strict";
import { test } from "node:test";
import { validAmount } from "./amount";

test("construction draw amounts accept positive decimal cents only", () => {
  for (const value of ["1", "100000", "0.01", "150.25"]) assert.equal(validAmount(value), true, value);
  for (const value of ["", "0", "-10", "1.234", "1..2", "NaN", "Infinity", "1e3", "1,000", "9007199254740992"]) assert.equal(validAmount(value), false, value);
});
