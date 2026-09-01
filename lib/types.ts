export type ProcessingStatus =
  | "pendent"
  | "preparant"
  | "processant"
  | "completat"
  | "revisio"
  | "error";

export type SourceRecord = {
  id: string;
  sourceDataset: string;
  sourceRecordId: string;
  mechanism: string;
  title: string;
  providerName: string | null;
  amount: number | null;
  status: ProcessingStatus;
  carteraCode: string | null;
  carteraName: string | null;
  confidence: number | null;
  evidence: string | null;
  suggestedCode: string;
  suggestedName: string;
  suggestedConfidence: number;
  suggestedEvidence: string;
};
