import "server-only";
import type { CatalogFilters, MasterService, MasterServicePage } from "./catalog-types";
import { createServerSupabase } from "./records-page";

export const MASTER_PAGE_SIZE = 25;

export async function getMasterServicePage(filters: CatalogFilters): Promise<MasterServicePage> {
  const supabase = createServerSupabase();
  const safeQuery = filters.query.replaceAll(/[,%()]/g, " ").trim();

  let countRequest = supabase.from("master_services").select("id", { count: "exact", head: true });
  if (safeQuery) countRequest = countRequest.or(`service_code.ilike.%${safeQuery}%,service_name.ilike.%${safeQuery}%,sector_scope.ilike.%${safeQuery}%`);

  const [{ count, error: countError }, referenceResult] = await Promise.all([
    countRequest,
    supabase.from("master_services").select("sector_scope,portfolio_status"),
  ]);
  if (countError) throw countError;
  if (referenceResult.error) throw referenceResult.error;

  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / MASTER_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const from = (page - 1) * MASTER_PAGE_SIZE;

  let request = supabase.from("master_services").select("id,service_code,service_name,sector_scope,portfolio_status,general_confidence,source_file,source_sheet,source_row,source_payload,service_provisions(id,source_id,call_url,regulatory_basis_url,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,source_reference),entity_catalog_relations(entity_id,relation_type,source_reference,entities(id,legal_name,nif))");
  if (safeQuery) request = request.or(`service_code.ilike.%${safeQuery}%,service_name.ilike.%${safeQuery}%,sector_scope.ilike.%${safeQuery}%`);

  const { data, error } = await request
    .order("source_row", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })
    .range(from, from + MASTER_PAGE_SIZE - 1);
  if (error) throw error;

  const references = referenceResult.data ?? [];
  const scopes = uniqueSorted(references.map((row) => row.sector_scope));
  const statuses = uniqueSorted(references.map((row) => row.portfolio_status));
  const inside = references.filter((row) => row.portfolio_status === "Dentro").length;

  return {
    services: (data ?? []).map(mapMasterService),
    total,
    page,
    pageCount,
    pageSize: MASTER_PAGE_SIZE,
    metrics: { total: references.length, inside, outside: references.length - inside, scopes: scopes.length },
    scopes,
    statuses,
  };
}

function uniqueSorted(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "ca"));
}

function mapMasterService(row: Record<string, unknown>): MasterService {
  return {
    id: String(row.id),
    serviceCode: String(row.service_code),
    serviceName: String(row.service_name),
    sectorScope: String(row.sector_scope),
    portfolioStatus: String(row.portfolio_status),
    generalConfidence: row.general_confidence == null ? null : Number(row.general_confidence),
    sourceFile: row.source_file == null ? null : String(row.source_file),
    sourceSheet: row.source_sheet == null ? null : String(row.source_sheet),
    sourceRow: row.source_row == null ? null : Number(row.source_row),
    sourcePayload: (row.source_payload ?? {}) as Record<string, unknown>,
    entityRelations: Array.isArray(row.entity_catalog_relations) ? row.entity_catalog_relations.map((relation) => {
      const item = relation as Record<string, unknown>;
      const rawEntity = item.entities;
      const entity = (Array.isArray(rawEntity) ? rawEntity[0] : rawEntity) as Record<string, unknown> | undefined;
      return { entityId: String(item.entity_id), legalName: String(entity?.legal_name ?? "Entitat"), nif: entity?.nif == null ? null : String(entity.nif), relationType: item.relation_type as "confirmed" | "auxiliary", sourceReference: String(item.source_reference) };
    }) : [],
    provisions: Array.isArray(row.service_provisions) ? row.service_provisions.map((provision) => {
      const item = provision as Record<string, unknown>;
      return {
        id: String(item.id), sourceId: String(item.source_id),
        callUrl: item.call_url == null ? null : String(item.call_url),
        regulatoryBasisUrl: item.regulatory_basis_url == null ? null : String(item.regulatory_basis_url),
        providerName: item.provider_name == null ? null : String(item.provider_name),
        providerNif: item.provider_nif == null ? null : String(item.provider_nif),
        mechanism: String(item.mechanism), awardDate: item.award_date == null ? null : String(item.award_date),
        amount: item.amount == null ? null : Number(item.amount),
        contractingBody: item.contracting_body == null ? null : String(item.contracting_body),
        targetPopulation: item.target_population == null ? null : String(item.target_population),
        sourceReference: String(item.source_reference),
      };
    }) : [],
  };
}
