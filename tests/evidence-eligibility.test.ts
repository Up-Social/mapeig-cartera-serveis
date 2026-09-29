import test from "node:test";
import assert from "node:assert/strict";
import {
  documentQuality,
  evidenceRejectionReasons,
  isEligibleEvidence,
  isGenericPortalText,
  isSubstantiveEvidenceQuote,
} from "../lib/evidence-eligibility";

test("the generic e-Tauler shell is never eligible matching evidence", () => {
  const content = "e-TAULER - Consorci Administració Oberta de Catalunya";
  assert.equal(isGenericPortalText(content), true);
  assert.equal(isEligibleEvidence({ content, textLength: content.length, extractionMethod: "html-basic" }), false);
  assert.deepEqual(evidenceRejectionReasons({ content, textLength: content.length, extractionMethod: "html-basic" }), ["generic_portal", "short_text", "basic_html_only"]);
  assert.equal(isSubstantiveEvidenceQuote(content), false);
});

test("short, duplicate and JavaScript-only evidence remains distinguishable", () => {
  assert.ok(evidenceRejectionReasons({ content: "Servei breu", textLength: 12 }).includes("short_text"));
  assert.ok(evidenceRejectionReasons({ content: "Contingut oficial ".repeat(30), textLength: 540, qualityFlags: ["duplicate_text"] }).includes("duplicate_text"));
  assert.ok(evidenceRejectionReasons({ content: "Enable JavaScript to continue", textLength: 30 }).includes("javascript_shell"));
});

test("substantive official evidence remains eligible", () => {
  const content = "La resolució acredita un servei de centre de dia per a persones grans en situació de dependència, amb vint-i-cinc places concertades i atenció professional continuada. ".repeat(3);
  assert.equal(isEligibleEvidence({ content, textLength: content.length, extractionMethod: "pdftotext", qualityFlags: [] }), true);
  assert.equal(isSubstantiveEvidenceQuote("servei de centre de dia per a persones grans en situació de dependència"), true);
  assert.deepEqual(documentQuality(content, "pdftotext").qualityFlags, ["short_text"]);
});
