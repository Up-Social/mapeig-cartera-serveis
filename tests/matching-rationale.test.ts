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

test("neteja salts escapats entre apartats sense canviar el contingut interior", () => {
  const rationale = String.raw`Encaix: Una prestació social.\n\nDiferenciació: El literal A\nB és rellevant.\r\nLimitació: Falta informació.`;
  assert.deepEqual(parseMatchingRationale(rationale), [
    { label: "Encaix", text: "Una prestació social." },
    { label: "Diferenciació", text: String.raw`El literal A\nB és rellevant.` },
    { label: "Limitació", text: "Falta informació." },
  ]);
  assert.equal(rationale.includes(String.raw`\n\nDiferenciació`), true);
});

test("conserva literals fora del límit entre apartats i el fallback antic", () => {
  assert.deepEqual(parseMatchingRationale(String.raw`Encaix: \nText primer.\nDiferenciació: Text segon.\n`), [
    { label: "Encaix", text: String.raw`\nText primer.` },
    { label: "Diferenciació", text: String.raw`Text segon.\n` },
  ]);
  assert.deepEqual(parseMatchingRationale(String.raw`Text antic amb \n literal`), []);
  assert.deepEqual(parseMatchingRationale(String.raw`Encaix: Literal \\nDiferenciació: Altra secció.`), [
    { label: "Encaix", text: String.raw`Literal \\n` },
    { label: "Diferenciació", text: "Altra secció." },
  ]);
});
