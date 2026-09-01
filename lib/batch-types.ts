import type { FinancingType } from "./financing-types";
import type { MatchingCandidate } from "./workbench-types";

export const SOURCE_DATASETS = ["contractacions", "convenis", "raisc_ccaa", "raisc_local"] as const;
export type SourceDataset = typeof SOURCE_DATASETS[number];
export type EvidencePreparationStatus = "pending" | "discovering" | "fetching" | "chunking" | "ready" | "no_source" | "unsupported" | "error";
export type SampleRecord = {
  id: string; sourceDataset: SourceDataset; sourceRecordId: string; title: string;
  providerName: string | null; amount: number | null; mechanism: string; financingType: FinancingType; deduplicationKey: string;
};
export type BatchJob = {
  id: string; sourceRecordId: string; sourceDataset: SourceDataset; financingType: FinancingType; externalId: string; title: string;
  status: string; preparationStatus: EvidencePreparationStatus; preparationMessage: string | null;
  matchingCandidates: MatchingCandidate[];
  hasProvision: boolean;
};
export type BatchSummary = {
  id: string; batchNumber: string; status: string; stage: string; selectedCount: number; preparedCount: number; readyCount: number;
  processedCount: number; analyzedCount: number; reviewCount: number; reviewedCount: number; approvedCount: number; rejectedCount: number; insufficientCount: number; errorCount: number; exportableCount: number; incidences: string[];
  estimatedInputTokens: number; actualInputTokens: number; actualOutputTokens: number; createdAt: string;
  canExport: boolean; provisionCount: number;
  jobs: BatchJob[];
};
export type ExportSummary = { id: string; filename: string; provisionCount: number; createdAt: string };
