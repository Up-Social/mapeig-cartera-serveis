import assert from "node:assert/strict";
import test from "node:test";

import { displaySourceIdentifier } from "../lib/source-identifiers";
import { createAccessToken, safeEqual, safeReturnPath } from "../lib/access-auth";

test("hides the internal deduplication suffix", () => {
  assert.equal(displaySourceIdentifier("EXP-2026-42::a8f90c"), "EXP-2026-42");
});

test("preserves an official identifier without a suffix", () => {
  assert.equal(displaySourceIdentifier("EXP-2026-42"), "EXP-2026-42");
});

test("preserves the original value when the prefix is empty", () => {
  assert.equal(displaySourceIdentifier("::internal"), "::internal");
});

test("creates stable access tokens without exposing the password", async () => {
  const first = await createAccessToken("contrasenya-segura");
  const second = await createAccessToken("contrasenya-segura");
  assert.equal(first, second);
  assert.equal(first.includes("contrasenya-segura"), false);
  assert.equal(safeEqual(first, second), true);
  assert.equal(safeEqual(first, await createAccessToken("una-altra")), false);
});

test("only accepts internal return paths", () => {
  assert.equal(safeReturnPath("/review?state=pending"), "/review?state=pending");
  assert.equal(safeReturnPath("https://example.com"), "/");
  assert.equal(safeReturnPath("//example.com"), "/");
});
