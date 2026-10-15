import assert from "node:assert/strict";
import test from "node:test";
import { formatReferenceValue, isIllustrativeReference, referenceEntries, referenceFieldLabel } from "../lib/master-reference";

test("distingueix un valor absent del zero importat, també en percentatges", () => {
  for (const absent of [null, undefined, "", "  ", "null", "Sin datos", NaN]) {
    assert.equal(formatReferenceValue("Importe total", absent), "No informat");
  }
  assert.match(formatReferenceValue("Importe total", 0), /^0,00\s€$/);
  assert.match(formatReferenceValue("% otros departamentos", 0), /^0\s%$/);
  assert.equal(formatReferenceValue("Concierto provisiones", 0), "0");
});

test("formata els imports dels quatre mecanismes i les proporcions de l’Excel", () => {
  for (const type of ["Concierto", "Subvención", "Convenio", "Contratación"]) {
    assert.match(formatReferenceValue(`${type} importe`, 1234.5), /^1\.234,50\s€$/);
    assert.equal(formatReferenceValue(`${type} provisiones`, 12), "12");
  }
  assert.match(formatReferenceValue("% Drets Socials", 0.125), /^12,5\s%$/);
  assert.match(formatReferenceValue("Confianza general", 0.9), /^90\s%$/);
  assert.match(formatReferenceValue("Confianza general", 90), /^90\s%$/);
});

test("separa les fórmules de les dades i no les avalua ni inventa un resultat", () => {
  const payload = { "Importe total": null, "Fórmula · Importe total": "=M4", "Estado": "Dentro" };
  const original = JSON.stringify(payload);
  assert.deepEqual(referenceEntries(payload, true), [["Fórmula · Importe total", "=M4"]]);
  assert.equal(referenceEntries(payload, false).length, 2);
  assert.equal(formatReferenceValue("Importe total", payload["Importe total"]), "No informat");
  assert.equal(formatReferenceValue("Importe total", "=M4"), "Resultat no disponible al fitxer");
  assert.equal(formatReferenceValue("Fórmula · Importe total", "=M4"), "=M4");
  assert.equal(JSON.stringify(payload), original);
});

test("tradueix les dades conegudes i conserva camps desconeguts per a auditoria", () => {
  assert.equal(referenceFieldLabel("Subvención importe"), "Import de subvencions");
  assert.equal(referenceFieldLabel("Columna nova"), "Columna nova");
  assert.equal(formatReferenceValue("Estado", "Dentro"), "Dins de la Cartera");
  assert.equal(formatReferenceValue("Estado", "Fuera - candidato a incorporar"), "Fora · candidat a incorporar");
  assert.equal(formatReferenceValue("Estado", "Fuera - no candidato (mismo colectivo, vía subvención)"), "Fora · no candidat (mateix col·lectiu, via subvenció)");
  assert.deepEqual(referenceEntries({ "Columna nova": "valor" }, false), [["Columna nova", "valor"]]);
  assert.equal(formatReferenceValue("Columna nova", false), "No");
});

test("identifica exemples únicament quan la font ho diu explícitament", () => {
  assert.equal(isIllustrativeReference({ "Nombre del servicio": "(Ejemplo ilustrativo, completar con caso real) Programa" }), true);
  assert.equal(isIllustrativeReference({ "Nombre del servicio": "Servei d'ajuda a domicili", "Código Cartera": "FNC-01" }), false);
});
