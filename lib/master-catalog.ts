import {independentConveniReadersEnabled,requireConsistentConveniReads} from './convenis/independent-read-guard';
import {hasUnitSchema,schemaSelect} from './runtime-schema';
import {visibleEntityRelation,visibleProvision} from './provision-visibility';
import {chunks,readAllPages} from './paginated-query';
import {groupByMasterCode,legacyMasterKey} from './master-association';
import {catalogProvisionPage,catalogSourceFinancingType} from './catalog-source';
import "server-only";
import type { CatalogFilters, MasterService, MasterServicePage } from "./catalog-types";
import { createServerSupabase } from "./records-page";

export const MASTER_PAGE_SIZE = 25;

export async function getMasterServicePage(filters: CatalogFilters): Promise<MasterServicePage> {
  const supabase = createServerSupabase();
  await requireConsistentConveniReads(supabase);const independent=independentConveniReadersEnabled();
  const safeQuery = filters.query.replaceAll(/[,%()]/g, " ").trim();

  let countRequest = supabase.from("master_services").select("id", { count: "exact", head: true });
  if (safeQuery) countRequest = countRequest.or(`service_code.ilike.%${safeQuery}%,service_name.ilike.%${safeQuery}%,sector_scope.ilike.%${safeQuery}%`);

  const [{ count, error: countError }, references] = await Promise.all([
    countRequest,
    readAllPages((from,to) => supabase.from("master_services").select("sector_scope,portfolio_status").order("id").range(from,to)),
  ]);
  if (countError) throw countError;

  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / MASTER_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const from = (page - 1) * MASTER_PAGE_SIZE;

  const currentSchema = hasUnitSchema();
  let request = supabase.from("master_services").select("id,service_code,service_name,sector_scope,portfolio_status,general_confidence,source_file,source_sheet,source_row,source_payload");
  if (safeQuery) request = request.or(`service_code.ilike.%${safeQuery}%,service_name.ilike.%${safeQuery}%,sector_scope.ilike.%${safeQuery}%`);

  const { data, error } = await request
    .order("source_row", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })
    .range(from, from + MASTER_PAGE_SIZE - 1);
  if (error) throw error;

  // The current FK points to historical_master_code, not the official code.
  // In pre-unit schemas, probe each table: that FK predates unit_id.
  let provisionKey:'historical_master_code'|'service_code'='historical_master_code';
  let relationKey:'historical_master_code'|'service_code'='historical_master_code';
  if (!currentSchema) {
    const [provisionProbe,relationProbe]=await Promise.all([
      supabase.from("service_provisions").select("historical_master_code").limit(0),
      supabase.from("entity_catalog_relations").select("historical_master_code").limit(0),
    ]);
    provisionKey=legacyMasterKey(provisionProbe.error);
    relationKey=legacyMasterKey(relationProbe.error);
  }
  const masterRows=(data ?? []) as unknown as Record<string,unknown>[];
  const codes=masterRows.map(row=>String(row.service_code));
  const provisions:Record<string,unknown>[]=[];
  const relations:Record<string,unknown>[]=[];
  for(const block of chunks(codes)) {
    const [provisionRows,relationRows]=await Promise.all([
      readAllPages((from,to)=>catalogProvisionPage(withSource=> {
        let query=(independent?supabase.rpc("conveni_independent_provisions"):supabase.from(currentSchema ? "conveni_reviewed_provisions" : "service_provisions"))
          .select(schemaSelect(`id,${provisionKey},superseded_at,source_id,call_url,regulatory_basis_url,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,source_reference${withSource?',source_records(financing_type)':''}`)).in(provisionKey,block);
        if(currentSchema) query=query.is("superseded_at",null);
        return query.order("id").range(from,to) as unknown as PromiseLike<{data:Record<string,unknown>[]|null;error:unknown}>;
      })),
      readAllPages((from,to)=> {
        let query=(independent?supabase.rpc("conveni_independent_entity_relations"):supabase.from("entity_catalog_relations"))
          .select(`id,${relationKey},entity_id,relation_type,source_reference,retired_at${independent ? ",entity_relation_is_current:conveni_independent_relation_current" : currentSchema ? ",entity_relation_is_current" : ""},entities(id,legal_name,nif)`).in(relationKey,block);
        if(currentSchema) query=query.eq(independent?"conveni_independent_relation_current":"entity_relation_is_current",true);
        return query.order("id").range(from,to) as unknown as PromiseLike<{data:Record<string,unknown>[]|null;error:unknown}>;
      }),
    ]);
    provisions.push(...(provisionRows as unknown as Record<string,unknown>[]).map(row=>currentSchema ? {...row,provision_is_current:true} : row));
    relations.push(...relationRows as unknown as Record<string,unknown>[]);
  }
  const provisionsByCode=groupByMasterCode(codes,provisions,provisionKey);
  const relationsByCode=groupByMasterCode(codes,relations,relationKey);
  const servicesWithRelations=masterRows.map(row=>({...row,
    service_provisions:provisionsByCode.get(String(row.service_code))??[],
    entity_catalog_relations:relationsByCode.get(String(row.service_code))??[],
  }));

  const scopes = uniqueSorted(references.map((row) => row.sector_scope));
  const statuses = uniqueSorted(references.map((row) => row.portfolio_status));
  const inside = references.filter((row) => row.portfolio_status === "Dentro").length;

  await requireConsistentConveniReads(supabase);
  return {
    services: servicesWithRelations.map(row => mapMasterService(row, !currentSchema)),
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

function mapMasterService(row: Record<string, unknown>, legacy: boolean): MasterService {
  return {
    id: String(row.id),
    serviceCode: String(row.service_code),
    serviceName: String(row.service_name),
    sectorScope: String(row.sector_scope ?? "Àmbit no informat"),
    portfolioStatus: String(row.portfolio_status ?? ""),
    generalConfidence: row.general_confidence == null ? null : Number(row.general_confidence),
    sourceFile: row.source_file == null ? null : String(row.source_file),
    sourceSheet: row.source_sheet == null ? null : String(row.source_sheet),
    sourceRow: row.source_row == null ? null : Number(row.source_row),
    sourcePayload: (row.source_payload ?? {}) as Record<string, unknown>,
    entityRelations: Array.isArray(row.entity_catalog_relations) ? row.entity_catalog_relations.filter(relation => visibleEntityRelation(relation,legacy)).map((relation) => {
      const item = relation as Record<string, unknown>;
      const rawEntity = item.entities;
      const entity = (Array.isArray(rawEntity) ? rawEntity[0] : rawEntity) as Record<string, unknown> | undefined;
      return { entityId: String(item.entity_id), legalName: String(entity?.legal_name ?? "Entitat"), nif: entity?.nif == null ? null : String(entity.nif), relationType: item.relation_type as "confirmed" | "auxiliary", sourceReference: String(item.source_reference) };
    }) : [],
    provisions: Array.isArray(row.service_provisions) ? row.service_provisions.filter(provision=>visibleProvision(provision,legacy)).map((provision) => {
      const item = provision as Record<string, unknown>;
      return {
        id: String(item.id), sourceId: String(item.source_id),
        financingType: catalogSourceFinancingType(item.source_records),
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
