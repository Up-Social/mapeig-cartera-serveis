import assert from "node:assert/strict";
import test from "node:test";

import { displaySourceIdentifier } from "../lib/source-identifiers";
import {
  ACCESS_COOKIE_MAX_AGE,
  createAccessToken,
  hasTrustedOrigin,
  verifyAccessToken,
  safeEqual,
  safeReturnPath,
} from "../lib/access-auth";

test("hides the internal deduplication suffix", () => {
  assert.equal(displaySourceIdentifier("EXP-2026-42::a8f90c"), "EXP-2026-42");
});

test("preserves an official identifier without a suffix", () => {
  assert.equal(displaySourceIdentifier("EXP-2026-42"), "EXP-2026-42");
});

test("preserves the original value when the prefix is empty", () => {
  assert.equal(displaySourceIdentifier("::internal"), "::internal");
});

test("creates expiring signed access tokens without exposing the password", async () => {
  const issuedAt = Date.UTC(2026, 8, 28);
  const first = await createAccessToken("contrasenya-segura", issuedAt);
  const second = await createAccessToken("contrasenya-segura", issuedAt);
  assert.equal(first, second);
  assert.equal(first.includes("contrasenya-segura"), false);
  assert.equal(safeEqual(first, second), true);
  assert.equal(await verifyAccessToken(first, "contrasenya-segura", issuedAt + 1), true);
  assert.equal(await verifyAccessToken(first, "una-altra", issuedAt + 1), false);
  assert.equal(await verifyAccessToken(first, "contrasenya-segura", issuedAt + ACCESS_COOKIE_MAX_AGE * 1000), false);
});

test("only accepts internal return paths", () => {
  assert.equal(safeReturnPath("/review?state=pending"), "/review?state=pending");
  assert.equal(safeReturnPath("https://example.com"), "/");
  assert.equal(safeReturnPath("//example.com"), "/");
});

test("keeps an authenticated browser session for seven days", () => {
  assert.equal(ACCESS_COOKIE_MAX_AGE, 60 * 60 * 24 * 7);
});

test("accepts equivalent loopback origins but rejects cross-site writes", () => {
  assert.equal(hasTrustedOrigin(new Request("http://localhost:3110/api/test", { headers: { origin: "http://127.0.0.1:3110", "sec-fetch-site": "same-site" } })), true);
  assert.equal(hasTrustedOrigin(new Request("https://mapeig.example/api/test", { headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" } })), false);
});
