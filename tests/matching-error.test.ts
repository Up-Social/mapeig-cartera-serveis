import assert from "node:assert/strict";
import test from "node:test";
import { mapLatestMatchingError } from "../lib/matching-state";

test("returns the latest matching error", () => {
  assert.equal(
    mapLatestMatchingError([
      { created_at: "2026-09-01T10:00:00Z", status: "error", error_message: "antic" },
      { created_at: "2026-09-01T11:00:00Z", status: "error", error_message: "actual" },
    ]),
    "actual",
  );
});

test("does not preserve an old error after a successful retry", () => {
  assert.equal(
    mapLatestMatchingError([
      { created_at: "2026-09-01T10:00:00Z", status: "error", error_message: "antic" },
      { created_at: "2026-09-01T11:00:00Z", status: "needs_review", error_message: null },
    ]),
    null,
  );
});
