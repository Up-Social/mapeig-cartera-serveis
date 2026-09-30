import {hasUnitSchema,schemaSelect} from './runtime-schema';
import {executionMode} from './pipeline/execution-mode';
import {executionStatus} from './cloud/execution-status';
import {latestAnalysis} from './latest-analysis';
import "server-only";
import { createServerSupabase, mapLatestCandidates } from "./records-page";
import type { BatchJob, BatchSummary, CloudResourceBlock, ExportSummary, SampleRecord, SourceDataset } from "./batch-types";
import { FINANCING_TYPES, financingTypeForDataset, type FinancingType } from "./financing-types";
import { summarizePhases,type ProgressState } from "./pipeline-progress";
import { paginateBatchSummaries, type BatchListFilters } from "./batch-list";

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

export async function getBatchPage(input: BatchListFilters) {
  const db = createServerSupabase();
  const rows: Record<string, unknown>[] = [];
  for (let start = 0; ; start += 500) {
    const result = await db.from("pipeline_run_summaries").select("*").order("created_at", { ascending: false }).order("id").range(start, start + 499);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 500) break;
  }
  const result = paginateBatchSummaries(rows.map(mapBatchSummary), input);
  return { ...result, items: await enrichExecutions(result.items) };
}

export async function getBatch(id: string): Promise<BatchSummary | null> {
  const { data, error } = await createServerSupabase().from("pipeline_runs").select(schemaSelect(BATCH_SELECT)).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return (await enrichCandidateServices([mapBatch(data as unknown as Record<string, unknown>)]))[0];
}

export async function getCloudResourceBlock(): Promise<CloudResourceBlock> {
  if (process.env.LOCAL_REMOTE_PREVIEW === 'true' && executionMode() === 'disabled') return {kind:'execution_disabled',label:'Execució desactivada en aquest entorn'};
  const { data, error } = await createServerSupabase().from("cloud_resources").select("blocked_kind").eq("name", "sandbox").single();
  if (error) throw new Error("No s’ha pogut consultar la disponibilitat del procés.");
  if (!data.blocked_kind) return null;
  return { kind: String(data.blocked_kind), label: data.blocked_kind === "vercel_quota" ? "Quota de Vercel esgotada" : "Execució al núvol bloquejada" };
}

const BATCH_SELECT = "*,pipeline_jobs(id,status,error_message,enrichment_status,enrichment_error,analysis_results(*),preparation_status,preparation_message,matching_candidates(id,pipeline_job_id,rank,target_code,target_name,score,rationale,engine_version,matching_candidate_evidence(explanation,evidence_chunks(ordinal,content))),source_records(id,source_dataset,financing_type,source_record_id,title,evidence_status,evidence_error,enrichment_status,enrichment_error,processing_status,service_provisions(id,superseded_at,review_decisions(pipeline_job_id))))";

export async function getExportSummary() {
  const supabase = createServerSupabase();
  let provisions=supabase.from("service_provisions").select("id",{count:"exact",head:true});
  if(hasUnitSchema())provisions=provisions.is("superseded_at",null);
  const [{ count, error: countError }, { data, error }] = await Promise.all([
    provisions,
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
    const provisions=Array.isArray(rawProvision)?rawProvision.filter(p=>!(p as Record<string,unknown>).superseded_at):[];
    const hasProvision=provisions.some(p=>{const v=p as Record<string,unknown>;const reviews=Array.isArray(v.review_decisions)?v.review_decisions:[v.review_decisions];return reviews.some(r=>(r as Record<string,unknown>|null)?.pipeline_job_id===item.id);});
    provisionCount += provisions.filter(p=>{const v=p as Record<string,unknown>;const reviews=Array.isArray(v.review_decisions)?v.review_decisions:[v.review_decisions];return reviews.some(r=>(r as Record<string,unknown>|null)?.pipeline_job_id===item.id);}).length;
    const sourceDataset = source.source_dataset as SourceDataset;
    const analysis = latestAnalysis([item]);
    const rawCandidates=mapLatestCandidates([{ created_at: "", matching_candidates: item.matching_candidates }]);
    const unreliable = analysis?.reliability_status === "invalidated" || rawCandidates.some(candidate=>candidate.score<=0);
    const visibleAnalysis=analysis&&unreliable?{...analysis,reliability_status:'invalidated' as const,reliability_reasons:[...new Set([...(analysis.reliability_reasons??[]),'non_positive_confidence'])]}:analysis;
    return { id: String(item.id), sourceRecordId: String(source.id), sourceDataset, financingType: (source.financing_type ?? financingTypeForDataset(sourceDataset)) as FinancingType, externalId: String(source.source_record_id), title: String(source.title), status: String(item.status), preparationStatus: String(item.preparation_status) as BatchJob["preparationStatus"], preparationMessage: item.preparation_message == null ? null : String(item.preparation_message), errorMessage: item.error_message == null ? null : String(item.error_message), enrichmentStatus: String(item.enrichment_status ?? "pending"), enrichmentError: item.enrichment_error == null ? null : String(item.enrichment_error), processingStatus: String(item.status), analysis:visibleAnalysis, matchingCandidates: unreliable ? [] : rawCandidates, hasProvision };
  }).sort((a, b) => a.sourceDataset.localeCompare(b.sourceDataset) || a.externalId.localeCompare(b.externalId)) : [];
  const rejectedCount = jobs.filter((job) => job.status === "rejected").length;
  const insufficientCount = jobs.filter((job) => job.status === "insufficient_evidence" || job.analysis?.reliability_status === "invalidated").length;
  const reviewedCount = jobs.filter((job) => ["approved", "corrected", "rejected", "insufficient_evidence"].includes(job.status)).length;
  const analyzedCount = jobs.filter((job) => Boolean(job.analysis) || job.matchingCandidates.length > 0).length;
  const incidences = jobs.filter((job) => ["approved", "corrected"].includes(job.status) && !job.hasProvision).map((job) => `${job.externalId}: decisió aprovada sense provisió exportable`);
  const stage = String(row.stage);
  const progress={preparation:summarizePhases([]),enrichment:summarizePhases([]),matching:summarizePhases([])};
  const parameters=(row.parameters&&typeof row.parameters==='object'?row.parameters:{}) as Record<string,unknown>;
  return { reservedCostUsd:0, actualCostUsd:null, purpose:String(parameters.purpose??'batch'), pauseReason:row.pause_reason == null ? null : String(row.pause_reason), id: String(row.id), batchNumber: String(row.batch_number).padStart(8, "0"), status: String(row.status), stage, selectedCount: jobs.length, preparedCount: Number(row.prepared_count), readyCount: Number(row.ready_count), processedCount: Number(row.processed_count), analyzedCount, reviewCount: jobs.filter((job) => job.status === "needs_review" && job.analysis?.reliability_status !== "invalidated").length, reviewedCount, approvedCount: jobs.filter((job) => ["approved", "corrected"].includes(job.status) && job.hasProvision).length, rejectedCount, insufficientCount, errorCount: jobs.filter((job) => job.status === "error").length, exportableCount: provisionCount, incidences, estimatedInputTokens: Number(row.estimated_input_tokens), actualInputTokens: Number(row.actual_input_tokens), actualOutputTokens: Number(row.actual_output_tokens), createdAt: String(row.created_at), canExport: provisionCount > 0, provisionCount, isActive: ["queued", "preparing", "enriching", "matching"].includes(String(row.status)), progress, jobs };
}

function mapBatchSummary(row: Record<string, unknown>): BatchSummary {
  const parameters=(row.parameters&&typeof row.parameters==='object'?row.parameters:{}) as Record<string,unknown>;
  const selectedCount=Number(row.jobs_total??row.selected_count??0);
  const provisionCount=Number(row.provision_count??0);
  return {
    reservedCostUsd:0,actualCostUsd:null,
    purpose:String(parameters.purpose??'batch'),pauseReason:row.pause_reason==null?null:String(row.pause_reason),id:String(row.id),
    batchNumber:String(row.batch_number).padStart(8,'0'),status:String(row.status),stage:String(row.stage),selectedCount,
    preparedCount:Number(row.prepared_count??0),readyCount:Number(row.ready_count??0),processedCount:Number(row.processed_count??0),
    analyzedCount:Number(row.processed_count??0),reviewCount:Number(row.review_count??0),reviewedCount:Number(row.derived_reviewed_count??0),
    approvedCount:Number(row.approved_count??0),rejectedCount:Number(row.derived_rejected_count??0),insufficientCount:Number(row.derived_insufficient_count??0),
    errorCount:Number(row.error_count??0),exportableCount:provisionCount,incidences:[],estimatedInputTokens:Number(row.estimated_input_tokens??0),
    actualInputTokens:Number(row.actual_input_tokens??0),actualOutputTokens:Number(row.actual_output_tokens??0),createdAt:String(row.created_at),
    canExport:provisionCount>0,provisionCount,isActive:['queued','preparing','enriching','matching'].includes(String(row.status)),
    progress:{preparation:summarizePhases([]),enrichment:summarizePhases([]),matching:summarizePhases([])},jobs:[],
  };
}

async function enrichCandidateServices(batches: BatchSummary[]) {
 const db=createServerSupabase();
 if(batches.length){
  const phases:Array<{id:string;preparation:ProgressState;enrichment:ProgressState;matching:ProgressState}>=[];
  for(let offset=0;;offset+=500){const r=await db.from('job_phase_states').select('id,preparation,enrichment,matching').in('run_id',batches.map(b=>b.id)).order('id').range(offset,offset+499);if(r.error)throw r.error;phases.push(...(r.data??[]));if((r.data?.length??0)<500)break;}
  const byId=new Map(phases.map(p=>[p.id,p]));
  const labels=new Map<string,{title:string;external_id:string|null;is_current:boolean}>();
  const jobIds=batches.flatMap(b=>b.jobs.map(j=>j.id));
  for(let offset=0;offset<jobIds.length;offset+=100){const r=await db.from('job_result_labels').select('*').in('id',jobIds.slice(offset,offset+100));if(r.error)throw r.error;for(const label of r.data)labels.set(label.id,label);}
  batches=batches.map(batch=>{
   const jobs=batch.jobs.map(job=>({...job,title:labels.get(job.id)?.title??job.title,externalId:labels.get(job.id)?.external_id??job.externalId,isCurrent:labels.get(job.id)?.is_current??false,phases:byId.get(job.id)}));
   for(const job of jobs)if(!job.phases)throw Error('Falta la projecció SQL de fases');
   return {...batch,jobs,approvedCount:jobs.filter(j=>['approved','corrected'].includes(j.status)).length,rejectedCount:jobs.filter(j=>(j.analysis?.reviewed_classification??j.analysis?.classification)==='discarded').length,insufficientCount:jobs.filter(j=>j.analysis?.reliability_status==='invalidated'||(j.analysis?.reviewed_classification??j.analysis?.classification)==='insufficient_evidence').length,reviewCount:jobs.filter(j=>j.status==='needs_review'&&j.analysis?.reliability_status!=='invalidated').length,
    progress:{preparation:summarizePhases(jobs.map(j=>j.phases!.preparation)),enrichment:summarizePhases(jobs.map(j=>j.phases!.enrichment)),matching:summarizePhases(jobs.map(j=>j.phases!.matching))}};
  });
 }
 return enrichExecutions(batches);
}

async function enrichExecutions(batches: BatchSummary[]) {
 if(!batches.length)return batches;
 const r=await createServerSupabase().from('worker_tasks').select('run_id,execution_state,lease_until,last_progress_at,failure_kind,cloud_budget_reservations(reserved_usd,actual_usd)').eq('executor','vercel_workflow').in('run_id',batches.map(b=>b.id)).order('created_at',{ascending:false});
 if(r.error)throw new Error('No s’ha pogut consultar l’execució remota.');
 return batches.map(batch=>{const tasks=r.data.filter(t=>t.run_id===batch.id);const task=tasks[0];const reservations=tasks.flatMap(t=>Array.isArray(t.cloud_budget_reservations)?t.cloud_budget_reservations:[]);const reservedCostUsd=reservations.reduce((total,item)=>total+Number(item.reserved_usd??0),0);const settled=reservations.filter(item=>item.actual_usd!=null);const actualCostUsd=settled.length?settled.reduce((total,item)=>total+Number(item.actual_usd),0):null;if(!task)return {...batch,reservedCostUsd,actualCostUsd};const execution=executionStatus(task);return {...batch,reservedCostUsd,actualCostUsd,execution,isActive:['pending','running'].includes(execution.state)};});
}
