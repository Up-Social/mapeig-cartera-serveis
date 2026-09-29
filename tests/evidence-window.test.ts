import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_EVIDENCE_LIMIT,
  selectEvidenceWindow,
} from "../lib/cloud/evidence-window";

function chunks(document: string, count: number) {
  return Array.from({ length: count }, (_, ordinal) => ({
    source_document_id: document,
    ordinal,
    content: `${document}-${ordinal}`,
  }));
}

test("keeps the resolution opening and the final annex within the evidence budget", () => {
  const selected = selectEvidenceWindow(chunks("official-pdf", 14));

  assert.equal(selected.length, ANALYSIS_EVIDENCE_LIMIT);
  assert.deepEqual(
    selected.map((chunk) => chunk.ordinal),
    [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13],
  );
});

test("preserves the beginning and end of every document and their original order", () => {
  const input = [...chunks("document-a", 8), ...chunks("document-b", 8)];
  const selected = selectEvidenceWindow(input, 8);

  assert.deepEqual(
    selected.map((chunk) => chunk.content),
    [
      "document-a-0",
      "document-a-1",
      "document-a-6",
      "document-a-7",
      "document-b-0",
      "document-b-1",
      "document-b-6",
      "document-b-7",
    ],
  );
});

test("does not reorder or truncate evidence that already fits", () => {
  const input = chunks("short-document", 3);
  assert.deepEqual(selectEvidenceWindow(input), input);
});
