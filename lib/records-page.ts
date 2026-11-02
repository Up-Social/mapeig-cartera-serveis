import {normalizeConveni} from './convenis/contract';
import {currentDocumentTextConsistent} from './concerts/document-text-integrity';
import {provisionalDocumentReport} from './concerts/provisional-report';
import {provisionalResolutionPage} from './concerts/provisional-resolution';
import {hasCurrentTextCoverage} from './pipeline/document-coverage';
import {effectiveJobs} from './effective-jobs';
import {projectLatestCandidates} from './candidate-projection';
import {textDefects} from './pipeline/readable-document';
import {latestAnalysis} from './latest-analysis';
import {isRecipientReviewContainer} from './analysis-contract';
import "server-only";
import { createClient } from "@supabase/supabase-js";
import {assertTestEnvironment} from './test-environment';
import type { ProcessingStatus, ReviewQueue, SourceListPage, SourceRecord } from "./workbench-types";
import { mapLatestMatchingError } from "./matching-state";
import {recordOperationProgress,type ProgressTask} from './record-progress';

export const PAGE_SIZE = 25;

export type AiCostSummary={
  scope:'concert'|'altres';measuredRecords:number;totalUsd:number;averageUsd:number;
  measuredCalls:number;runsWithCost:number;reviewedRecords:number;
  unsettledCalls:number;pendingReservedUsd:number;
};
export async function getAiCostSummary():Promise<AiCostSummary[]>{
  const result=await createServerSupabase().from('ai_cost_summary').select('scope,measured_records,total_usd,average_usd,measured_calls,runs_with_cost,reviewed_records,unsettled_calls,pending_reserved_usd');
  if(result.error){
    // Older deployments can still serve the records page before this local migration.
    if(result.error.code==='PGRST205'||result.error.code==='42P01')return [];
    throw result.error;
  }
  return (result.data??[]).filter(row=>row.scope==='concert'||row.scope==='altres').map(row=>({
    scope:row.scope as 'concert'|'altres',measuredRecords:Number(row.measured_records),
    totalUsd:Number(row.total_usd),averageUsd:Number(row.average_usd??0),
    measuredCalls:Number(row.measured_calls),runsWithCost:Number(row.runs_with_cost),
    reviewedRecords:Number(row.reviewed_records),unsettledCalls:Number(row.unsettled_calls),
    pendingReservedUsd:Number(row.pending_reserved_usd),
  }));
}

export function createServerSupabase() {
  if (process.env.WORKFLOW_TEST_PROJECT) assertTestEnvironment(process.env);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Falten les variables de Supabase a .env.local");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type SourcePageFilters = { page: number; query: string; type: string; processing?: string; execution?: string; review?: string };
export async function getSourcePage(input: SourcePageFilters): Promise<SourceListPage> {
  const supabase = createServerSupabase();
  const from = (input.page - 1) * PAGE_SIZE;
  let request = supabase.from("imported_record_processing_overview").select("id,title,source_dataset,source_record_id,provider_name,financing_type,batch_number,run_id,destination,processing_state,review_state,execution_count,batch_execution_count,individual_execution_count,other_execution_count,latest_run_purpose", { count: "exact" });
  if (input.type !== "totes") request = request.eq("financing_type", input.type);
  if (input.processing && input.processing !== "all") request = request.eq("processing_state", input.processing);
  if (input.execution === "none") request = request.eq("execution_count", 0);
  if (input.execution === "batch") request = request.gt("batch_execution_count", 0);
  if (input.execution === "individual") request = request.gt("individual_execution_count", 0);
  if (input.execution === "other") request = request.gt("other_execution_count", 0);
  if (input.review && input.review !== "all") request = request.eq("review_state", input.review);
  if (input.query) {
    const safe = input.query.replaceAll(/[,%()]/g, " ").trim();
    request = request.or(`title.ilike.%${safe}%,source_record_id.ilike.%${safe}%,provider_name.ilike.%${safe}%`);
  }
  const { data, error, count } = await request.order("updated_at", { ascending: false }).order("id").range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  const total = count ?? 0;
  const summary=await supabase.from('imported_record_processing_summary').select('total,pending,in_progress,processed,failed,awaiting_review').single();
  if(summary.error)throw summary.error;
  return {
    records: (data ?? []).map(row => ({
      id:row.id,title:row.title,sourceDataset:row.source_dataset,sourceRecordId:row.source_record_id,
      providerName:row.provider_name,financingType:row.financing_type,
      batchNumber:row.batch_number==null?null:String(row.batch_number).padStart(8,"0"),
      latestRunId:row.run_id,latestRunPurpose:row.latest_run_purpose,destination:row.destination,
      processingState:row.processing_state as "pending" | "in_progress" | "processed" | "error",
      reviewState:row.review_state as "awaiting_review" | "reviewed" | "reserved" | "not_applicable",
      executionCount:Number(row.execution_count),batchExecutionCount:Number(row.batch_execution_count),
      individualExecutionCount:Number(row.individual_execution_count),otherExecutionCount:Number(row.other_execution_count),
    })), total, page: input.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)), pageSize: PAGE_SIZE,
    metrics: {total:Number(summary.data.total),pending:Number(summary.data.pending),inProgress:Number(summary.data.in_progress),processed:Number(summary.data.processed),failed:Number(summary.data.failed),review:Number(summary.data.awaiting_review)},
  };
}

export async function getSourceRecord(id: string): Promise<SourceRecord | null> {
  const db=createServerSupabase();
  const { data, error } = await db
    .from("source_records")
    .select(RECORD_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if(!data)return null;
  const record=mapRecord(data as Record<string, unknown>);
  if(!record.currentJobId&&!record.pipelineRunId)return record;
  let taskQuery=db.from('worker_tasks').select('status,execution_state,failure_kind,current_step,progress_completed,progress_total,progress_detail,created_at,dispatch_at,claimed_at,last_progress_at,completed_at,attempts').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1);
  if(record.currentJobId&&record.pipelineRunId)taskQuery=taskQuery.or(`pipeline_job_id.eq.${record.currentJobId},progress_job_id.eq.${record.currentJobId}`);
  else if(record.currentJobId)taskQuery=taskQuery.eq('pipeline_job_id',record.currentJobId);
  else taskQuery=taskQuery.eq('run_id',record.pipelineRunId!);
  const [task,issueProjection]=await Promise.all([
    taskQuery.maybeSingle(),
    db.from('current_issue_results').select('issue_group').eq('id',id).maybeSingle(),
  ]);
  if(task.error)throw task.error;
  if(issueProjection.error)throw issueProjection.error;
  const [corrections,reservation,resolutionHistory]=await Promise.all([db.from('current_documented_corrections').select('*').eq('source_record_id',id),db.from('current_record_reservations').select('*').eq('source_record_id',id).maybeSingle(),db.from('record_reservation_events').select('*').eq('source_record_id',id).order('created_at',{ascending:false})]);
  if(corrections.error)throw corrections.error;if(reservation.error)throw reservation.error;if(resolutionHistory.error)throw resolutionHistory.error;
  const provisionalResolutionLookup=await findProvisionalResolutionCandidates(db,record);
  return {...record,provisionalResolutionLookup,resolutionHistory:resolutionHistory.data,corrections:corrections.data,reservation:reservation.data,recoveryModel:process.env.OPENAI_MATCHING_MODEL??null,issueGroup:(issueProjection.data?.issue_group as SourceRecord['issueGroup'])??null,operationProgress:recordOperationProgress(task.data as ProgressTask|null)};
}

/** A bounded, read-only search. Matching is a review candidate, never an
 * economic link or a definitive assertion that no later resolution exists. */
async function findProvisionalResolutionCandidates(db:ReturnType<typeof createServerSupabase>,record:SourceRecord):Promise<SourceRecord['provisionalResolutionLookup']>{
 const report=provisionalDocumentReport(record);
 if(!report||!report.rows.length||report.rows.some(row=>!row.identifiers))return null;
 const identities=report.rows.map(row=>row.identifiers!);
 const nifs=[...new Set(identities.map(row=>row.nif))],reses=[...new Set(identities.map(row=>row.reses))];
 const originalDate=record.sourcePayload.data_publicacio;
 if(nifs.length!==1||reses.length!==identities.length||typeof originalDate!=='string'||!/^20\d\d-\d\d-\d\d/.test(originalDate))return null;
 const issue={candidates:[],issue:'No s’ha pogut completar la cerca limitada de resolucions relacionades. Torna-ho a intentar o contrasta manualment les fonts.'};
 try{
 const matching=await db.from('record_enrichments').select('source_record_id').eq('provider_nif',nifs[0]).neq('source_record_id',record.id).limit(51);
 if(matching.error||!matching.data||matching.data.length>50)return issue;
 const ids=[...new Set(matching.data.map(row=>row.source_record_id).filter((id):id is string=>typeof id==='string'))];
 if(!ids.length)return {candidates:[],issue:null};
 const [records,documents]=await Promise.all([
  db.from('source_records').select('id,title,source_payload').eq('financing_type','concert').in('id',ids),
  db.from('source_documents').select('id,source_record_id,status,mime_type,storage_path,storage_sha256,active_extraction_id,extracted_text,extracted_text_hash,extraction_partial,extraction_method,extraction_coverage,quality_flags').in('source_record_id',ids).limit(101),
 ]);
 if(records.error||documents.error||!records.data||!documents.data||documents.data.length>100)return issue;
 const candidates:Array<{recordId:string;title:string;documentId:string;page:number}>=[];
 for(const candidate of records.data){
  const date=candidate.source_payload?.data_publicacio;
  if(typeof date!=='string'||!/^20\d\d-\d\d-\d\d/.test(date)||date.slice(0,10)<=originalDate.slice(0,10))continue;
  const pdfs=documents.data.filter(doc=>doc.source_record_id===candidate.id&&doc.mime_type?.includes('pdf')&&doc.status==='fetched');
  if(pdfs.length!==1)continue;
  const doc=pdfs[0];
  if(!currentDocumentTextConsistent(doc)||doc.extraction_partial!==false||doc.quality_flags?.some((flag:string)=>['corrupt_text','incomplete_extraction'].includes(flag))||!hasCurrentTextCoverage(doc.extraction_method,doc.extraction_coverage,doc.mime_type,doc.extraction_partial))continue;
  const page=provisionalResolutionPage(doc.extracted_text as string,nifs[0],reses);
  if(page)candidates.push({recordId:candidate.id,title:candidate.title,documentId:doc.id,page});
 }
 return {candidates,issue:null};
 }catch{return issue;}
}

export function mapRecord(row: Record<string, unknown>): SourceRecord {
  row={...row,pipeline_jobs:effectiveJobs(row.pipeline_jobs)};
  const jobs=Array.isArray(row.pipeline_jobs)?[...row.pipeline_jobs].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id))):[];
  const reviews=Array.isArray(row.review_decisions)?row.review_decisions.filter(r=>r.pipeline_job_id===jobs[0]?.id):[];
  const analysis=latestAnalysis(row.pipeline_jobs);
  const {candidates:rawCandidates,observations,invalidScoreReason}=projectLatestCandidates(row.pipeline_jobs);
  const unreliable=analysis?.reliability_status==='invalidated'||!!invalidScoreReason;
  const visibleAnalysis=analysis&&invalidScoreReason?{...analysis,reliability_status:'invalidated' as const,reliability_reasons:[...new Set([...(analysis.reliability_reasons??[]),invalidScoreReason])]}:analysis;
  const partialUnitReview=row.financing_type==='conveni'&&jobs[0]?.status==='needs_review'&&isRecipientReviewContainer(analysis);
  return {
    currentJobId: jobs[0]?.id ?? null,
    currentJobStatus: jobs[0]?.status ?? null,
    reviewHistory: Array.isArray(row.review_decisions)?row.review_decisions.map(r=>({id:String(r.id),jobId:r.pipeline_job_id??null,classification:r.classification??null,decision:r.decision,reason:r.reason??null,reasons:r.reasons??[],createdAt:String(r.created_at)})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)):[],
    id: String(row.id), sourceDataset: String(row.source_dataset), financingType: row.financing_type as SourceRecord["financingType"], sourceRecordId: String(row.source_record_id),
    mechanism: String(row.mechanism), title: String(row.title),
    providerName: row.provider_name == null ? null : String(row.provider_name),
    amount: row.financing_type==='conveni' ? ((v)=>v===null?null:v/100)(normalizeConveni((row.source_payload??{}) as Record<string,unknown>).publicCents) : row.amount == null ? null : Number(row.amount), contractVerifiedAward:row.contract_verified_award==null?null:Number(row.contract_verified_award), status: row.processing_status as ProcessingStatus,
    carteraCode: row.cartera_code == null ? null : String(row.cartera_code),
    carteraName: row.cartera_name == null ? null : String(row.cartera_name),
    confidence: row.confidence == null ? null : Number(row.confidence),
    evidence: row.evidence == null ? null : String(row.evidence),
    sourceFile: row.source_file == null ? null : String(row.source_file),
    sourceSheet: row.source_sheet == null ? null : String(row.source_sheet),
    sourceRow: row.source_row == null ? null : Number(row.source_row),
    importRunId:row.import_run_id==null?null:String(row.import_run_id),
    sourceStoragePath:row.storage_path==null?null:String(row.storage_path),
    sourcePayload: (row.source_payload ?? {}) as SourceRecord["sourcePayload"],
    evidenceStatus: row.evidence_status as SourceRecord["evidenceStatus"], evidenceError: row.evidence_error == null ? null : String(row.evidence_error),
    enrichmentStatus: row.enrichment_status as SourceRecord["enrichmentStatus"], enrichmentError: row.enrichment_error == null ? null : String(row.enrichment_error),
    sourceDocuments: Array.isArray(row.source_documents) ? row.source_documents.map((document) => {
      const item = document as Record<string, unknown>;
      const defects=textDefects(String(item.extracted_text ?? item.text_preview ?? ""));
      return {
        revision:`${item.storage_sha256??''}:${item.active_extraction_id??''}`,extractedTextHash:typeof item.extracted_text_hash==='string'?item.extracted_text_hash:null,currentTextConsistent:currentDocumentTextConsistent(item),id: String(item.id), url: String(item.url), documentType: String(item.document_type),
        archived: Boolean(item.storage_path),
        resolution: item.resolution as SourceRecord['sourceDocuments'][number]['resolution'],
        sourceFields: Array.isArray(item.source_fields) ? item.source_fields.map(String) : [],
        status: item.status as SourceRecord["sourceDocuments"][number]["status"],
        mimeType: item.mime_type == null ? null : String(item.mime_type),
        extractedText: item.extracted_text == null ? null : String(item.extracted_text),
        textPreview: item.text_preview == null ? null : String(item.text_preview),
        textLength: item.text_length == null ? null : Number(item.text_length),
        extractionMethod: item.extraction_method == null ? null : String(item.extraction_method),
        extractionPartial: typeof item.extraction_partial==='boolean'?item.extraction_partial:null,
        extractionCoverage: item.extraction_coverage??null,
        qualityScore: defects.includes("corrupt_text") ? 0 : item.quality_score == null ? null : Number(item.quality_score),
        qualityFlags: [...new Set([...(Array.isArray(item.quality_flags) ? item.quality_flags.map(String) : []),...defects])],
        chunkCount: Number(item.chunk_count ?? 0),
      };
    }).sort((a,b)=>Number(b.documentType==='technical_specifications')-Number(a.documentType==='technical_specifications')) : [],
    analysis:visibleAnalysis,
    matchingCandidates: unreliable?[]:rawCandidates,
    unverifiedCandidateObservations: unreliable?[]:observations,
    matchingError: mapLatestMatchingError(row.pipeline_jobs),
    reviewDecision: partialUnitReview?null:mapReviewDecision(reviews),
    reviewActor: partialUnitReview?null:mapLatestReview(reviews)?.actor ?? null,
    reviewReason: partialUnitReview?null:mapLatestReview(reviews)?.reason ?? null,
    reviewedAt: partialUnitReview?null:mapLatestReview(reviews)?.createdAt ?? null,
    updatedAt: row.updated_at == null ? null : String(row.updated_at),
    pipelineRunId: mapLatestRun(row.pipeline_jobs)?.id ?? null,
    batchNumber: mapLatestRun(row.pipeline_jobs)?.number ?? null,
    latestRunPurpose: mapLatestRun(row.pipeline_jobs)?.purpose ?? null,
    externalEnrichment: mapEnrichment(row.record_enrichments),
  };
}


export const RECORD_SELECT = "*,contract_verified_award,source_documents(id,url,resolution,document_type,source_fields,status,mime_type,storage_path,storage_sha256,active_extraction_id,extracted_text,extracted_text_hash,text_preview,text_length,extraction_method,extraction_partial,extraction_coverage,quality_score,quality_flags,chunk_count),record_enrichments(extracted_title,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,summary,confidence,engine_version,scope_facts,record_enrichment_evidence(evidence_chunks(ordinal,content))),review_decisions(id,pipeline_job_id,classification,reasons,decision,reason,reviewer,created_at),pipeline_jobs(id,run_id,status,error_message,created_at,verification_only,analysis_results(*),pipeline_runs(batch_number,parameters),matching_candidates(id,pipeline_job_id,catalog_version_id,rank,target_code,target_name,score,rationale,engine_version,matching_candidate_evidence(explanation,evidence_chunks(ordinal,content))))";

function mapLatestRun(value: unknown) {
  if (!Array.isArray(value) || !value.length) return null;
  const job = [...value].map((item) => item as Record<string, unknown>).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id)))[0];
  const rawRun = Array.isArray(job.pipeline_runs) ? job.pipeline_runs[0] : job.pipeline_runs;
  const run = rawRun as Record<string, unknown> | null;
  const parameters=run?.parameters && typeof run.parameters==='object' ? run.parameters as Record<string,unknown> : null;
  return { id: String(job.run_id), number: run?.batch_number == null ? null : String(run.batch_number).padStart(8, "0"), purpose:parameters?.purpose==null?null:String(parameters.purpose) };
}

export async function getReviewQueue(input: { batchId?: string; type?: string; state?: string; query?: string }): Promise<ReviewQueue> {
  const supabase = createServerSupabase();
  if(!input.batchId){
    const ids:string[]=[];
    for(let offset=0;;offset+=500){
      let q=supabase.from('current_record_results').select('id').not('job_id','is',null);
      if(input.state!=='all')q=q.eq('destination','review');
      if(input.type&&input.type!=='totes')q=q.eq('financing_type',input.type);
      if(input.query){const safe=input.query.replaceAll(/[,%()]/g,' ').trim();q=q.or(`title.ilike.%${safe}%,source_record_id.ilike.%${safe}%,provider_name.ilike.%${safe}%`);}
      const r=await q.order('job_created_at',{ascending:false}).order('id').range(offset,offset+499);
      if(r.error)throw r.error;ids.push(...(r.data??[]).map(x=>x.id));
      if((r.data?.length??0)<500)break;
    }
    const records:SourceRecord[]=[];
    for(let offset=0;offset<ids.length;offset+=100){const r=await supabase.from('source_records').select(RECORD_SELECT).in('id',ids.slice(offset,offset+100));if(r.error)throw r.error;records.push(...(r.data??[]).map(mapRecord));}
    const position=new Map(ids.map((id,i)=>[id,i]));records.sort((a,b)=>position.get(a.id)!-position.get(b.id)!);
    return {records,total:records.length,reviewed:records.filter(r=>!!r.reviewDecision).length};
  }
  const jobs:{id:string;source_record_id:string}[]=[];
  for(let offset=0;;offset+=100){
    let q=supabase.from('pipeline_jobs').select('id,status,source_record_id').eq('run_id',input.batchId).order('created_at').order('id');
    if(input.state!=='all')q=q.eq('status','needs_review');
    const r=await q.range(offset,offset+99);if(r.error)throw r.error;
    jobs.push(...(r.data??[]));
    if((r.data?.length??0)<100)break;
  }
  const rawRecords:Record<string,unknown>[]=[];
  const sourceIds=[...new Set(jobs.map(job=>job.source_record_id))];
  for(let offset=0;offset<sourceIds.length;offset+=100){const r=await supabase.from('source_records').select(RECORD_SELECT).in('id',sourceIds.slice(offset,offset+100));if(r.error)throw r.error;rawRecords.push(...((r.data??[]) as Record<string,unknown>[]));}
  const rawById=new Map(rawRecords.map(raw=>[String(raw.id),raw]));
  const records:SourceRecord[]=[];
  for(const job of jobs){const raw=rawById.get(job.source_record_id);if(!raw)continue;const allJobs=Array.isArray(raw.pipeline_jobs)?raw.pipeline_jobs as Record<string,unknown>[]:[];const selected=allJobs.find(item=>item.id===job.id);if(!selected)continue;const record=mapRecord({...raw,pipeline_jobs:[{...selected,verification_only:false}]});
      if(input.type&&input.type!=='totes'&&record.financingType!==input.type)continue;
      if(input.query&&![record.title,record.sourceRecordId,record.providerName].join(' ').toLowerCase().includes(input.query.toLowerCase()))continue;
      records.push(record);
  }
  return {records,total:records.length,reviewed:records.filter(r=>!!r.reviewDecision).length};
}

function mapEnrichment(value: unknown): SourceRecord["externalEnrichment"] {
  const item = Array.isArray(value) ? value[0] as Record<string, unknown> | undefined : value as Record<string, unknown> | null;
  if (!item) return null;
  const links = Array.isArray(item.record_enrichment_evidence) ? item.record_enrichment_evidence : [];
  const provisional=(item.scope_facts as Record<string,unknown>|null)?.provisional_document_amounts as Record<string,unknown>|undefined;
  const provisionalOriginal=provisional?.version==='concert-provisional-amounts-v1'?{summary:typeof provisional.original_model_summary==='string'?provisional.original_model_summary:null,amount:typeof provisional.original_model_amount==='number'&&Number.isFinite(provisional.original_model_amount)?provisional.original_model_amount:null}:null;
  return { provisionalOriginal, documentaryAuthority:(item.scope_facts as Record<string,unknown>|null)?.documentary_authority??null, title: item.extracted_title == null ? null : String(item.extracted_title), providerName: item.provider_name == null ? null : String(item.provider_name), providerNif: item.provider_nif == null ? null : String(item.provider_nif), mechanism: item.mechanism == null ? null : String(item.mechanism), awardDate: item.award_date == null ? null : String(item.award_date), amount: item.amount == null ? null : Number(item.amount), contractingBody: item.contracting_body == null ? null : String(item.contracting_body), targetPopulation: item.target_population == null ? null : String(item.target_population), summary: String(item.summary), confidence: item.confidence == null ? null : Number(item.confidence), model: String(item.engine_version), evidence: links.flatMap((link) => { const chunk = (link as Record<string, unknown>).evidence_chunks; if (!chunk || typeof chunk !== "object") return []; const evidence = chunk as Record<string, unknown>; return [{ ordinal: Number(evidence.ordinal), content: String(evidence.content) }]; }) };
}

function mapReviewDecision(value: unknown): SourceRecord["reviewDecision"] {
  return mapLatestReview(value)?.decision ?? null;
}

function mapLatestReview(value: unknown) {
  if (!Array.isArray(value) || !value.length) return null;
  const latest = [...value].map((item) => item as Record<string, unknown>).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id)))[0];
  return {
    decision: latest.decision as SourceRecord["reviewDecision"],
    actor: latest.reviewer == null ? null : String(latest.reviewer),
    reason: latest.reason == null ? null : String(latest.reason),
    createdAt: latest.created_at == null ? null : String(latest.created_at),
  };
}
