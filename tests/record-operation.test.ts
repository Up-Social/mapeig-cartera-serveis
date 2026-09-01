import assert from "node:assert/strict";
import test from "node:test";

import {
  isRecordOperationTerminal,
  type RecordOperation,
} from "../lib/record-operation";
import { createRecordStatusResponse } from "../lib/record-status-response";
import type { SourceRecord } from "../lib/workbench-types";

const record: SourceRecord = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  sourceDataset: "contractacions",
  financingType: "contractacio",
  sourceRecordId: "EXP-1",
  mechanism: "contracte",
  title: "Servei de prova",
  providerName: null,
  amount: null,
  status: "pendent",
  carteraCode: null,
  carteraName: null,
  confidence: null,
  evidence: null,
  sourceFile: null,
  sourceSheet: null,
  sourceRow: null,
  sourcePayload: {},
  evidenceStatus: "pending",
  evidenceError: null,
  enrichmentStatus: "pending",
  enrichmentError: null,
  sourceDocuments: [],
  matchingCandidates: [],
  reviewDecision: null,
  pipelineRunId: null,
  batchNumber: null,
  externalEnrichment: null,
};

function withRecord(values: Partial<SourceRecord>) {
  return { ...record, ...values };
}

test("detects terminal states for each isolated record operation", () => {
  const cases: Array<[RecordOperation, SourceRecord, boolean]> = [
    ["prepare", withRecord({ evidenceStatus: "preparing" }), false],
    ["prepare", withRecord({ evidenceStatus: "ready" }), true],
    ["prepare", withRecord({ evidenceStatus: "no_source" }), true],
    ["prepare", withRecord({ evidenceStatus: "unsupported" }), true],
    ["prepare", withRecord({ evidenceStatus: "error" }), true],
    ["enrich", withRecord({ enrichmentStatus: "processing" }), false],
    ["enrich", withRecord({ enrichmentStatus: "completed" }), true],
    ["enrich", withRecord({ enrichmentStatus: "error" }), true],
    ["match", withRecord({ status: "processant" }), false],
    ["match", withRecord({ status: "error" }), true],
    [
      "match",
      withRecord({
        matchingCandidates: [
          {
            id: "candidate",
            pipelineJobId: "job",
            rank: 1,
            targetCode: "S1",
            targetName: "Servei",
            score: 0.8,
            rationale: "Coincidència",
            model: "test",
            evidence: [],
            serviceDetail: null,
          },
        ],
      }),
      true,
    ],
  ];

  for (const [operation, value, expected] of cases) {
    assert.equal(isRecordOperationTerminal(operation, value), expected);
  }
});

test("rejects an invalid record identifier without calling the loader", async () => {
  let called = false;
  const response = await createRecordStatusResponse("invalid", async () => {
    called = true;
    return record;
  });
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("returns 404 when the record does not exist", async () => {
  const response = await createRecordStatusResponse(record.id, async () => null);
  assert.equal(response.status, 404);
});

test("returns the current record without caching it", async () => {
  const response = await createRecordStatusResponse(record.id, async () => record);
  const payload = (await response.json()) as { record: SourceRecord };
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(payload.record.id, record.id);
});
