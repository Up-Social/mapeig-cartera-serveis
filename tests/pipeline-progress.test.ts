import assert from "node:assert/strict";
import test from "node:test";
import { phaseState } from "../lib/pipeline-progress";

test("marca la fase actual com en curs", () => {
  assert.equal(phaseState("enrichment", "enrichment", 2, 0, 4), "running");
});

test("marca una fase anterior com completada", () => {
  assert.equal(phaseState("matching", "preparation", 3, 1, 4), "completed");
});

test("marca una fase terminal sense èxits com error", () => {
  assert.equal(phaseState("review", "matching", 0, 2, 2), "error");
});

test("manté una fase futura pendent", () => {
  assert.equal(phaseState("preparation", "matching", 0, 0, 4), "pending");
});
