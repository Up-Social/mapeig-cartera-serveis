import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySourceDocumentField,
  resolveRegulatoryBasisUrl,
} from "../lib/provision-links";

test("classifies Spanish and Catalan regulatory-basis fields", () => {
  assert.equal(
    classifySourceDocumentField("Bases reguladoras (enlace)"),
    "regulatory_basis",
  );
  assert.equal(
    classifySourceDocumentField("Enllaç bases reguladores"),
    "regulatory_basis",
  );
});

test("prefers an explicit regulatory-basis URL", () => {
  assert.equal(
    resolveRegulatoryBasisUrl(
      { "Bases reguladoras (enlace)": "https://example.test/bases.pdf" },
      [],
    ),
    "https://example.test/bases.pdf",
  );
});

test("does not duplicate the call URL when the source has no separate basis", () => {
  assert.equal(
    resolveRegulatoryBasisUrl({}, []),
    null,
  );
});
