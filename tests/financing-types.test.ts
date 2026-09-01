import assert from "node:assert/strict";
import test from "node:test";

import {
  FINANCING_TYPES,
  financingTypeForDataset,
} from "../lib/financing-types";

test("maps every supported source dataset to its financing type", () => {
  assert.deepEqual(
    [
      "contractacions",
      "convenis",
      "raisc_ccaa",
      "raisc_local",
      "concerts",
    ].map(financingTypeForDataset),
    ["contractacio", "conveni", "subvencio", "subvencio", "concert"],
  );
});

test("keeps the four financing mechanisms represented", () => {
  assert.deepEqual(FINANCING_TYPES, [
    "contractacio",
    "conveni",
    "subvencio",
    "concert",
  ]);
});

test("does not silently classify an unknown dataset", () => {
  assert.equal(financingTypeForDataset("bdns"), null);
  assert.equal(financingTypeForDataset(""), null);
});
