import assert from "node:assert/strict";
import test from "node:test";

import { displaySourceIdentifier } from "../lib/source-identifiers";

test("hides the internal deduplication suffix", () => {
  assert.equal(displaySourceIdentifier("EXP-2026-42::a8f90c"), "EXP-2026-42");
});

test("preserves an official identifier without a suffix", () => {
  assert.equal(displaySourceIdentifier("EXP-2026-42"), "EXP-2026-42");
});

test("preserves the original value when the prefix is empty", () => {
  assert.equal(displaySourceIdentifier("::internal"), "::internal");
});
