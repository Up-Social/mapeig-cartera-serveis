import assert from "node:assert/strict";
import test from "node:test";
import { parseMatchingRationale } from "../lib/matching-rationale";

test("separa els apartats del rationale encara que arribin en una sola línia", () => {
  assert.deepEqual(
    parseMatchingRationale("Encaix: Coincideix amb l'objecte. Diferenciació: És més específic. Limitació: Falta el col·lectiu."),
    [
      { label: "Encaix", text: "Coincideix amb l'objecte." },
      { label: "Diferenciació", text: "És més específic." },
      { label: "Limitació", text: "Falta el col·lectiu." },
    ],
  );
});

test("manté el text antic com a fallback si no té apartats estructurats", () => {
  assert.deepEqual(parseMatchingRationale("Justificació històrica sense etiquetes."), []);
});

test("detecta etiquetes enganxades o amb salts irregulars", () => {
  assert.deepEqual(
    parseMatchingRationale("Encaix: Primer motiu.Diferenciació:\nSegon motiu. LIMITACIÓ: Tercer motiu."),
    [
      { label: "Encaix", text: "Primer motiu." },
      { label: "Diferenciació", text: "Segon motiu." },
      { label: "Limitació", text: "Tercer motiu." },
    ],
  );
});
