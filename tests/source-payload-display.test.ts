import assert from "node:assert/strict";
import test from "node:test";
import { sourcePayloadFieldLabel, sourcePayloadValue } from "../lib/source-payload-display";

test("tradueix les claus i els valors tècnics del registre", () => {
  assert.equal(sourcePayloadFieldLabel("event_type"), "Tipus d’esdeveniment");
  assert.equal(sourcePayloadValue("event_type", "nova_provisio_o_ampliacio"), "Nova provisió o ampliació");
  assert.equal(sourcePayloadValue("counts_as_new_financing", true), "Sí");
});

test("presenta classificacions estructurades sense object Object", () => {
  const result = sourcePayloadValue("classificacions", [
    { concepte: "Categoria", categoria: "Serveis Socials", subcategoria: null },
    { concepte: "Organisme publicador", categoria: "Drets Socials" },
  ]);
  assert.equal(result.includes("[object Object]"), false);
  assert.match(result, /Concepte: Categoria/);
  assert.match(result, /Categoria: Drets Socials/);
});
