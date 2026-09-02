import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { ProcessingStatus, ReviewQueue, SourcePage, SourceRecord } from "./workbench-types";
import { mapLatestMatchingError } from "./matching-state";
import { latestJobsByRecord, newestProcessedFirst, summarizeLatestJobs } from "./latest-job-state";

export const PAGE_SIZE = 25;

export function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Falten les variables de Supabase a .env.local");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function getSourcePage(input: { page: number; query: string; type: string; status: string }): Promise<SourcePage> {
  const supabase = createServerSupabase();
  const from = (input.page - 1) * PAGE_SIZE;
  let request = supabase.from("source_records").select(RECORD_SELECT, { count: "exact" });
  if (input.type !== "totes") request = request.eq("financing_type", input.type);
  if (input.status !== "tots") request = request.eq("processing_status", input.status);
  if (input.query) {
    const safe = input.query.replaceAll(/[,%()]/g, " ").trim();
    request = request.or(`title.ilike.%${safe}%,source_record_id.ilike.%${safe}%,provider_name.ilike.%${safe}%`);
  }
  const { data, error, count } = await request.order("created_at", { ascending: true }).range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  const total = count ?? 0;
  const [all, latestJobMetrics] = await Promise.all([
    countRows(), getLatestJobMetrics(),
  ]);
  return {
    records: (data ?? []).map(mapRecord), total, page: input.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)), pageSize: PAGE_SIZE,
    metrics: { total: all, ...latestJobMetrics },
  };
}

export async function getSourceRecord(id: string): Promise<SourceRecord | null> {
  const { data, error } = await createServerSupabase()
    .from("source_records")
    .select(RECORD_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRecord(data as Record<string, unknown>) : null;
}

async function countRows(status?: ProcessingStatus) {
  let request = createServerSupabase().from("source_records").select("id", { count: "exact", head: true });
  if (status) request = request.eq("processing_status", status);
  const { count, error } = await request;
  if (error) throw error;
  return count ?? 0;
}

async function getLatestJobMetrics() {
  const { data, error } = await createServerSupabase()
    .from("pipeline_jobs")
    .select("source_record_id,status,created_at");
  if (error) throw error;
  return summarizeLatestJobs(data ?? []);
}

export function mapRecord(row: Record<string, unknown>): SourceRecord {
  return {
    id: String(row.id), sourceDataset: String(row.source_dataset), financingType: row.financing_type as SourceRecord["financingType"], sourceRecordId: String(row.source_record_id),
    mechanism: String(row.mechanism), title: String(row.title),
    providerName: row.provider_name == null ? null : String(row.provider_name),
    amount: row.amount == null ? null : Number(row.amount), status: row.processing_status as ProcessingStatus,
    carteraCode: row.cartera_code == null ? null : String(row.cartera_code),
    carteraName: row.cartera_name == null ? null : String(row.cartera_name),
    confidence: row.confidence == null ? null : Number(row.confidence),
    evidence: row.evidence == null ? null : String(row.evidence),
    sourceFile: row.source_file == null ? null : String(row.source_file),
    sourceSheet: row.source_sheet == null ? null : String(row.source_sheet),
    sourceRow: row.source_row == null ? null : Number(row.source_row),
    sourcePayload: (row.source_payload ?? {}) as SourceRecord["sourcePayload"],
    evidenceStatus: row.evidence_status as SourceRecord["evidenceStatus"], evidenceError: row.evidence_error == null ? null : String(row.evidence_error),
    enrichmentStatus: row.enrichment_status as SourceRecord["enrichmentStatus"], enrichmentError: row.enrichment_error == null ? null : String(row.enrichment_error),
    sourceDocuments: Array.isArray(row.source_documents) ? row.source_documents.map((document) => {
      const item = document as Record<string, unknown>;
      return {
        id: String(item.id), url: String(item.url), documentType: String(item.document_type),
        sourceFields: Array.isArray(item.source_fields) ? item.source_fields.map(String) : [],
        status: item.status as SourceRecord["sourceDocuments"][number]["status"],
        mimeType: item.mime_type == null ? null : String(item.mime_type),
        textPreview: item.text_preview == null ? null : String(item.text_preview),
        textLength: item.text_length == null ? null : Number(item.text_length),
        extractionMethod: item.extraction_method == null ? null : String(item.extraction_method),
        qualityScore: item.quality_score == null ? null : Number(item.quality_score),
        qualityFlags: Array.isArray(item.quality_flags) ? item.quality_flags.map(String) : [],
        chunkCount: Number(item.chunk_count ?? 0),
      };
    }) : [],
    matchingCandidates: mapLatestCandidates(row.pipeline_jobs),
    matchingError: mapLatestMatchingError(row.pipeline_jobs),
    reviewDecision: mapReviewDecision(row.review_decisions),
    pipelineRunId: mapLatestRun(row.pipeline_jobs)?.id ?? null,
    batchNumber: mapLatestRun(row.pipeline_jobs)?.number ?? null,
    externalEnrichment: mapEnrichment(row.record_enrichments),
  };
}

export function mapLatestCandidates(value: unknown): SourceRecord["matchingCandidates"] {
  if (!Array.isArray(value)) return [];
  const jobs = [...value].map((job) => job as Record<string, unknown>).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const latest = jobs.find((job) => Array.isArray(job.matching_candidates) && job.matching_candidates.length > 0);
  if (!latest || !Array.isArray(latest.matching_candidates)) return [];
  return latest.matching_candidates.map((candidate) => {
    const item = candidate as Record<string, unknown>;
    const links = Array.isArray(item.matching_candidate_evidence) ? item.matching_candidate_evidence : [];
    return {
      id: String(item.id), pipelineJobId: String(item.pipeline_job_id), rank: Number(item.rank), targetCode: String(item.target_code), targetName: String(item.target_name),
      score: Number(item.score), rationale: String(item.rationale), model: String(item.engine_version),
      serviceDetail: null,
      evidence: links.flatMap((link) => {
        const relation = link as Record<string, unknown>;
        const chunk = relation.evidence_chunks;
        if (!chunk || typeof chunk !== "object") return [];
        const evidence = chunk as Record<string, unknown>;
        return [{ ordinal: Number(evidence.ordinal), content: String(evidence.content), explanation: relation.explanation == null ? null : String(relation.explanation) }];
      }).sort((a, b) => a.ordinal - b.ordinal),
    };
  }).sort((a, b) => a.rank - b.rank);
}

const RECORD_SELECT = "*,source_documents(id,url,document_type,source_fields,status,mime_type,text_preview,text_length,extraction_method,quality_score,quality_flags,chunk_count),record_enrichments(extracted_title,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,summary,confidence,engine_version,record_enrichment_evidence(evidence_chunks(ordinal,content))),review_decisions(decision,created_at),pipeline_jobs(id,run_id,status,error_message,created_at,pipeline_runs(batch_number),matching_candidates(id,pipeline_job_id,rank,target_code,target_name,score,rationale,engine_version,matching_candidate_evidence(explanation,evidence_chunks(ordinal,content))))";

function mapLatestRun(value: unknown) {
  if (!Array.isArray(value) || !value.length) return null;
  const job = [...value].map((item) => item as Record<string, unknown>).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const rawRun = Array.isArray(job.pipeline_runs) ? job.pipeline_runs[0] : job.pipeline_runs;
  const run = rawRun as Record<string, unknown> | null;
  return { id: String(job.run_id), number: run?.batch_number == null ? null : String(run.batch_number).padStart(8, "0") };
}

export async function getReviewQueue(input: { batchId?: string; type?: string; state?: string; query?: string }): Promise<ReviewQueue> {
  const supabase = createServerSupabase();
  let jobsRequest = supabase.from("pipeline_jobs").select("source_record_id,status,created_at,completed_at,source_records!inner(source_dataset,financing_type)").in("status", ["needs_review", "approved", "corrected", "rejected", "insufficient_evidence"]);
  if (input.batchId) jobsRequest = jobsRequest.eq("run_id", input.batchId);
  if (input.type && input.type !== "totes") jobsRequest = jobsRequest.eq("source_records.financing_type", input.type);
  const { data: jobs, error: jobsError } = await jobsRequest.order("created_at", { ascending: false });
  if (jobsError) throw jobsError;
  const latestJobs = newestProcessedFirst(latestJobsByRecord(jobs ?? []));
  const ids = latestJobs
    .filter((job) => input.state !== "pending" || job.status === "needs_review")
    .map((job) => job.source_record_id);
  if (!ids.length) return { records: [], total: 0, reviewed: 0 };
  let recordsRequest = supabase.from("source_records").select(RECORD_SELECT).in("id", ids);
  if (input.query) { const safe = input.query.replaceAll(/[,%()]/g, " ").trim(); recordsRequest = recordsRequest.or(`title.ilike.%${safe}%,source_record_id.ilike.%${safe}%,provider_name.ilike.%${safe}%`); }
  const { data, error } = await recordsRequest;
  if (error) throw error;
  const position = new Map(ids.map((id, index) => [id, index]));
  const records = (data ?? [])
    .map((row) => mapRecord(row as Record<string, unknown>))
    .filter((record) => input.state !== "pending" || record.reviewDecision === null)
    .sort((a, b) => (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  const codes = [...new Set(records.flatMap((record) => record.matchingCandidates.map((candidate) => candidate.targetCode)))];
  if (codes.length) {
    const { data: services, error: servicesError } = await supabase.from("master_services").select("service_code,sector_scope,portfolio_status").in("service_code", codes);
    if (servicesError) throw servicesError;
    const byCode = new Map((services ?? []).map((service) => [service.service_code, service]));
    records.forEach((record) => record.matchingCandidates.forEach((candidate) => { const service = byCode.get(candidate.targetCode); candidate.serviceDetail = service ? { sectorScope: service.sector_scope, portfolioStatus: service.portfolio_status } : null; }));
  }
  return { records, total: records.length, reviewed: records.filter((record) => record.reviewDecision !== null).length };
}

function mapEnrichment(value: unknown): SourceRecord["externalEnrichment"] {
  const item = Array.isArray(value) ? value[0] as Record<string, unknown> | undefined : value as Record<string, unknown> | null;
  if (!item) return null;
  const links = Array.isArray(item.record_enrichment_evidence) ? item.record_enrichment_evidence : [];
  return { title: item.extracted_title == null ? null : String(item.extracted_title), providerName: item.provider_name == null ? null : String(item.provider_name), providerNif: item.provider_nif == null ? null : String(item.provider_nif), mechanism: item.mechanism == null ? null : String(item.mechanism), awardDate: item.award_date == null ? null : String(item.award_date), amount: item.amount == null ? null : Number(item.amount), contractingBody: item.contracting_body == null ? null : String(item.contracting_body), targetPopulation: item.target_population == null ? null : String(item.target_population), summary: String(item.summary), confidence: Number(item.confidence), model: String(item.engine_version), evidence: links.flatMap((link) => { const chunk = (link as Record<string, unknown>).evidence_chunks; if (!chunk || typeof chunk !== "object") return []; const evidence = chunk as Record<string, unknown>; return [{ ordinal: Number(evidence.ordinal), content: String(evidence.content) }]; }) };
}

function mapReviewDecision(value: unknown): SourceRecord["reviewDecision"] {
  if (!Array.isArray(value) || !value.length) return null;
  const latest = [...value].map((item) => item as Record<string, unknown>).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  return latest.decision as SourceRecord["reviewDecision"];
}
