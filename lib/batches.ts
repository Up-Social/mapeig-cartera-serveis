import "server-only";
import { createServerSupabase, mapLatestCandidates } from "./records-page";
import type { BatchJob, BatchSummary, ExportSummary, SampleRecord, SourceDataset } from "./batch-types";
import { FINANCING_TYPES, financingTypeForDataset, type FinancingType } from "./financing-types";
import { phaseState } from "./pipeline-progress";

export async function getBalancedSample(excludedIds: string[] = []): Promise<SampleRecord[]> {
  const { data, error } = await createServerSupabase().rpc("sample_financing_type_candidates", { candidate_limit: 20, excluded_ids: excludedIds });
  if (error) throw error;
  const candidates: SampleRecord[] = (data ?? []).map((row: Record<string, unknown>) => mapSample(row));
  const selected: SampleRecord[] = [];
  const queues = new Map(FINANCING_TYPES.map((type) => [type, candidates.filter((row) => row.financingType === type)]));
  for (const type of FINANCING_TYPES) {
    const candidate = queues.get(type)?.shift();
    if (candidate) selected.push(candidate);
  }
  while (selected.length < 4) {
    const nextType = FINANCING_TYPES
      .filter((type) => (queues.get(type)?.length ?? 0) > 0)
      .sort((a, b) => selected.filter((row) => row.financingType === a).length - selected.filter((row) => row.financingType === b).length)[0];
    if (!nextType) break;
    selected.push(queues.get(nextType)!.shift()!);
  }
  return selected;
}

export async function getAvailableFinancingTypes(): Promise<FinancingType[]> {
  const { data, error } = await createServerSupabase().rpc("sample_financing_type_candidates", { candidate_limit: 1, excluded_ids: [] });
  if (error) throw error;
  return FINANCING_TYPES.filter((type) => (data ?? []).some((row: { financing_type: string }) => row.financing_type === type));
}

export async function getBatches(): Promise<BatchSummary[]> {
  const { data, error } = await createServerSupabase().from("pipeline_runs").select(BATCH_SELECT).order("created_at", { ascending: false }).limit(30);
  if (error) throw error;
  return enrichCandidateServices((data ?? []).map((row) => mapBatch(row as Record<string, unknown>)));
}

export async function getBatch(id: string): Promise<BatchSummary | null> {
  const { data, error } = await createServerSupabase().from("pipeline_runs").select(BATCH_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return (await enrichCandidateServices([mapBatch(data as Record<string, unknown>)]))[0];
}

const BATCH_SELECT = "*,pipeline_jobs(id,status,error_message,preparation_status,preparation_message,matching_candidates(id,pipeline_job_id,rank,target_code,target_name,score,rationale,engine_version,matching_candidate_evidence(explanation,evidence_chunks(ordinal,content))),source_records(id,source_dataset,financing_type,source_record_id,title,evidence_status,evidence_error,enrichment_status,enrichment_error,processing_status,service_provisions(id)))";

export async function getExportSummary() {
  const supabase = createServerSupabase();
  const [{ count, error: countError }, { data, error }] = await Promise.all([
    supabase.from("service_provisions").select("id", { count: "exact", head: true }),
    supabase.from("excel_exports").select("id,filename,provision_count,created_at").order("created_at", { ascending: false }).limit(5),
  ]);
  if (countError) throw countError;
  if (error) throw error;
  return { provisionCount: count ?? 0, exports: (data ?? []).map((item): ExportSummary => ({ id: String(item.id), filename: String(item.filename), provisionCount: Number(item.provision_count), createdAt: String(item.created_at) })) };
}

function mapSample(row: Record<string, unknown>): SampleRecord {
  const sourceDataset = row.source_dataset as SourceDataset;
  const financingType = (row.financing_type ?? financingTypeForDataset(sourceDataset)) as FinancingType;
  return { id: String(row.id), sourceDataset, financingType, deduplicationKey: String(row.deduplication_key), sourceRecordId: String(row.source_record_id), title: String(row.title), providerName: row.provider_name == null ? null : String(row.provider_name), amount: row.amount == null ? null : Number(row.amount), mechanism: String(row.mechanism) };
}

function mapBatch(row: Record<string, unknown>): BatchSummary {
  let provisionCount = 0;
  const jobs = Array.isArray(row.pipeline_jobs) ? row.pipeline_jobs.map((value): BatchJob => {
    const item = value as Record<string, unknown>;
    const source = item.source_records as Record<string, unknown>;
    const rawProvision = source.service_provisions;
    const hasProvision = Array.isArray(rawProvision) ? rawProvision.length > 0 : Boolean(rawProvision);
    if (hasProvision) provisionCount += 1;
    const sourceDataset = source.source_dataset as SourceDataset;
    return { id: String(item.id), sourceRecordId: String(source.id), sourceDataset, financingType: (source.financing_type ?? financingTypeForDataset(sourceDataset)) as FinancingType, externalId: String(source.source_record_id), title: String(source.title), status: String(item.status), preparationStatus: String(item.preparation_status) as BatchJob["preparationStatus"], preparationMessage: item.preparation_message == null ? null : String(item.preparation_message), errorMessage: item.error_message == null ? null : String(item.error_message), enrichmentStatus: String(source.enrichment_status ?? "pending"), enrichmentError: source.enrichment_error == null ? null : String(source.enrichment_error), processingStatus: String(source.processing_status ?? "pendent"), matchingCandidates: mapLatestCandidates([{ created_at: "", matching_candidates: item.matching_candidates }]), hasProvision };
  }).sort((a, b) => a.sourceDataset.localeCompare(b.sourceDataset) || a.externalId.localeCompare(b.externalId)) : [];
  const rejectedCount = jobs.filter((job) => job.status === "rejected").length;
  const insufficientCount = jobs.filter((job) => job.status === "insufficient_evidence").length;
  const reviewedCount = jobs.filter((job) => ["approved", "corrected", "rejected", "insufficient_evidence"].includes(job.status)).length;
  const analyzedCount = jobs.filter((job) => job.matchingCandidates.length > 0).length;
  const incidences = jobs.filter((job) => ["approved", "corrected"].includes(job.status) && !job.hasProvision).map((job) => `${job.externalId}: decisió aprovada sense provisió exportable`);
  const stage = String(row.stage);
  const preparationCompleted = jobs.filter((job) => job.preparationStatus === "ready").length;
  const preparationErrors = jobs.filter((job) => ["no_source", "unsupported", "error"].includes(job.preparationStatus)).length;
  const enrichmentCompleted = jobs.filter((job) => job.enrichmentStatus === "completed").length;
  const enrichmentErrors = jobs.filter((job) => job.status === "error" && job.enrichmentStatus !== "completed").length;
  const matchingCompleted = jobs.filter((job) => job.matchingCandidates.length > 0).length;
  const matchingErrors = jobs.filter((job) => job.status === "error").length;
  const progressStage = row.status === "queued" ? "queued" : stage;
  const progress = {
    preparation: { state: phaseState(progressStage, "preparation", preparationCompleted, preparationErrors, jobs.length), completed: preparationCompleted, errors: preparationErrors, total: jobs.length },
    enrichment: { state: phaseState(progressStage, "enrichment", enrichmentCompleted, enrichmentErrors, jobs.length), completed: enrichmentCompleted, errors: enrichmentErrors, total: jobs.length },
    matching: { state: phaseState(progressStage, "matching", matchingCompleted, matchingErrors, jobs.length), completed: matchingCompleted, errors: matchingErrors, total: jobs.length },
  };
  return { id: String(row.id), batchNumber: String(row.batch_number).padStart(8, "0"), status: String(row.status), stage, selectedCount: jobs.length, preparedCount: Number(row.prepared_count), readyCount: Number(row.ready_count), processedCount: Number(row.processed_count), analyzedCount, reviewCount: jobs.filter((job) => job.status === "needs_review").length, reviewedCount, approvedCount: jobs.filter((job) => ["approved", "corrected"].includes(job.status) && job.hasProvision).length, rejectedCount, insufficientCount, errorCount: jobs.filter((job) => job.status === "error").length, exportableCount: provisionCount, incidences, estimatedInputTokens: Number(row.estimated_input_tokens), actualInputTokens: Number(row.actual_input_tokens), actualOutputTokens: Number(row.actual_output_tokens), createdAt: String(row.created_at), canExport: provisionCount > 0, provisionCount, isActive: ["queued", "preparing", "enriching", "matching"].includes(String(row.status)), progress, jobs };
}

async function enrichCandidateServices(batches: BatchSummary[]) {
  const codes = [...new Set(batches.flatMap((batch) => batch.jobs.flatMap((job) => job.matchingCandidates.map((candidate) => candidate.targetCode))))];
  if (!codes.length) return batches;
  const { data, error } = await createServerSupabase().from("master_services").select("service_code,sector_scope,portfolio_status").in("service_code", codes);
  if (error) throw error;
  const byCode = new Map((data ?? []).map((service) => [service.service_code, service]));
  for (const batch of batches) for (const job of batch.jobs) for (const candidate of job.matchingCandidates) {
    const service = byCode.get(candidate.targetCode);
    candidate.serviceDetail = service ? { sectorScope: service.sector_scope, portfolioStatus: service.portfolio_status } : null;
  }
  return batches;
}
