import type {StoredAnalysis} from './analysis-contract';
export type ProcessingStatus = "pendent" | "preparant" | "preparat" | "processant" | "completat" | "revisio" | "sense_evidencia" | "rebutjat" | "error";
import type { FinancingType } from "./financing-types";

export type SourceRecord = {
  currentJobId?: string | null;
  currentJobStatus?: string | null;
  reviewHistory?: {id:string;jobId:string|null;classification:string|null;decision:string;reason:string|null;reasons:string[];createdAt:string}[];
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
  analysis?:StoredAnalysis|null; matchingCandidates: MatchingCandidate[];
  matchingError: string | null;
  reviewDecision: "approved" | "corrected" | "rejected" | "insufficient_evidence" | null;
  reviewReason?: string | null;
  reviewedAt?: string | null;
  updatedAt?: string | null;
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
  legalReference?:string;
  id: string; pipelineJobId: string; rank: number; targetCode: string; targetName: string; score: number;
  rationale: string; model: string; evidence: Array<{ ordinal: number; content: string; explanation: string | null }>;
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
