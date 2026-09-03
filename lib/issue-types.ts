import type { FinancingType } from "./financing-types";
import type { RecordOperation } from "./record-operation";
import type { SourceRecord } from "./workbench-types";

export const ISSUE_CATEGORIES = [
  "rejected",
  "insufficient_evidence",
  "matching_error",
  "enrichment_error",
  "document_error",
  "no_source",
  "unsupported",
] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const ISSUE_CATEGORY_LABELS: Record<IssueCategory, string> = {
  rejected: "No encaixa amb la Cartera",
  insufficient_evidence: "Evidència insuficient",
  matching_error: "Error de correspondència",
  enrichment_error: "Error de contrast",
  document_error: "Error documental",
  no_source: "Sense font documental",
  unsupported: "Format no compatible",
};

export type IssueRecord = {
  record: SourceRecord;
  category: IssueCategory;
  phase: "review" | "matching" | "enrichment" | "evidence";
  message: string;
  occurredAt: string | null;
  retryOperation: RecordOperation | null;
};

export type IssueFilters = {
  page: number;
  query: string;
  type: string;
  category: string;
  batch: string;
};

export type IssuePage = {
  issues: IssueRecord[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  batches: Array<{ id: string; number: string }>;
  metrics: {
    total: number;
    rejected: number;
    insufficient: number;
    technical: number;
    source: number;
  };
};

export function classifyIssue(record: SourceRecord): IssueRecord | null {
  if (record.reviewDecision === "rejected") {
    return issue(record, "rejected", "review", record.reviewReason ?? "La revisió humana ha determinat que el cas no encaixa amb cap servei de la Cartera.", null);
  }
  if (record.reviewDecision === "insufficient_evidence") {
    return issue(record, "insufficient_evidence", "review", record.reviewReason ?? "La documentació disponible no permet justificar una correspondència.", null);
  }
  if (record.evidenceStatus === "no_source") {
    return issue(record, "no_source", "evidence", record.evidenceError ?? "No s'ha localitzat cap font documental útil.", "prepare");
  }
  if (record.evidenceStatus === "unsupported") {
    return issue(record, "unsupported", "evidence", record.evidenceError ?? "La font necessita OCR o un extractor addicional.", isOcrEligible(record) ? "ocr" : "prepare");
  }
  if (record.evidenceStatus === "error") {
    return issue(record, "document_error", "evidence", record.evidenceError ?? "No s'ha pogut preparar la font documental.", "prepare");
  }
  if (record.enrichmentStatus === "error") {
    return issue(record, "enrichment_error", "enrichment", record.enrichmentError ?? "No s'han pogut contrastar les dades oficials.", "enrich");
  }
  if (record.matchingError || record.status === "error") {
    return issue(record, "matching_error", "matching", record.matchingError ?? "La correspondència no ha finalitzat correctament.", "match");
  }
  return null;
}

export function isOcrEligible(record: SourceRecord) {
  if (record.evidenceStatus !== "unsupported") return false;
  const diagnostic = `${record.evidenceError ?? ""} ${record.sourceDocuments.map((document) => `${document.mimeType ?? ""} ${document.url}`).join(" ")}`.toLocaleLowerCase("ca");
  return diagnostic.includes("ocr") && (diagnostic.includes("pdf") || record.sourceDocuments.some((document) => document.mimeType?.includes("pdf") || document.url.toLocaleLowerCase("ca").endsWith(".pdf")));
}

function issue(
  record: SourceRecord,
  category: IssueCategory,
  phase: IssueRecord["phase"],
  message: string,
  retryOperation: RecordOperation | null,
): IssueRecord {
  return {
    record,
    category,
    phase,
    message,
    occurredAt: record.reviewedAt ?? record.updatedAt ?? null,
    retryOperation,
  };
}

export function issueMatchesFilters(issueRecord: IssueRecord, filters: Omit<IssueFilters, "page">) {
  const { record } = issueRecord;
  if (filters.category !== "totes" && issueRecord.category !== filters.category) return false;
  if (filters.type !== "totes" && record.financingType !== (filters.type as FinancingType)) return false;
  if (filters.batch !== "tots" && record.pipelineRunId !== filters.batch) return false;
  if (!filters.query) return true;
  const haystack = [record.title, record.sourceRecordId, record.providerName, issueRecord.message]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ca");
  return haystack.includes(filters.query.toLocaleLowerCase("ca"));
}
