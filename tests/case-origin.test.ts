import assert from "node:assert/strict";
import test from "node:test";
import { safeCaseOrigin } from "../lib/case-origin";

test("case return navigation preserves only known list context", () => {
  assert.equal(safeCaseOrigin("/review?q=servei&page=3&batch=123"), "/review?q=servei&page=3&batch=123");
  assert.equal(safeCaseOrigin("/batches/72000000-0000-4000-8000-000000000007/results?view=review"), "/batches/72000000-0000-4000-8000-000000000007/results?view=review");
  assert.equal(safeCaseOrigin("https://example.org"), "/review");
  assert.equal(safeCaseOrigin("//example.org"), "/review");
  assert.equal(safeCaseOrigin("/admin"), "/review");
  assert.equal(safeCaseOrigin("/\\example.org"), "/review");
});
