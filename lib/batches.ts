import {conveniBatchState,mergeConveniBatchAttention,type ConveniUnitState} from './convenis/batch-state';
import {independentConveniReadersEnabled,requireConsistentConveniReads} from './convenis/independent-read-guard';
import {hasUnitSchema,schemaSelect} from './runtime-schema';
import {visibleProvisions} from './provision-visibility';
import {chunks,readAllPages} from './paginated-query';
import {executionMode} from './pipeline/execution-mode';
import {executionStatus} from './cloud/execution-status';
import {latestAnalysis} from './latest-analysis';
import "server-only";
import { createServerSupabase } from "./records-page";
import {projectBatchCandidates} from './batch-candidate-projection';
import type { BatchJob, BatchSummary, CloudResourceBlock, ExportSummary, SampleRecord, SourceDataset } from "./batch-types";
import { FINANCING_TYPES, financingTypeForDataset, type FinancingType } from "./financing-types";
import { summarizePhases,type ProgressState } from "./pipeline-progress";
import { currentAttentionCounts, paginateBatchSummaries, type BatchListFilters } from "./batch-list";
import {batchResultClassification} from './batch-result-guidance';

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
  await requireConsistentConveniReads(db);const independent=independentConveniReadersEnabled();
  const rows: Record<string, unknown>[] = [];
  for (let start = 0; ; start += 500) {
    const result = await db.from("pipeline_run_summaries").select("*").order("created_at", { ascending: false }).order("id").range(start, start + 499);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 500) break;
  }
  const current = await loadCurrentAttentionResults(independent);
  const states=independent?await loadIndependentStates(db,current.map(row=>row.id)):[];
  const merged=independent?mergeConveniBatchAttention(current,states):current.map(row=>({...row,conveniState:null}));
  const byRun = currentAttentionCounts(merged);
  const partialByRun=new Map<string,number>();const partialReviewedByRun=new Map<string,number>();const partialApprovedByRun=new Map<string,number>();
  for(const row of merged)if(row.run_id&&row.conveniState==='partial'){
    partialByRun.set(row.run_id,(partialByRun.get(row.run_id)??0)+1);
    if(['approved','corrected','rejected','insufficient_evidence'].includes(row.execution_status))partialReviewedByRun.set(row.run_id,(partialReviewedByRun.get(row.run_id)??0)+1);
    if(['approved','corrected'].includes(row.execution_status))partialApprovedByRun.set(row.run_id,(partialApprovedByRun.get(row.run_id)??0)+1);
  }
  const independentCounts=new Map<string,number>();
  if(independent)for(const ids of chunks(rows.map(row=>String(row.id)))){const result=await db.rpc('conveni_independent_batch_counts',{p_runs:ids});if(result.error)throw result.error;for(const item of result.data??[])independentCounts.set(String(item.run_id),Number(item.provision_count));}
  const result = paginateBatchSummaries(rows.map((row) => {
    const batch = mapBatchSummary(row);
    const counts = byRun.get(batch.id);
    const partialCount=partialByRun.get(batch.id)??0,partialReviewed=partialReviewedByRun.get(batch.id)??0;
    const provisionCount=independent?(independentCounts.get(batch.id)??0):batch.provisionCount;
    return { ...batch,reviewCount:counts?.review??0,insufficientCount:counts?.insufficient??0,partialCount,reviewedCount:Math.max(0,batch.reviewedCount-partialReviewed),approvedCount:Math.max(0,batch.approvedCount-(partialApprovedByRun.get(batch.id)??0)),provisionCount,exportableCount:provisionCount,canExport:provisionCount>0 };
  }), input);
  const items=await enrichExecutions(result.items);await requireConsistentConveniReads(db);
  return { ...result, items };
}

async function loadCurrentAttentionResults(all=false) {
  const db = createServerSupabase();
  const rows: Array<{id:string;run_id:string|null;destination:string;classification:string|null;execution_status:string}> = [];
  for (let start = 0; ; start += 500) {
    let query=db.from("current_record_results").select("id,run_id,destination,classification,execution_status").not("run_id", "is", null);
    if(!all)query=query.in("destination", ["review", "issues"]);
    const result=await query.order("run_id").order("id").range(start,start+499);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 500) break;
  }
  return rows;
}

async function loadIndependentStates(db:ReturnType<typeof createServerSupabase>,ids:string[]):Promise<ConveniUnitState[]>{
 const out:ConveniUnitState[]=[];
 for(const block of chunks([...new Set(ids)])){const result=await db.rpc('conveni_independent_record_states',{p_records:block});if(result.error)throw result.error;for(const row of result.data??[])out.push({source_record_id:String(row.source_record_id),approved_units:Number(row.approved_units),pending_units:Number(row.pending_units)});}
 return out;
}

export async function getBatch(id: string): Promise<BatchSummary | null> {
  const db=createServerSupabase();
  await requireConsistentConveniReads(db);const independent=independentConveniReadersEnabled();
  const { data, error } = await db.from("pipeline_runs").select("*").eq("id",id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const jobs=await readAllPages((from,to)=>db.from("pipeline_jobs").select(batchJobSelect).eq("run_id",id).order("id").range(from,to)) as unknown as Record<string,unknown>[];
  const recordIds=jobs.map(job=>String(job.source_record_id));
  const currentSchema=hasUnitSchema();
  const byRecord=new Map<string,Record<string,unknown>[]>();
  for(const block of chunks(recordIds)) {
    const provisions=await readAllPages((from,to)=>{
      let q=(independent?db.rpc("conveni_independent_provisions"):db.from(currentSchema ? "conveni_reviewed_provisions" : "service_provisions")).select(schemaSelect("id,source_record_id,superseded_at")).in("source_record_id",block);
      if(currentSchema) q=q.is("superseded_at",null);
      return q.order("id").range(from,to) as unknown as PromiseLike<{data:Record<string,unknown>[]|null;error:unknown}>;
    });
    for(const provision of provisions as unknown as Record<string,unknown>[]) {
      const key=String(provision.source_record_id);
      byRecord.set(key,[...(byRecord.get(key)??[]),{...provision,provision_is_current:true}]);
    }
  }
  const hydrated=jobs.map(job=>{
    const raw=job.source_records;
    const source=(Array.isArray(raw)?raw[0]:raw) as Record<string,unknown> | null;
    if(!source || String(source.id)!==String(job.source_record_id)) throw Error('Falta el registre del lot');
    return {...job,source_records:{...source,service_provisions:byRecord.get(String(job.source_record_id))??[]}};
  });
  let batch=(await enrichCandidateServices([mapBatch({...data,pipeline_jobs:hydrated})]))[0];
  if(independent){
   const states=new Map((await loadIndependentStates(db,recordIds)).map(value=>[value.source_record_id,value]));
   const jobs=batch.jobs.map(job=>{const state=job.isCurrent===false?null:conveniBatchState(states.get(job.sourceRecordId));return {...job,conveniState:state,currentDestination:state==='partial'||state==='review'?(job.currentDestination==='issues'?'issues':'review'):job.currentDestination};});
   const partial=jobs.filter(job=>job.conveniState==='partial');const reviewed=partial.filter(job=>['approved','corrected','rejected','insufficient_evidence'].includes(job.status)).length,approved=partial.filter(job=>['approved','corrected'].includes(job.status)).length;
   batch={...batch,jobs,partialCount:partial.length,reviewCount:jobs.filter(job=>job.currentDestination==='review').length,reviewedCount:Math.max(0,batch.reviewedCount-reviewed),approvedCount:Math.max(0,batch.approvedCount-approved)};
  }
  await requireConsistentConveniReads(db);return batch;
}

export async function getCloudResourceBlock(): Promise<CloudResourceBlock> {
  if (process.env.LOCAL_REMOTE_PREVIEW === 'true' && executionMode() === 'disabled') return {kind:'execution_disabled',label:'Execució desactivada en aquest entorn'};
  const { data, error } = await createServerSupabase().from("cloud_resources").select("blocked_kind").eq("name", "sandbox").single();
  if (error) throw new Error("No s’ha pogut consultar la disponibilitat del procés.");
  if (!data.blocked_kind) return null;
  return { kind: String(data.blocked_kind), label: data.blocked_kind === "vercel_quota" ? "Quota de Vercel esgotada" : "Execució al núvol bloquejada" };
}

const batchJobSelect = "id,source_record_id,status,error_message,enrichment_status,enrichment_error,analysis_results(*),preparation_status,preparation_message,matching_candidates(id,pipeline_job_id,catalog_version_id,rank,target_code,target_name,score,rationale,engine_version,matching_candidate_evidence(explanation,evidence_chunks(ordinal,content))),source_records(id,source_dataset,financing_type,source_record_id,title,evidence_status,evidence_error,enrichment_status,enrichment_error,processing_status)";

export async function getExportSummary() {
  const supabase = createServerSupabase();
  await requireConsistentConveniReads(supabase);const independent=independentConveniReadersEnabled();
  let provisions=(independent?supabase.rpc("conveni_independent_provisions",{}, {count:"exact",head:true}):supabase.from(hasUnitSchema() ? "conveni_reviewed_provisions" : "service_provisions")).select("id",{count:"exact",head:true});
  if(hasUnitSchema())provisions=provisions.is("superseded_at",null);
  const [{ count, error: countError }, { data, error }] = await Promise.all([
    provisions,
    supabase.from("excel_exports").select("id,filename,provision_count,created_at").order("created_at", { ascending: false }).limit(5),
  ]);
  if (countError) throw countError;
  if (error) throw error;
  await requireConsistentConveniReads(supabase);
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
    // The export uses all current provisions of each record selected in this
    // batch, including reviews completed in a subsequent job.
    const provisions=Array.isArray(rawProvision)?visibleProvisions(rawProvision,!hasUnitSchema()):[];
    const hasProvision=provisions.length>0;
    provisionCount += provisions.length;
    const sourceDataset = source.source_dataset as SourceDataset;
    const analysis = latestAnalysis([item]);
    const projected=projectBatchCandidates(item,analysis);
    return { id: String(item.id), sourceRecordId: String(source.id), sourceDataset, financingType: (source.financing_type ?? financingTypeForDataset(sourceDataset)) as FinancingType, externalId: String(source.source_record_id), title: String(source.title), status: String(item.status), preparationStatus: String(item.preparation_status) as BatchJob["preparationStatus"], preparationMessage: item.preparation_message == null ? null : String(item.preparation_message), errorMessage: item.error_message == null ? null : String(item.error_message), enrichmentStatus: String(item.enrichment_status ?? "pending"), enrichmentError: item.enrichment_error == null ? null : String(item.enrichment_error), processingStatus: String(item.status), ...projected, hasProvision };
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
  const destinations=new Map<string,string>();
  const jobIds=batches.flatMap(b=>b.jobs.map(j=>j.id));
  for(let offset=0;offset<jobIds.length;offset+=100){
   const ids=jobIds.slice(offset,offset+100);
   const [labelsResult,currentResult]=await Promise.all([
    db.from('job_result_labels').select('*').in('id',ids),
    db.from('current_record_results').select('job_id,destination').in('job_id',ids),
   ]);
   if(labelsResult.error)throw labelsResult.error;
   if(currentResult.error)throw currentResult.error;
   for(const label of labelsResult.data)labels.set(label.id,label);
   for(const result of currentResult.data)if(result.job_id)destinations.set(result.job_id,result.destination);
  }
  batches=batches.map(batch=>{
   const jobs=batch.jobs.map(job=>({...job,title:labels.get(job.id)?.title??job.title,externalId:labels.get(job.id)?.external_id??job.externalId,isCurrent:labels.get(job.id)?.is_current??false,currentDestination:destinations.get(job.id)??null,phases:byId.get(job.id)}));
   for(const job of jobs)if(!job.phases)throw Error('Falta la projecció SQL de fases');
   return {...batch,jobs,approvedCount:jobs.filter(j=>['approved','corrected'].includes(j.status)&&j.hasProvision).length,rejectedCount:jobs.filter(j=>batchResultClassification(j)==='discarded').length,insufficientCount:jobs.filter(j=>j.currentDestination==='issues'&&batchResultClassification(j)==='insufficient_evidence').length,reviewCount:jobs.filter(j=>j.currentDestination==='review').length,
    progress:{preparation:summarizePhases(jobs.map(j=>j.phases!.preparation)),enrichment:summarizePhases(jobs.map(j=>j.phases!.enrichment)),matching:summarizePhases(jobs.map(j=>j.phases!.matching))}};
  });
 }
 return enrichExecutions(batches);
}

async function enrichExecutions(batches: BatchSummary[]) {
 if(!batches.length)return batches;
 const db=createServerSupabase();
 const ids=batches.map(b=>b.id);
 const [tasksResult,costsResult]=await Promise.all([
  db.from('worker_tasks').select('run_id,execution_state,lease_until,last_progress_at,failure_kind').eq('executor','vercel_workflow').in('run_id',ids).order('created_at',{ascending:false}),
  db.from('ai_cost_per_run').select('run_id,total_usd,measured_calls,pending_reserved_usd').in('run_id',ids),
 ]);
 if(tasksResult.error||costsResult.error)throw new Error('No s’ha pogut consultar l’execució remota.');
 return batches.map(batch=>{const task=tasksResult.data.find(t=>t.run_id===batch.id);const cost=costsResult.data.find(c=>c.run_id===batch.id);const reservedCostUsd=Number(cost?.pending_reserved_usd??0);const actualCostUsd=cost?.measured_calls?Number(cost.total_usd):null;if(!task)return {...batch,reservedCostUsd,actualCostUsd};const execution=executionStatus(task);return {...batch,reservedCostUsd,actualCostUsd,execution,isActive:['pending','running'].includes(execution.state)};});
}
