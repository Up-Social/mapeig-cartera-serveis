export type ProcessingStatus = "pendent" | "preparant" | "preparat" | "processant" | "completat" | "revisio" | "sense_evidencia" | "rebutjat" | "error";
import type { FinancingType } from "./financing-types";

export type SourceRecord = {
  id: string; sourceDataset: string; financingType: FinancingType; sourceRecordId: string; mechanism: string; title: string;
  providerName: string | null; amount: number | null; status: ProcessingStatus;
  carteraCode: string | null; carteraName: string | null; confidence: number | null; evidence: string | null;
  sourceFile: string | null; sourceSheet: string | null; sourceRow: number | null;
  sourcePayload: Record<string, string | number | boolean | null>;
  evidenceStatus: "pending" | "preparing" | "ready" | "no_source" | "unsupported" | "error";
  evidenceError: string | null;
  enrichmentStatus: "pending" | "processing" | "completed" | "error";
  enrichmentError: string | null;
  sourceDocuments: SourceDocument[];
  matchingCandidates: MatchingCandidate[];
  reviewDecision: "approved" | "corrected" | "rejected" | "insufficient_evidence" | null;
  pipelineRunId: string | null;
  batchNumber: string | null;
  externalEnrichment: ExternalEnrichment | null;
};
export type ExternalEnrichment = {
  title: string | null; providerName: string | null; providerNif: string | null; mechanism: string | null;
  awardDate: string | null; amount: number | null; contractingBody: string | null; targetPopulation: string | null;
  summary: string; confidence: number; model: string; evidence: Array<{ ordinal: number; content: string }>;
};
export type MatchingCandidate = {
  id: string; pipelineJobId: string; rank: number; targetCode: string; targetName: string; score: number;
  rationale: string; model: string; evidence: Array<{ ordinal: number; content: string }>;
  serviceDetail: { sectorScope: string | null; portfolioStatus: string | null } | null;
};
export type SourceDocument = {
  id: string; url: string; documentType: string; sourceFields: string[];
  status: "discovered" | "fetching" | "fetched" | "unsupported" | "error";
  mimeType: string | null; textPreview: string | null; textLength: number | null;
  extractionMethod: string | null; qualityScore: number | null; qualityFlags: string[]; chunkCount: number;
};
export type SourcePage = {
  records: SourceRecord[]; total: number; page: number; pageCount: number; pageSize: number;
  metrics: { total: number; completed: number; review: number; queued: number };
};
export type ReviewQueue = { records: SourceRecord[]; total: number; reviewed: number };
