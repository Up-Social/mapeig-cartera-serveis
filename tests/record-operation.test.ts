import assert from "node:assert/strict";
import test from "node:test";

import {
  isRecordOperationTerminal,
  type RecordOperation,
} from "../lib/record-operation";
import { createRecordStatusResponse } from "../lib/record-status-response";
import type { SourceRecord } from "../lib/workbench-types";
import {canReviewRecord,recordReviewLabel} from '../lib/record-review-state';

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
  matchingError: null,
  reviewDecision: null,
  pipelineRunId: null,
  batchNumber: null,
  externalEnrichment: null,
};

function withRecord(values: Partial<SourceRecord>) {
  return { ...record, ...values };
}

test('a paused audit without a persisted result cannot be reviewed', () => {
  const pending=withRecord({currentJobId:'job',currentJobStatus:'matching',evidenceStatus:'ready',enrichmentStatus:'completed',operationProgress:{state:'incident',step:'matching',completed:0,total:1,detail:null,startedAt:'2026-09-30',lastActivityAt:'2026-09-30',finishedAt:null,attempts:1,failureKind:'internal'}});
  assert.equal(canReviewRecord(pending),false);
  assert.match(recordReviewLabel(pending),/Incidència tècnica/);
  assert.equal(canReviewRecord({...pending,currentJobStatus:'needs_review'}),false);
});

test('persisted no-match results remain reviewable while active or invalidated results do not', () => {
  const ready=withRecord({currentJobId:'job',currentJobStatus:'needs_review',analysis:{classification:'insufficient_evidence',reliability_status:'valid'} as NonNullable<SourceRecord['analysis']>});
  assert.equal(canReviewRecord(ready),true);
  assert.equal(canReviewRecord({...ready,currentJobStatus:'matching'}),false);
  assert.equal(canReviewRecord({...ready,isHistorical:true}),false);
  assert.equal(canReviewRecord({...ready,analysis:{...ready.analysis!,reliability_status:'invalidated'}}),false);
});

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

test("stops the automatic process when preparation has a terminal incidence", () => {
  assert.equal(
    isRecordOperationTerminal("process", {
      ...record,
      evidenceStatus: "no_source",
      status: "sense_evidencia",
    }),
    true,
  );
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

for (const operation of ['match','process','enrich','prepare','ocr'] as const) test(`stops ${operation} on a paused technical incident`,()=>{
 assert.equal(isRecordOperationTerminal(operation, withRecord({operationProgress:{state:'incident',step:'matching',completed:0,total:1,detail:null,startedAt:'2026-09-30',lastActivityAt:'2026-09-30',finishedAt:null,attempts:1,failureKind:'internal'}})),true);
});
