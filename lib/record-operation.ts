import type { SourceRecord } from "./workbench-types";

export type RecordOperation = "prepare" | "enrich" | "match" | "process";

export function isRecordOperationTerminal(
  operation: RecordOperation,
  record: SourceRecord,
) {
  if (operation === "prepare") {
    return ["ready", "no_source", "unsupported", "error"].includes(
      record.evidenceStatus,
    );
  }
  if (operation === "enrich") {
    return ["completed", "error"].includes(record.enrichmentStatus);
  }
  if (operation === "process") {
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
