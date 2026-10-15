import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogRelationSourceLabel,
  catalogRelationTypeLabel,
  entityValidationStatusLabel,
  entityQualificationLabel,
  referenceTextLabel,
  hasReferenceText,
  pipelineStageLabel,
  portfolioStatusLabel,
  sourceDocumentStatusLabel,
  sourceDocumentTypeLabel,
} from "../lib/ui-labels";

test("tradueix tots els estats documentals persistents", () => {
  assert.equal(sourceDocumentStatusLabel("discovered"), "Descoberta");
  assert.equal(sourceDocumentStatusLabel("fetching"), "Descarregant");
  assert.equal(sourceDocumentStatusLabel("fetched"), "Text extret");
  assert.equal(sourceDocumentStatusLabel("unsupported"), "Format no compatible");
  assert.equal(sourceDocumentStatusLabel("error"), "Errors");
});

test("tradueix tipus i estats d'altres entitats", () => {
  assert.equal(sourceDocumentTypeLabel("contracting_profile"), "Perfil del contractant");
  assert.equal(portfolioStatusLabel("Dentro"), "Dins de la Cartera");
  assert.equal(entityValidationStatusLabel("verified_nif"), "NIF verificat");
  assert.equal(entityValidationStatusLabel("reses_verified"), "Verificada al RESES");
  assert.equal(entityValidationStatusLabel("source_verified"), "Verificada a la font");
  assert.equal(entityValidationStatusLabel("manually_verified"), "Verificada manualment");
  assert.equal(catalogRelationTypeLabel("auxiliary"), "auxiliar");
  assert.equal(catalogRelationSourceLabel("provision"), "provisió validada");
  assert.equal(pipelineStageLabel("matching"), "Correspondència");
  assert.equal(pipelineStageLabel("review"), "Revisió humana");
  assert.equal(pipelineStageLabel("completed"), "Finalitzat");
});

test("la qualificació absent no es mostra com un valor literal null", () => {
  for (const value of [null, undefined, "null", "undefined", "  "]) assert.equal(entityQualificationLabel(value), "Qualificació no informada");
  assert.equal(entityQualificationLabel("Entitat privada d'iniciativa social"), "Entitat privada d'iniciativa social");
});

test("identitats amb marcadors null continuen pendents, sense inventar nom o NIF", () => {
  for (const value of [null, undefined, "null", "NULL", "undefined", "  "]) {
    assert.equal(hasReferenceText(value), false);
    assert.equal(referenceTextLabel(value, "Entitat pendent d’identificar"), "Entitat pendent d’identificar");
  }
  assert.equal(referenceTextLabel("Fundació Exemple"), "Fundació Exemple");
  assert.equal(referenceTextLabel("G12345678"), "G12345678");
});
