export type ApprovedFilters = { page: number; query: string; type: string };
export type ApprovedProvision = {
  id: string; sourceRecordId: string; sourceId: string; title: string; sourceDataset: string; financingType: string;
  batchId: string | null; batchNumber: string | null; decision: "approved" | "corrected"; decisionDate: string | null;
  serviceCode: string; serviceName: string; providerName: string | null; providerNif: string | null; mechanism: string;
  awardDate: string | null; amount: number | null; contractingBody: string | null; targetPopulation: string | null;
  callUrl: string | null; regulatoryBasisUrl: string | null; sourceReference: string;
};
export type ApprovedPage = { provisions: ApprovedProvision[]; allProvisionIds: string[]; total: number; page: number; pageCount: number; pageSize: number };
export type ApprovedSelection = string[];
