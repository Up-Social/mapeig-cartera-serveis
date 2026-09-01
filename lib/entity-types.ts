export type EntityFilters = { page: number; query: string; qualification: string; county: string };
export type EntityAlias = { alias: string; source: string };
export type ResesService = { registryNumber: string; serviceName: string; serviceType: string; capacity: number | null; address: string | null; municipality: string | null; postalCode: string | null; county: string | null; active: boolean };
export type EntityCatalogRelation = { serviceCode: string; relationType: "confirmed" | "auxiliary"; sourceType: "provision" | "reses"; serviceName: string | null };
export type Entity = { id: string; legalName: string; nif: string | null; qualification: string | null; validationStatus: string; active: boolean; aliases: EntityAlias[]; services: ResesService[]; catalogRelations: EntityCatalogRelation[]; linkedRecords: number; provisions: number };
export type EntityPage = { entities: Entity[]; total: number; page: number; pageCount: number; pageSize: number; qualifications: string[]; counties: string[]; metrics: { total: number; withReses: number; linkedRecords: number; confirmed: number; pendingMentions: number } };
