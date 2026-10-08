import type { SourceRecord } from "./workbench-types";

export type RecordOperation = "prepare" | "enrich" | "match" | "process" | "ocr";

export function recordOperationNeedsAttention(record: SourceRecord) {
  return record.operationProgress?.state === "incident" || record.currentJobStatus === "error";
}

export function isRecordOperationTerminal(
  operation: RecordOperation,
  record: SourceRecord,
) {
  if (record.operationProgress?.state === 'incident') return true;
  if (['active', 'waiting', 'stalled'].includes(record.operationProgress?.state ?? '')) return false;
  if (record.operationProgress?.state === 'finished') return true;
  if (['error', 'insufficient_evidence', 'needs_review', 'approved', 'corrected', 'rejected'].includes(record.currentJobStatus ?? '')) return true;
  if((operation==='match'||operation==='process'||operation==='ocr')&&record.analysis)return true;
  if (operation === "prepare") {
    return ["ready", "no_source", "unsupported", "error"].includes(
      record.evidenceStatus,
    );
  }
  if (operation === "enrich") {
    return ["completed", "error"].includes(record.enrichmentStatus);
  }
  if (operation === "process" || operation === "ocr") {
    return (
      record.matchingCandidates.length > 0 ||
      ["no_source", "unsupported", "error"].includes(record.evidenceStatus) ||
      record.enrichmentStatus === "error" ||
      record.status === "error" ||
      record.status === "sense_evidencia"
    );
  }
  return record.matchingCandidates.length > 0 || record.status === "error";
}
