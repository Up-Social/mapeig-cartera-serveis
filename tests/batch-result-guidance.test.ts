import assert from "node:assert/strict";
import test from "node:test";

import { batchResultGuidance } from "../lib/batch-result-guidance";
import type { BatchJob } from "../lib/batch-types";

const baseJob: BatchJob = {
  id: "job-1",
  sourceRecordId: "record-1",
  sourceDataset: "contractacions",
  financingType: "contractacio",
  externalId: "EXP-1",
  title: "Servei de prova",
  status: "needs_review",
  preparationStatus: "ready",
  preparationMessage: null,
  errorMessage: null,
  enrichmentStatus: "completed",
  enrichmentError: null,
  processingStatus: "needs_review",
  analysis: null,
  matchingCandidates: [],
  hasProvision: false,
  phases: {
    preparation: "completed",
    enrichment: "completed",
    matching: "completed",
  },
};

test("mostra el motiu específic d'una revisió humana", () => {
  const guidance = batchResultGuidance({
    ...baseJob,
    analysis: {
      id: "analysis-1",
      classification: "insufficient_evidence",
      reasons: [],
      explanation: "No consta la població destinatària del servei en la documentació disponible.",
      service_description: "Servei d’acompanyament",
      target_population: "",
      catalog_version_id: "catalog-1",
      rules_version: "rules-1",
      reviewed_classification: null,
      review_notes: null,
      evidence: [{ content: "Fragment oficial" }],
    },
  });

  assert.equal(guidance.kind, "review");
  assert.equal(guidance.title, "Cal revisar la falta d’evidència");
  assert.match(guidance.explanation, /població destinatària/);
  assert.match(guidance.nextStep, /Comprova la font/);
});

test("tradueix un document no processable a una explicació útil", () => {
  const guidance = batchResultGuidance({
    ...baseJob,
    status: "error",
    preparationStatus: "error",
    errorMessage: "Document no processable.",
    phases: {
      preparation: "error",
      enrichment: "blocked",
      matching: "blocked",
    },
  });

  assert.equal(guidance.kind, "technical");
  assert.equal(guidance.phase, "Preparació de fonts");
  assert.equal(guidance.title, "No s’ha pogut llegir cap document útil");
  assert.match(guidance.nextStep, /OCR/);
  assert.equal(guidance.technicalDetail, "Document no processable.");
});

test("identifica la fase d'un error de correspondència", () => {
  const guidance = batchResultGuidance({
    ...baseJob,
    status: "error",
    errorMessage: "Resposta incompleta del proveïdor",
    phases: {
      preparation: "completed",
      enrichment: "completed",
      matching: "error",
    },
  });

  assert.equal(guidance.phase, "Correspondència amb la Cartera");
  assert.match(guidance.title, /correspondència/);
});
