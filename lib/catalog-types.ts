export type CatalogSort = "source_row" | "code" | "name";

export type MasterService = {
  id: string;
  serviceCode: string;
  serviceName: string;
  sectorScope: string;
  portfolioStatus: string;
  generalConfidence: number | null;
  sourceFile: string | null;
  sourceSheet: string | null;
  sourceRow: number | null;
  sourcePayload: Record<string, unknown>;
  provisions: ServiceProvision[];
  entityRelations: Array<{ entityId: string; legalName: string; nif: string | null; relationType: "confirmed" | "auxiliary"; sourceReference: string }>;
};

export type ServiceProvision = {
  id: string;
  sourceId: string;
  callUrl: string | null;
  regulatoryBasisUrl: string | null;
  providerName: string | null;
  providerNif: string | null;
  mechanism: string;
  awardDate: string | null;
  amount: number | null;
  contractingBody: string | null;
  targetPopulation: string | null;
  sourceReference: string;
};

export type MasterServicePage = {
  services: MasterService[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  metrics: { total: number; inside: number; outside: number; scopes: number };
  scopes: string[];
  statuses: string[];
};

export type CatalogFilters = {
  page: number;
  query: string;
  status: string;
  scope: string;
  sort: CatalogSort;
};
