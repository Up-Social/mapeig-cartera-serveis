import {independentConveniReadersEnabled,requireConsistentConveniReads} from './convenis/independent-read-guard';
import "server-only";
import { createServerSupabase } from "./records-page";
import type { Entity, EntityFilters, EntityPage } from "./entity-types";
import {hasUnitSchema} from './runtime-schema';
import {visibleEntityRelation} from './provision-visibility';
import {readAllPages} from './paginated-query';

const PAGE_SIZE = 25;
export async function getEntityPage(filters: EntityFilters): Promise<EntityPage> {
  const db = createServerSupabase();
  await requireConsistentConveniReads(db);const independent=independentConveniReadersEnabled();
  const currentSchema = hasUnitSchema();
  const q = filters.query.replaceAll(/[,%()]/g, " ").trim();
  let countQuery = db.from("entities").select("id", { count: "exact", head: true }).eq("active", true);
  let query = db.from("entities").select("id,legal_name,nif,qualification,validation_status,active").eq("active", true);
  if (q) { countQuery = countQuery.or(`legal_name.ilike.%${q}%,nif.ilike.%${q}%`); query = query.or(`legal_name.ilike.%${q}%,nif.ilike.%${q}%`); }
  if (filters.qualification !== "totes") { countQuery = countQuery.eq("qualification", filters.qualification); query = query.eq("qualification", filters.qualification); }
  if (filters.county !== "totes") {
    const ids = await db.from("reses_services").select("entity_id").eq("county", filters.county);
    if (ids.error) throw ids.error;
    const entityIds = [...new Set((ids.data ?? []).map((r) => r.entity_id).filter(Boolean))];
    const filteredIds = entityIds.length ? entityIds : ["00000000-0000-0000-0000-000000000000"];
    countQuery = countQuery.in("id", filteredIds);
    query = query.in("id", filteredIds);
  }
  const [{ count, error: countError }, facets, resesCount, linkedCount, confirmedCount, pendingCount, pendingHolders] = await Promise.all([
    countQuery,
    db.rpc("entity_directory_facets"),
    db.from("reses_services").select("registry_number", { count: "exact", head: true }),
    db.from("source_record_entities").select("source_record_id", { count: "exact", head: true }),
    independent
      ? db.rpc('conveni_independent_entity_relations',{}, {count:'exact',head:true}).select('entity_id').eq('relation_type','confirmed').eq('conveni_independent_relation_current',true)
      : currentSchema
      ? db.from("entity_catalog_relations").select("entity_id", { count: "exact", head: true }).eq("relation_type", "confirmed").eq("entity_relation_is_current", true)
      : db.from("entity_catalog_relations").select("entity_id", { count: "exact", head: true }).eq("relation_type", "confirmed").is("retired_at", null),
    db.from("entity_mentions").select("id", { count: "exact", head: true }).eq("resolution_status", "unresolved"),
    db.from("reses_services").select("registry_number", { count: "exact", head: true }).is("entity_id", null),
  ]);
  if (countError) throw countError;
  if (facets.error) throw facets.error;
  if (confirmedCount.error) throw confirmedCount.error;
  if (resesCount.error) throw resesCount.error;
  if (linkedCount.error) throw linkedCount.error;
  if (pendingCount.error) throw pendingCount.error;
  if (pendingHolders.error) throw pendingHolders.error;
  const rawTotal = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(rawTotal / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const data = await query.order("legal_name").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (data.error) throw data.error;
  const ids = (data.data ?? []).map((r) => r.id);
  const [aliases, services, relationRows, links, provisions] = ids.length ? await Promise.all([
    readAllPages((from,to) => db.from("entity_aliases").select("entity_id,alias,source").in("entity_id",ids).order("entity_id").order("normalized_alias").order("source").range(from,to)),
    readAllPages((from,to) => db.from("reses_services").select("entity_id,registry_number,service_name,service_type,capacity,address,municipality,postal_code,county,active").in("entity_id",ids).order("service_name").order("registry_number").range(from,to)),
    readAllPages((from,to) => {
      let query = (independent?db.rpc("conveni_independent_entity_relations"):db.from("entity_catalog_relations")).select(`id,entity_id,service_code,relation_type,source_type${independent ? ",entity_relation_is_current:conveni_independent_relation_current" : currentSchema ? ",entity_relation_is_current" : ""},master_services(service_name),official_services(service_name)`).in("entity_id",ids).is("retired_at",null);
      if (currentSchema) query = query.eq(independent?"conveni_independent_relation_current":"entity_relation_is_current",true);
      return query.order("id").range(from,to) as unknown as PromiseLike<{data:Record<string,unknown>[]|null;error:unknown}>;
    }) as unknown as Promise<Array<{
      entity_id: string; service_code: string; relation_type: string; source_type: string;
      entity_relation_is_current?: boolean; official_services: {service_name?: string} | Array<{service_name?: string}> | null; master_services: {service_name?: string} | Array<{service_name?: string}> | null;
    }>>,
    readAllPages((from,to) => db.from("source_record_entities").select("entity_id").in("entity_id",ids).order("entity_id").order("source_record_id").order("role").order("origin").range(from,to)),
    readAllPages((from,to) => {
      let query = (independent?db.rpc("conveni_independent_provisions"):db.from(currentSchema ? "conveni_reviewed_provisions" : "service_provisions")).select("id,entity_id").in("entity_id",ids);
      if (currentSchema) query = query.is("superseded_at",null);
      return query.order("id").range(from,to) as unknown as PromiseLike<{data:Array<{entity_id:string}>|null;error:unknown}>;
    }),
  ]) : [[], [], [], [], []];
  const entities: Entity[] = (data.data ?? []).map((row) => ({
    id: row.id, legalName: row.legal_name, nif: row.nif, qualification: row.qualification, validationStatus: row.validation_status, active: row.active,
    aliases: aliases.filter((x) => x.entity_id === row.id).map((x) => ({ alias: x.alias, source: x.source })),
    services: services.filter((x) => x.entity_id === row.id).map((x) => ({ registryNumber: x.registry_number, serviceName: x.service_name, serviceType: x.service_type, capacity: x.capacity, address: x.address, municipality: x.municipality, postalCode: x.postal_code, county: x.county, active: x.active })),
    catalogRelations: relationRows.filter((x) => x.entity_id === row.id && visibleEntityRelation(x,!currentSchema)).map((x) => ({ serviceCode: x.service_code, relationType: x.relation_type as "confirmed" | "auxiliary", sourceType: x.source_type as "provision" | "reses", serviceName: (() => { const service = x.official_services ?? x.master_services; return Array.isArray(service) ? service[0]?.service_name ?? null : service?.service_name ?? null; })() })),
    linkedRecords: links.filter((x) => x.entity_id === row.id).length,
    provisions: provisions.filter((x) => x.entity_id === row.id).length,
  }));
  const facetData = (facets.data ?? {}) as { qualifications?: string[]; counties?: string[] };
  const qualifications = facetData.qualifications ?? [];
  const counties = facetData.counties ?? [];
  await requireConsistentConveniReads(db);
  return { entities, total: rawTotal, page, pageCount, pageSize: PAGE_SIZE, qualifications, counties, metrics: { total: rawTotal, withReses: resesCount.count ?? 0, linkedRecords: linkedCount.count ?? 0, confirmed: confirmedCount.count ?? 0, pendingMentions: pendingCount.count ?? 0, pendingHolders: pendingHolders.count ?? 0 } };
}
