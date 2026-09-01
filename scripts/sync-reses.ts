import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const API = "https://analisi.transparenciacatalunya.cat/resource/ivft-vegh.json";
const PAGE = 1000;
type Raw = Record<string, string | undefined>;

const normalizeNif = (value = "") => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const normalize = (value = "") => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const chunks = <T>(items: T[], size = 400) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

// The script intentionally uses the ungenerated Supabase schema, as migrations
// are the source of truth for this local PoC.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readEntityIndex(db: ReturnType<typeof createClient<any>>) {
  const result: Array<{ id: string; nif: string }> = [];
  for (let from = 0; ; from += PAGE) {
    const response = await db.from("entities").select("id,nif").not("nif", "is", null).range(from, from + PAGE - 1);
    if (response.error) throw response.error;
    const page = (response.data ?? []) as Array<{ id: string; nif: string }>;
    result.push(...page);
    if (page.length < PAGE) break;
  }
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rebuildExactLinks(db: ReturnType<typeof createClient<any>>, entityIds: Map<string, string>) {
  const mentions: Record<string, unknown>[] = [];
  const links: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const response = await db.from("source_records").select("id,provider_name,source_dataset,source_payload").order("id").range(from, from + PAGE - 1);
    if (response.error) throw response.error;
    for (const record of response.data ?? []) {
      if (!record.provider_name) continue;
      const payload = (record.source_payload ?? {}) as Record<string, unknown>;
      const nifValues = Object.entries(payload).filter(([key]) => /\b(nif|cif)\b/i.test(key)).map(([, value]) => normalizeNif(String(value ?? ""))).filter(Boolean);
      const exactNif = nifValues.find((nif) => entityIds.has(nif)) ?? null;
      const entityId = exactNif ? entityIds.get(exactNif)! : null;
      mentions.push({ source_record_id: record.id, raw_name: record.provider_name, normalized_name: normalize(record.provider_name), nif: exactNif, role: "provider", source: "source_record", entity_id: entityId, resolution_status: entityId ? "linked_by_nif" : "unresolved", evidence: entityId ? `NIF exacte ${exactNif}` : "Nom detectat sense NIF RESES exacte", updated_at: new Date().toISOString() });
      if (entityId) links.push({ source_record_id: record.id, entity_id: entityId, role: "provider", origin: "source", evidence: `NIF exacte ${exactNif}` });
    }
    if ((response.data ?? []).length < PAGE) break;
  }
  for (const part of chunks(mentions)) { const r = await db.from("entity_mentions").upsert(part, { onConflict: "source_record_id,normalized_name,role,source" }); if (r.error) throw r.error; }
  for (const part of chunks(links)) { const r = await db.from("source_record_entities").upsert(part, { onConflict: "source_record_id,entity_id,role,origin" }); if (r.error) throw r.error; }
  const provisions = await db.from("service_provisions").select("id,source_record_id,provider_nif,service_code").is("entity_id", null).not("provider_nif", "is", null);
  if (provisions.error) throw provisions.error;
  for (const provision of provisions.data ?? []) {
    const entityId = entityIds.get(normalizeNif(provision.provider_nif));
    if (!entityId) continue;
    const updated = await db.from("service_provisions").update({ entity_id: entityId }).eq("id", provision.id); if (updated.error) throw updated.error;
    const relation = await db.from("entity_catalog_relations").upsert({ entity_id: entityId, service_code: provision.service_code, relation_type: "confirmed", source_type: "provision", source_reference: provision.id, evidence: `Provisió aprovada; NIF exacte ${normalizeNif(provision.provider_nif)}` }, { onConflict: "entity_id,service_code,relation_type,source_type,source_reference" }); if (relation.error) throw relation.error;
  }
  return { mentions: mentions.length, exactLinks: links.length };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rebuildAuxiliaryRelations(db: ReturnType<typeof createClient<any>>, rows: Raw[], entityIds: Map<string, string>) {
  const catalog = await db.from("master_services").select("service_code,service_name");
  if (catalog.error) throw catalog.error;
  const byExactName = new Map<string, Array<{ service_code: string; service_name: string }>>();
  for (const service of catalog.data ?? []) {
    const key = normalize(service.service_name);
    byExactName.set(key, [...(byExactName.get(key) ?? []), service]);
  }
  const mappings = new Map<string, string>();
  for (const row of rows) {
    const candidates = byExactName.get(normalize(row.tipologia));
    if (row.tipologia && candidates?.length === 1) mappings.set(row.tipologia, candidates[0].service_code);
  }
  for (const [serviceType, serviceCode] of mappings) {
    const r = await db.from("reses_typology_catalog_mappings").upsert({ service_type: serviceType, service_code: serviceCode, method: "exact_name", review_status: "auxiliary", updated_at: new Date().toISOString() }, { onConflict: "service_type,service_code" }); if (r.error) throw r.error;
  }
  const relations = rows.flatMap((row) => {
    const code = row.tipologia ? mappings.get(row.tipologia) : null;
    const entityId = entityIds.get(normalizeNif(row.nif));
    return code && entityId ? [{ entity_id: entityId, service_code: code, relation_type: "auxiliary", source_type: "reses", source_reference: row.registre!, evidence: `Tipologia RESES exacta: ${row.tipologia}` }] : [];
  });
  for (const part of chunks(relations)) { const r = await db.from("entity_catalog_relations").upsert(part, { onConflict: "entity_id,service_code,relation_type,source_type,source_reference" }); if (r.error) throw r.error; }
  return relations.length;
}

async function fetchAll() {
  const rows: Raw[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `${API}?$limit=${PAGE}&$offset=${offset}&$order=registre`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`RESES HTTP ${response.status}`);
    const page = await response.json() as Raw[];
    rows.push(...page);
    process.stdout.write(`\rDescarregades ${rows.length} files`);
    if (page.length < PAGE) break;
  }
  process.stdout.write("\n");
  return rows;
}

async function main() {
  const rows = await fetchAll();
  const valid = rows.filter((r) => r.registre && r.nif && r.entitat_titular && r.nom);
  const registries = new Set(valid.map((r) => r.registre));
  const nifs = new Set(valid.map((r) => normalizeNif(r.nif)));
  const report = {
    source: API, retrievedAt: new Date().toISOString(), rows: rows.length,
    validRows: valid.length, uniqueRegistries: registries.size, uniqueNifs: nifs.size,
    missingRequired: rows.length - valid.length, duplicateRegistries: valid.length - registries.size,
    responseHash: hash(rows),
  };
  await mkdir("tmp", { recursive: true });
  await writeFile("tmp/reses-discovery.json", JSON.stringify(report, null, 2));
  console.log(report);
  if (!process.argv.includes("--import")) {
    console.log("Dry-run complet. Per importar: npm run reses:import -- --confirm-rows", report.uniqueRegistries, "--confirm-entities", report.uniqueNifs);
    return;
  }
  const valueAfter = (flag: string) => Number(process.argv[process.argv.indexOf(flag) + 1]);
  if (valueAfter("--confirm-rows") !== report.uniqueRegistries || valueAfter("--confirm-entities") !== report.uniqueNifs) {
    throw new Error("Els recomptes no han estat confirmats. Executa primer el dry-run i passa els dos valors exactes.");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Falten NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as never },
  });
  const started = await db.from("external_sync_runs").insert({ source: "reses", source_url: API, rows_read: rows.length, response_hash: report.responseHash }).select("id").single();
  if (started.error) throw started.error;
  try {
    const byNif = new Map<string, Raw[]>();
    for (const row of valid) {
      const nif = normalizeNif(row.nif);
      byNif.set(nif, [...(byNif.get(nif) ?? []), row]);
    }
    const current = await readEntityIndex(db);
    const ids = new Map(current.map((e) => [String(e.nif), String(e.id)]));
    const missing = [...byNif].filter(([nif]) => !ids.has(nif)).map(([nif, group]) => ({
      nif, legal_name: group[0].entitat_titular!, normalized_name: normalize(group[0].entitat_titular), qualification: group[0].qualificacio ?? null,
      validation_status: "reses_verified", active: true,
    }));
    for (const part of chunks(missing)) { const r = await db.from("entities").insert(part); if (r.error) throw r.error; }
    // Avoid a very long PostgREST URL: the local project may already contain
    // entities from an interrupted/idempotent run, so read the compact index.
    const refreshed = await readEntityIndex(db);
    for (const e of refreshed) ids.set(String(e.nif), String(e.id));
    const aliases = [...byNif].flatMap(([nif, group]) => {
      const unique = new Map(group.map((r) => [normalize(r.entitat_titular), r.entitat_titular!]));
      return [...unique].map(([normalizedAlias, alias]) => ({ entity_id: ids.get(nif)!, alias, normalized_alias: normalizedAlias, source: "reses", last_seen_at: report.retrievedAt }));
    });
    console.log(`Sincronitzant ${aliases.length} àlies...`);
    for (const part of chunks(aliases)) { const r = await db.from("entity_aliases").upsert(part, { onConflict: "entity_id,normalized_alias,source" }); if (r.error) throw r.error; }
    const deactivate = await db.from("reses_services").update({ active: false }).eq("active", true); if (deactivate.error) throw deactivate.error;
    const services = valid.map((r) => ({
      registry_number: r.registre!, entity_id: ids.get(normalizeNif(r.nif))!, service_name: r.nom!, service_type: r.tipologia ?? "No informada",
      registration_date: r.inscripcio?.slice(0, 10) || null, capacity: r.capacitat && /^\d+$/.test(r.capacitat) ? Number(r.capacitat) : null,
      address: r.adreca ?? null, municipality: r.municipi ?? null, postal_code: r.cp ?? null, county: r.comarca ?? null,
      active: true, source_payload: r, source_payload_hash: hash(r), retrieved_at: report.retrievedAt, updated_at: report.retrievedAt,
    }));
    console.log(`Sincronitzant ${services.length} serveis...`);
    for (const part of chunks(services)) { const r = await db.from("reses_services").upsert(part, { onConflict: "registry_number" }); if (r.error) throw r.error; }
    console.log("Recalculant relacions auxiliars...");
    const auxiliary = await rebuildAuxiliaryRelations(db, valid, ids);
    console.log("Reconstruint mencions i vincles exactes...");
    const exact = await rebuildExactLinks(db, ids);
    const finished = await db.from("external_sync_runs").update({ status: "completed", rows_written: services.length, entities_written: byNif.size, completed_at: new Date().toISOString() }).eq("id", started.data.id); if (finished.error) throw finished.error;
    console.log(`Importació completada: ${services.length} serveis, ${byNif.size} entitats, ${exact.mentions} mencions, ${exact.exactLinks} vincles exactes i ${auxiliary} relacions auxiliars.`);
  } catch (error) {
    await db.from("external_sync_runs").update({ status: "failed", error_message: error instanceof Error ? error.message : String(error), completed_at: new Date().toISOString() }).eq("id", started.data.id);
    throw error;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
