import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogRelationTypeLabel,
  entityValidationStatusLabel,
  portfolioStatusLabel,
  sourceDocumentStatusLabel,
  sourceDocumentTypeLabel,
} from "../lib/ui-labels";

test("tradueix tots els estats documentals persistents", () => {
  assert.equal(sourceDocumentStatusLabel("discovered"), "Descoberta");
  assert.equal(sourceDocumentStatusLabel("fetching"), "Descarregant");
  assert.equal(sourceDocumentStatusLabel("fetched"), "Text extret");
  assert.equal(sourceDocumentStatusLabel("unsupported"), "Format no compatible");
  assert.equal(sourceDocumentStatusLabel("error"), "Error");
});

test("tradueix tipus i estats d'altres entitats", () => {
  assert.equal(sourceDocumentTypeLabel("contracting_profile"), "Perfil del contractant");
  assert.equal(portfolioStatusLabel("Dentro"), "Dins de la Cartera");
  assert.equal(entityValidationStatusLabel("verified_nif"), "NIF verificat");
  assert.equal(catalogRelationTypeLabel("auxiliary"), "auxiliar");
});
