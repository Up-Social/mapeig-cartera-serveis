import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSourcePayloadEvidence,
  isUnusableWebExtraction,
} from "../lib/source-evidence";

test("rejects a JavaScript-only page as evidence", () => {
  assert.equal(
    isUnusableWebExtraction(
      "Plataforma de serveis de contractació pública. El vostre navegador no suporta Javascript.",
    ),
    true,
  );
});

test("keeps substantive web text", () => {
  assert.equal(
    isUnusableWebExtraction("Descripció oficial extensa del contracte"),
    false,
  );
});

test("builds auditable evidence from primitive source fields", () => {
  const evidence = buildSourcePayloadEvidence({
    Denominación: "Servei d'ajuda a domicili",
    Importe: 59470,
    Buit: null,
    "Fórmula · prova": "=A1",
  });
  assert.match(evidence, /Dades oficials del registre d'origen/);
  assert.match(evidence, /Denominación: Servei d'ajuda a domicili/);
  assert.match(evidence, /Importe: 59470/);
  assert.doesNotMatch(evidence, /Fórmula|Buit/);
});
