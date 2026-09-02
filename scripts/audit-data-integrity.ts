import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Falten les credencials de Supabase");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket as never } });

type Row = Record<string, unknown>;
type Finding = { severity: "critical" | "high" | "medium" | "low"; code: string; entity: string; count: number; ids: string[]; evidence: string };
const findings: Finding[] = [];
const add = (severity: Finding["severity"], code: string, entity: string, rows: Row[], evidence: string, id = "id") => {
  if (!rows.length) return;
  findings.push({ severity, code, entity, count: rows.length, ids: rows.slice(0, 25).map((row) => String(row[id] ?? "—")), evidence });
};
const blank = (value: unknown) => value == null || (typeof value === "string" && value.trim() === "");
const group = (rows: Row[], fields: string[]) => Object.fromEntries([...rows.reduce((map, row) => { const key = fields.map((field) => String(row[field] ?? "null")).join(" / "); map.set(key, (map.get(key) ?? 0) + 1); return map; }, new Map<string, number>())].sort());

async function all(table: string, select = "*") {
  const output: Row[] = [];
  const orderBy: Record<string, string> = {
    matching_candidate_evidence: "candidate_id",
    record_enrichment_evidence: "enrichment_id",
    source_record_entities: "source_record_id",
    excel_export_items: "export_id",
    reses_typology_catalog_mappings: "service_type",
    reses_services: "registry_number",
  };
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(select).order(orderBy[table] ?? "id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    output.push(...((data ?? []) as unknown as Row[]));
    if ((data?.length ?? 0) < 1000) break;
  }
  return output;
}

async function main() {
  const tables = await Promise.all([
    all("source_records"), all("source_documents"), all("evidence_chunks"), all("pipeline_runs"), all("pipeline_jobs"),
    all("worker_tasks"), all("record_enrichments"), all("record_enrichment_evidence"), all("matching_candidates"),
    all("matching_candidate_evidence"), all("matching_evaluations"), all("review_decisions"), all("service_provisions"),
    all("master_services"), all("import_runs"), all("external_sync_runs"), all("entities"), all("entity_aliases"),
    all("entity_mentions"), all("source_record_entities"), all("entity_catalog_relations"), all("reses_services"),
    all("reses_typology_catalog_mappings"), all("excel_exports"), all("excel_export_items"),
  ]);
  const [records, documents, chunks, runs, jobs, tasks, enrichments, enrichmentEvidence, candidates, candidateEvidence, evaluations, reviews, provisions, services, imports, syncs, entities, aliases, mentions, recordEntities, entityRelations, reses, resesMappings, exports, exportItems] = tables;
  const byId = (rows: Row[], field = "id") => new Map(rows.map((row) => [String(row[field]), row]));
  const documentById = byId(documents), chunkById = byId(chunks), jobById = byId(jobs), candidateById = byId(candidates), reviewById = byId(reviews), serviceByCode = byId(services, "service_code"), provisionById = byId(provisions), enrichmentById = byId(enrichments), exportById = byId(exports);
  const jobsByRecord = new Map<string, Row[]>(), candidatesByJob = new Map<string, Row[]>(), reviewsByRecord = new Map<string, Row[]>(), documentsByRecord = new Map<string, Row[]>(), chunksByDocument = new Map<string, Row[]>();
  for (const row of jobs) push(jobsByRecord, String(row.source_record_id), row);
  for (const row of candidates) push(candidatesByJob, String(row.pipeline_job_id), row);
  for (const row of reviews) push(reviewsByRecord, String(row.source_record_id), row);
  for (const row of documents) push(documentsByRecord, String(row.source_record_id), row);
  for (const row of chunks) push(chunksByDocument, String(row.source_document_id), row);

  add("high", "source_required_blank", "source_records", records.filter((r) => [r.source_dataset, r.source_record_id, r.mechanism, r.title].some(blank)), "Camps NOT NULL amb text buit.");
  add("high", "source_missing_provenance", "source_records", records.filter((r) => blank(r.source_payload_hash) || (r.source_dataset !== "concerts" && [r.source_file, r.source_sheet, r.source_row].some(blank))), "Falta hash del payload o ubicació de fila per a fonts Excel.");
  add("high", "source_missing_classification", "source_records", records.filter((r) => blank(r.financing_type) || blank(r.deduplication_key)), "Falta tipologia o identitat de deduplicació.");
  const supportedTypes = new Set(["contractacio", "conveni", "subvencio", "concert"]);
  add("medium", "source_unknown_type", "source_records", records.filter((r) => !supportedTypes.has(String(r.financing_type))), "Tipologia fora del flux operatiu actual.");
  const duplicateKeys = new Set([...records.reduce((m, r) => { const key = String(r.deduplication_key); m.set(key, (m.get(key) ?? 0) + 1); return m; }, new Map<string, number>())].filter(([, n]) => n > 1).map(([k]) => k));
  add("low", "source_duplicate_identity", "source_records", records.filter((r) => duplicateKeys.has(String(r.deduplication_key))), "Identitat normalitzada compartida; pot ser duplicat legítim o administratiu.");

  const allowedRecordStates: Record<string, (r: Row) => boolean> = {
    pendent: (r) => (jobsByRecord.get(String(r.id)) ?? []).length === 0,
    preparant: (r) => ["pending", "preparing"].includes(String(r.evidence_status)),
    preparat: (r) => r.evidence_status === "ready",
    processant: (r) => r.evidence_status === "ready" && r.enrichment_status === "completed",
    revisio: (r) => (jobsByRecord.get(String(r.id)) ?? []).some((j) => j.status === "needs_review" && (candidatesByJob.get(String(j.id)) ?? []).length > 0),
    completat: (r) => latest(reviewsByRecord.get(String(r.id)) ?? [])?.decision === "approved" || latest(reviewsByRecord.get(String(r.id)) ?? [])?.decision === "corrected",
    rebutjat: (r) => ["rejected", "insufficient_evidence"].includes(String(latest(reviewsByRecord.get(String(r.id)) ?? [])?.decision)),
    sense_evidencia: (r) => ["no_source", "unsupported"].includes(String(r.evidence_status)),
    error: (r) => r.evidence_status === "error" || r.enrichment_status === "error" || (jobsByRecord.get(String(r.id)) ?? []).some((j) => j.status === "error"),
  };
  add("high", "source_impossible_state", "source_records", records.filter((r) => !allowedRecordStates[String(r.processing_status)]?.(r)), "processing_status incompatible amb evidència, enriquiment, jobs o revisió.");
  add("medium", "source_stale_errors", "source_records", records.filter((r) => r.processing_status === "pendent" && (r.evidence_status === "error" || r.enrichment_status === "error")), "Registre pendent conserva un error de fase anterior o d'importació.");
  add("high", "source_ready_without_chunks", "source_records", records.filter((r) => r.evidence_status === "ready" && !(documentsByRecord.get(String(r.id)) ?? []).some((d) => d.status === "fetched" && (chunksByDocument.get(String(d.id)) ?? []).length > 0)), "Evidència marcada ready sense fragments útils.");
  add("high", "source_enriched_without_row", "source_records", records.filter((r) => r.enrichment_status === "completed" && !enrichments.some((e) => e.source_record_id === r.id)), "Enriquiment completat sense record_enrichments.");

  add("high", "document_required_blank", "source_documents", documents.filter((d) => [d.url, d.url_hash, d.document_type].some(blank)), "URL, hash o tipus documental buit.");
  add("high", "document_fetch_incomplete", "source_documents", documents.filter((d) => d.status === "fetched" && (blank(d.content_hash) || blank(d.extracted_text_hash) || Number(d.text_length ?? 0) <= 0 || blank(d.extraction_method))), "Document fetched sense metadades d'extracció completes.");
  add("high", "document_chunk_count_mismatch", "source_documents", documents.filter((d) => Number(d.chunk_count) !== (chunksByDocument.get(String(d.id)) ?? []).length), "chunk_count no coincideix amb evidence_chunks.");
  add("medium", "document_status_metadata_mismatch", "source_documents", documents.filter((d) => (d.status === "error" && blank(d.error_message)) || (d.status === "fetched" && d.fetched_at == null) || (d.status !== "fetched" && Number(d.chunk_count) > 0)), "Metadades incompatibles amb l'estat documental.");
  add("high", "chunk_content_mismatch", "evidence_chunks", chunks.filter((c) => blank(c.content) || Number(c.character_count) !== String(c.content ?? "").length || blank(c.content_hash)), "Contingut, longitud o hash de fragment incoherent.");

  const allowedJob = new Set(["selected", "queued", "preparing", "ready", "matching", "needs_review", "approved", "corrected", "rejected", "insufficient_evidence", "error"]);
  const allowedPrep = new Set(["pending", "discovering", "fetching", "chunking", "ready", "no_source", "unsupported", "error"]);
  add("critical", "job_unknown_status", "pipeline_jobs", jobs.filter((j) => !allowedJob.has(String(j.status)) || !allowedPrep.has(String(j.preparation_status))), "Estat de job o preparació no reconegut pel codi.");
  add("high", "job_state_mismatch", "pipeline_jobs", jobs.filter((j) => (["ready", "matching", "needs_review", "approved", "corrected", "rejected", "insufficient_evidence"].includes(String(j.status)) && j.preparation_status !== "ready") || (j.status === "needs_review" && !(candidatesByJob.get(String(j.id)) ?? []).length) || (["approved", "corrected", "rejected", "insufficient_evidence"].includes(String(j.status)) && !latest(reviewsByRecord.get(String(j.source_record_id)) ?? []))), "Job incompatible amb preparació, candidats o decisió humana.");
  add("medium", "job_completion_timestamp_mismatch", "pipeline_jobs", jobs.filter((j) => (["needs_review", "approved", "corrected", "rejected", "insufficient_evidence", "error"].includes(String(j.status)) && j.completed_at == null) || (["selected", "queued", "preparing", "ready", "matching"].includes(String(j.status)) && j.completed_at != null)), "completed_at incompatible amb l'estat del job.");

  const allowedRun = new Set(["draft", "queued", "preparing", "ready", "enriching", "matching", "needs_review", "completed", "preparation_error", "matching_error", "processing_error"]);
  const allowedStage = new Set(["selection", "preparation", "confirmation", "enrichment", "matching", "review", "completed"]);
  add("critical", "run_unknown_status_stage", "pipeline_runs", runs.filter((r) => !allowedRun.has(String(r.status)) || !allowedStage.has(String(r.stage))), "Estat o fase de lot no reconegut pel codi.");
  const jobsByRun = new Map<string, Row[]>(); for (const row of jobs) push(jobsByRun, String(row.run_id), row);
  add("high", "run_counter_mismatch", "pipeline_runs", runs.filter((r) => { const list = jobsByRun.get(String(r.id)) ?? []; return Number(r.selected_count) !== list.length || Number(r.ready_count) !== list.filter((j) => ["ready", "matching", "needs_review", "approved", "corrected", "rejected", "insufficient_evidence"].includes(String(j.status)) || j.preparation_status === "ready").length || Number(r.processed_count) !== list.filter((j) => (candidatesByJob.get(String(j.id)) ?? []).length > 0).length || Number(r.review_count) !== list.filter((j) => j.status === "needs_review").length || Number(r.error_count) !== list.filter((j) => j.status === "error").length; }), "Comptadors persistits no coincideixen amb jobs i candidats.");
  add("high", "run_state_stage_mismatch", "pipeline_runs", runs.filter((r) => (r.status === "needs_review" && r.stage !== "review") || (r.status === "completed" && r.stage !== "completed") || (["queued", "preparing", "preparation_error"].includes(String(r.status)) && !["selection", "preparation"].includes(String(r.stage))) || (r.status === "enriching" && r.stage !== "enrichment") || (["matching", "matching_error"].includes(String(r.status)) && r.stage !== "matching")), "Combinació status/stage incompatible amb el flux.");
  add("medium", "run_completion_timestamp_mismatch", "pipeline_runs", runs.filter((r) => (r.status === "completed" && (r.completed_at == null || r.processing_completed_at == null)) || (["queued", "preparing", "enriching", "matching"].includes(String(r.status)) && (r.completed_at != null || r.processing_completed_at != null)) || (r.status === "needs_review" && (r.completed_at != null || r.processing_completed_at == null))), "completed_at o processing_completed_at incompatible amb l'estat del lot.");

  add("high", "enrichment_required_blank", "record_enrichments", enrichments.filter((e) => [e.summary, e.engine, e.engine_version].some(blank)), "Enriquiment sense resum o motor.");
  const enrichmentEvidenceByEnrichment = new Map<string, Row[]>(); for (const row of enrichmentEvidence) push(enrichmentEvidenceByEnrichment, String(row.enrichment_id), row);
  add("medium", "enrichment_without_evidence", "record_enrichments", enrichments.filter((e) => !(enrichmentEvidenceByEnrichment.get(String(e.id)) ?? []).length), "Enriquiment sense fragment citat.");
  add("critical", "enrichment_cross_record_evidence", "record_enrichment_evidence", enrichmentEvidence.filter((link) => { const enrichment = enrichmentById.get(String(link.enrichment_id)), chunk = chunkById.get(String(link.evidence_chunk_id)), document = chunk && documentById.get(String(chunk.source_document_id)); return !enrichment || !document || enrichment.source_record_id !== document.source_record_id; }), "Fragment d'enriquiment pertany a un altre registre.", "enrichment_id");

  add("high", "candidate_required_blank", "matching_candidates", candidates.filter((c) => [c.target_catalog, c.target_code, c.target_name, c.rationale, c.engine, c.engine_version].some(blank)), "Candidat sense camps obligatoris útils.");
  add("high", "candidate_catalog_mismatch", "matching_candidates", candidates.filter((c) => !serviceByCode.has(String(c.target_code)) || serviceByCode.get(String(c.target_code))?.service_name !== c.target_name), "Codi inexistent o denominació diferent del catàleg.");
  const ranksByJob = new Map<string, number[]>(); for (const row of candidates) { const key = String(row.pipeline_job_id); ranksByJob.set(key, [...(ranksByJob.get(key) ?? []), Number(row.rank)]); }
  add("medium", "candidate_rank_mismatch", "pipeline_jobs", jobs.filter((j) => { const ranks = (ranksByJob.get(String(j.id)) ?? []).sort((a,b) => a-b); return ranks.length > 3 || ranks.some((rank, i) => rank !== i + 1); }), "Ranks no contigus o més de tres candidats.");
  const candidateEvidenceByCandidate = new Map<string, Row[]>(); for (const row of candidateEvidence) push(candidateEvidenceByCandidate, String(row.candidate_id), row);
  add("high", "candidate_without_evidence", "matching_candidates", candidates.filter((c) => !(candidateEvidenceByCandidate.get(String(c.id)) ?? []).length), "Candidat sense fragments de suport.");
  add("critical", "candidate_cross_record_evidence", "matching_candidate_evidence", candidateEvidence.filter((link) => { const candidate = candidateById.get(String(link.candidate_id)), job = candidate && jobById.get(String(candidate.pipeline_job_id)), chunk = chunkById.get(String(link.evidence_chunk_id)), document = chunk && documentById.get(String(chunk.source_document_id)); return !job || !document || job.source_record_id !== document.source_record_id; }), "Evidència del candidat pertany a un altre registre.", "candidate_id");

  add("high", "review_code_mismatch", "review_decisions", reviews.filter((r) => (["approved", "corrected"].includes(String(r.decision)) && (blank(r.final_code) || !serviceByCode.has(String(r.final_code)))) || (["rejected", "insufficient_evidence"].includes(String(r.decision)) && !blank(r.final_code))), "Decisió i codi final incompatibles.");
  add("medium", "review_missing_actor", "review_decisions", reviews.filter((r) => blank(r.reviewer)), "Decisió sense identificador de revisor.");
  add("high", "evaluation_candidate_job_mismatch", "matching_evaluations", evaluations.filter((e) => e.candidate_id && candidateById.get(String(e.candidate_id))?.pipeline_job_id !== e.pipeline_job_id), "Avaluació apunta a candidat d'un altre job.");

  add("critical", "provision_without_positive_review", "service_provisions", provisions.filter((p) => { const latestReview = latest(reviewsByRecord.get(String(p.source_record_id)) ?? []); return !latestReview || !["approved", "corrected"].includes(String(latestReview.decision)) || p.service_code !== latestReview.final_code; }), "Provisió sense decisió positiva vigent o amb codi diferent.");
  add("high", "provision_reference_mismatch", "service_provisions", provisions.filter((p) => (p.review_decision_id && reviewById.get(String(p.review_decision_id))?.source_record_id !== p.source_record_id) || (p.matching_candidate_id && jobById.get(String(candidateById.get(String(p.matching_candidate_id))?.pipeline_job_id))?.source_record_id !== p.source_record_id)), "Decisió o candidat enllaçat pertany a un altre registre.");
  add("high", "provision_required_blank", "service_provisions", provisions.filter((p) => [p.source_id, p.mechanism, p.source_reference, p.service_code].some(blank)), "Provisió sense camps obligatoris útils.");
  add("medium", "provision_missing_trace_url", "service_provisions", provisions.filter((p) => blank(p.call_url) && blank(p.regulatory_basis_url)), "Provisió sense URL de convocatòria ni bases.");

  add("high", "mention_resolution_mismatch", "entity_mentions", mentions.filter((m) => (["linked_by_nif", "manually_linked"].includes(String(m.resolution_status)) && !m.entity_id) || (["unresolved", "rejected"].includes(String(m.resolution_status)) && m.entity_id)), "Resolució de menció incompatible amb entity_id.");
  add("medium", "entity_required_blank", "entities", entities.filter((e) => blank(e.legal_name) || blank(e.normalized_name)), "Entitat sense nom útil.");
  add("medium", "alias_required_blank", "entity_aliases", aliases.filter((a) => blank(a.alias) || blank(a.normalized_alias) || blank(a.source)), "Àlies sense nom normalitzat o font.");
  add("high", "record_entity_missing_evidence", "source_record_entities", recordEntities.filter((r) => blank(r.evidence)), "Relació registre-entitat sense evidència textual.", "source_record_id");
  add("high", "entity_relation_source_mismatch", "entity_catalog_relations", entityRelations.filter((r) => (r.source_type === "provision" && !provisions.some((p) => p.entity_id === r.entity_id && p.service_code === r.service_code)) || (r.source_type === "reses" && !reses.some((s) => s.entity_id === r.entity_id))), "Relació catàleg-entitat sense font corresponent.");
  add("high", "reses_required_blank", "reses_services", reses.filter((r) => [r.registry_number, r.service_name, r.service_type, r.source_payload_hash, r.retrieved_at].some(blank)), "Registre RESES sense camps de font obligatoris.", "registry_number");
  add("medium", "reses_mapping_unknown_service", "reses_typology_catalog_mappings", resesMappings.filter((r) => !serviceByCode.has(String(r.service_code))), "Mapatge RESES apunta a codi de servei inexistent.", "service_type");

  const itemsByExport = new Map<string, Row[]>(); for (const row of exportItems) push(itemsByExport, String(row.export_id), row);
  add("high", "export_count_mismatch", "excel_exports", exports.filter((e) => Number(e.provision_count) !== (itemsByExport.get(String(e.id)) ?? []).length), "provision_count no coincideix amb excel_export_items.");
  add("high", "export_item_missing_provision", "excel_export_items", exportItems.filter((i) => !provisionById.has(String(i.provision_id)) || !exportById.has(String(i.export_id))), "Element d'exportació orfe.", "export_id");
  add("medium", "import_run_state_mismatch", "import_runs", imports.filter((r) => (r.status === "running" && r.completed_at != null) || (["completed", "failed"].includes(String(r.status)) && r.completed_at == null) || (r.status === "failed" && blank(r.error_message))), "Execució d'importació amb timestamps o error incoherents.");
  add("medium", "sync_run_state_mismatch", "external_sync_runs", syncs.filter((r) => (r.status === "running" && r.completed_at != null) || (["completed", "failed"].includes(String(r.status)) && r.completed_at == null) || (r.status === "failed" && blank(r.error_message))), "Sincronització externa amb timestamps o error incoherents.");
  add("high", "worker_state_mismatch", "worker_tasks", tasks.filter((t) => (t.status === "queued" && (t.claimed_at || t.completed_at)) || (t.status === "running" && (!t.claimed_at || t.completed_at)) || (["completed", "failed"].includes(String(t.status)) && !t.completed_at) || (t.status === "failed" && blank(t.error_message))), "Tasca worker amb propietari, timestamps o error incompatibles.");

  const tableCounts = Object.fromEntries(["source_records","source_documents","evidence_chunks","pipeline_runs","pipeline_jobs","worker_tasks","record_enrichments","record_enrichment_evidence","matching_candidates","matching_candidate_evidence","matching_evaluations","review_decisions","service_provisions","master_services","import_runs","external_sync_runs","entities","entity_aliases","entity_mentions","source_record_entities","entity_catalog_relations","reses_services","reses_typology_catalog_mappings","excel_exports","excel_export_items"].map((name, i) => [name, tables[i].length]));
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), scope: "remote public schema; full pagination", tableCounts, distributions: { sourceRecords: group(records, ["source_dataset", "financing_type", "processing_status", "evidence_status", "enrichment_status"]), pipelineJobs: group(jobs, ["status", "preparation_status"]), pipelineRuns: group(runs, ["status", "stage"]), workerTasks: group(tasks, ["task_type", "status"]), documents: group(documents, ["status", "document_type"]), reviews: group(reviews, ["decision"]) }, findings: findings.sort((a,b) => severity(b.severity) - severity(a.severity) || b.count - a.count) }, null, 2));
}

function push(map: Map<string, Row[]>, key: string, value: Row) { map.set(key, [...(map.get(key) ?? []), value]); }
function latest(rows: Row[]) { return [...rows].sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))[0]; }
function severity(value: Finding["severity"]) { return { low: 1, medium: 2, high: 3, critical: 4 }[value]; }
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
