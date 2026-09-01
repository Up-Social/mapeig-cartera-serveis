import type { SourceRecord } from "./workbench-types";

export type RecordOperation = "prepare" | "enrich" | "match";

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
  return record.matchingCandidates.length > 0 || record.status === "error";
}
