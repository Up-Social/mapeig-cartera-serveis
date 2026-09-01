import "server-only";
import { createServerSupabase } from "./records-page";
import type { Entity, EntityFilters, EntityPage } from "./entity-types";

const PAGE_SIZE = 25;
export async function getEntityPage(filters: EntityFilters): Promise<EntityPage> {
  const db = createServerSupabase();
  const q = filters.query.replaceAll(/[,%()]/g, " ").trim();
  let countQuery = db.from("entities").select("id", { count: "exact", head: true });
  let query = db.from("entities").select("id,legal_name,nif,qualification,validation_status,active");
  if (q) { countQuery = countQuery.or(`legal_name.ilike.%${q}%,nif.ilike.%${q}%`); query = query.or(`legal_name.ilike.%${q}%,nif.ilike.%${q}%`); }
  if (filters.qualification !== "totes") { countQuery = countQuery.eq("qualification", filters.qualification); query = query.eq("qualification", filters.qualification); }
  const [{ count, error: countError }, refs, resesCount, linkedCount, confirmedCount, pendingCount] = await Promise.all([
    countQuery,
    db.from("reses_services").select("county,entities!inner(qualification)"),
    db.from("reses_services").select("registry_number", { count: "exact", head: true }),
    db.from("source_record_entities").select("source_record_id", { count: "exact", head: true }),
    db.from("entity_catalog_relations").select("entity_id", { count: "exact", head: true }).eq("relation_type", "confirmed"),
    db.from("entity_mentions").select("id", { count: "exact", head: true }).eq("resolution_status", "unresolved"),
  ]);
  if (countError) throw countError;
  if (filters.county !== "totes") {
    const ids = await db.from("reses_services").select("entity_id").eq("county", filters.county);
    if (ids.error) throw ids.error;
    const entityIds = [...new Set((ids.data ?? []).map((r) => r.entity_id))];
    query = query.in("id", entityIds.length ? entityIds : ["00000000-0000-0000-0000-000000000000"]);
  }
  const rawTotal = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(rawTotal / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const data = await query.order("legal_name").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (data.error) throw data.error;
  const ids = (data.data ?? []).map((r) => r.id);
  const [aliases, services, relations, links, provisions] = ids.length ? await Promise.all([
    db.from("entity_aliases").select("entity_id,alias,source").in("entity_id", ids),
    db.from("reses_services").select("entity_id,registry_number,service_name,service_type,capacity,address,municipality,postal_code,county,active").in("entity_id", ids).order("service_name"),
    db.from("entity_catalog_relations").select("entity_id,service_code,relation_type,source_type,master_services(service_name)").in("entity_id", ids),
    db.from("source_record_entities").select("entity_id").in("entity_id", ids),
    db.from("service_provisions").select("entity_id").in("entity_id", ids),
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const entities: Entity[] = (data.data ?? []).map((row) => ({
    id: row.id, legalName: row.legal_name, nif: row.nif, qualification: row.qualification, validationStatus: row.validation_status, active: row.active,
    aliases: (aliases.data ?? []).filter((x) => x.entity_id === row.id).map((x) => ({ alias: x.alias, source: x.source })),
    services: (services.data ?? []).filter((x) => x.entity_id === row.id).map((x) => ({ registryNumber: x.registry_number, serviceName: x.service_name, serviceType: x.service_type, capacity: x.capacity, address: x.address, municipality: x.municipality, postalCode: x.postal_code, county: x.county, active: x.active })),
    catalogRelations: (relations.data ?? []).filter((x) => x.entity_id === row.id).map((x) => ({ serviceCode: x.service_code, relationType: x.relation_type as "confirmed" | "auxiliary", sourceType: x.source_type as "provision" | "reses", serviceName: Array.isArray(x.master_services) ? x.master_services[0]?.service_name ?? null : (x.master_services as { service_name?: string } | null)?.service_name ?? null })),
    linkedRecords: (links.data ?? []).filter((x) => x.entity_id === row.id).length,
    provisions: (provisions.data ?? []).filter((x) => x.entity_id === row.id).length,
  }));
  const referenceRows = refs.data ?? [];
  const qualifications = [...new Set(referenceRows.map((r) => (r.entities as unknown as { qualification?: string })?.qualification).filter(Boolean) as string[])].sort();
  const counties = [...new Set(referenceRows.map((r) => r.county).filter(Boolean) as string[])].sort();
  return { entities, total: rawTotal, page, pageCount, pageSize: PAGE_SIZE, qualifications, counties, metrics: { total: rawTotal, withReses: resesCount.count ?? 0, linkedRecords: linkedCount.count ?? 0, confirmed: confirmedCount.count ?? 0, pendingMentions: pendingCount.count ?? 0 } };
}
