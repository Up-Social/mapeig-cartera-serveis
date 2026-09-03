import assert from "node:assert/strict";
import test from "node:test";

import { classifyIssue, issueMatchesFilters } from "../lib/issue-types";
import type { SourceRecord } from "../lib/workbench-types";

const record: SourceRecord = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  sourceDataset: "contractacions",
  financingType: "contractacio",
  sourceRecordId: "EXP-1",
  mechanism: "Contracte",
  title: "Servei de prova",
  providerName: "Entitat de prova",
  amount: null,
  status: "error",
  carteraCode: null,
  carteraName: null,
  confidence: null,
  evidence: null,
  sourceFile: null,
  sourceSheet: null,
  sourceRow: null,
  sourcePayload: {},
  evidenceStatus: "ready",
  evidenceError: null,
  enrichmentStatus: "completed",
  enrichmentError: null,
  sourceDocuments: [],
  matchingCandidates: [],
  matchingError: "El model no ha retornat candidats",
  reviewDecision: null,
  reviewReason: null,
  reviewedAt: null,
  updatedAt: "2026-09-03T10:00:00Z",
  pipelineRunId: "223e4567-e89b-42d3-a456-426614174000",
  batchNumber: "00000001",
  externalEnrichment: null,
};

test("classifies the current matching error", () => {
  const issue = classifyIssue(record);
  assert.equal(issue?.category, "matching_error");
  assert.equal(issue?.message, "El model no ha retornat candidats");
  assert.equal(issue?.retryOperation, "match");
});

test("human decisions take precedence over technical history", () => {
  const issue = classifyIssue({
    ...record,
    status: "rebutjat",
    reviewDecision: "rejected",
    reviewReason: "No correspon a cap prestació social.",
  });
  assert.equal(issue?.category, "rejected");
  assert.equal(issue?.message, "No correspon a cap prestació social.");
  assert.equal(issue?.retryOperation, null);
});

test("classifies evidence and enrichment failures before a generic matching error", () => {
  assert.equal(classifyIssue({ ...record, evidenceStatus: "no_source" })?.category, "no_source");
  assert.equal(classifyIssue({ ...record, evidenceStatus: "unsupported" })?.category, "unsupported");
  assert.equal(classifyIssue({ ...record, enrichmentStatus: "error", enrichmentError: "fallada" })?.category, "enrichment_error");
});

test("offers the complete OCR recovery only for unsupported PDF evidence", () => {
  const pdfIssue = classifyIssue({
    ...record,
    evidenceStatus: "unsupported",
    evidenceError: "Tipus no compatible: document sense text extraïble; cal OCR",
    sourceDocuments: [{ id: "doc-1", url: "https://example.org/scan.pdf", documentType: "annex", sourceFields: [], status: "unsupported", mimeType: "application/pdf", textPreview: null, textLength: null, extractionMethod: null, qualityScore: null, qualityFlags: [], chunkCount: 0 }],
  });
  assert.equal(pdfIssue?.retryOperation, "ocr");
  const otherIssue = classifyIssue({ ...record, evidenceStatus: "unsupported", evidenceError: "Tipus no compatible: image/tiff" });
  assert.equal(otherIssue?.retryOperation, "prepare");
});

test("filters issues by type and text", () => {
  const issue = classifyIssue(record)!;
  assert.equal(issueMatchesFilters(issue, { type: "contractacio", query: "model" }), true);
  assert.equal(issueMatchesFilters(issue, { type: "subvencio", query: "" }), false);
});

test("approved records are not incidents", () => {
  assert.equal(classifyIssue({ ...record, status: "completat", matchingError: null, reviewDecision: "approved" }), null);
});

test("classifies technical errors from individual records and batches alike", () => {
  const individual = classifyIssue({ ...record, pipelineRunId: null, batchNumber: null });
  const batch = classifyIssue({ ...record, pipelineRunId: "323e4567-e89b-42d3-a456-426614174000", batchNumber: "00000025" });
  assert.equal(individual?.category, "matching_error");
  assert.equal(individual?.record.batchNumber, null);
  assert.equal(batch?.category, "matching_error");
  assert.equal(batch?.record.batchNumber, "00000025");
});

test("classifies both negative review outcomes as incidents with their reason", () => {
  const rejected = classifyIssue({ ...record, status: "rebutjat", matchingError: null, reviewDecision: "rejected", reviewReason: "No encaixa amb cap servei." });
  const insufficient = classifyIssue({ ...record, status: "sense_evidencia", matchingError: null, reviewDecision: "insufficient_evidence", reviewReason: "Falta la resolució oficial." });
  assert.equal(rejected?.category, "rejected");
  assert.equal(rejected?.message, "No encaixa amb cap servei.");
  assert.equal(insufficient?.category, "insufficient_evidence");
  assert.equal(insufficient?.message, "Falta la resolució oficial.");
});
