import assert from "node:assert/strict";
import test from "node:test";
import { phaseState } from "../lib/pipeline-progress";

test("marca la fase actual com en curs", () => {
  assert.equal(phaseState("enrichment", "enrichment", 2, 0, 4), "running");
});

test("marca una fase anterior com completada", () => {
  assert.equal(phaseState("matching", "preparation", 4, 0, 4), "completed");
});

test("marca qualsevol fase resolta amb errors com incidència", () => {
  assert.equal(phaseState("matching", "preparation", 3, 1, 4), "error");
});

test("manté una fase futura pendent", () => {
  assert.equal(phaseState("preparation", "matching", 0, 0, 4), "pending");
});

test("no considera completada una fase sense registres resolts", () => {
  assert.equal(phaseState("completed", "matching", 0, 0, 4), "pending");
  assert.equal(phaseState("completed", "matching", 0, 0, 0), "pending");
});

test("un lot en cua encara està pendent d'inici", () => {
  assert.equal(phaseState("queued", "preparation", 0, 0, 4), "pending");
});
