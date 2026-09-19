import officialSnapshot from '../data/legal/cartera.json';
import {eligibleServices,type OfficialService} from './official-catalog';
const officialByCode=new Map(eligibleServices(officialSnapshot.services as OfficialService[]).map(s=>[s.service_code,s]));
import {latestAnalysis} from './latest-analysis';
import "server-only";
import { createClient } from "@supabase/supabase-js";
import {assertTestEnvironment} from './test-environment';
import type { ProcessingStatus, ReviewQueue, SourcePage, SourceRecord } from "./workbench-types";
import { mapLatestMatchingError } from "./matching-state";

export const PAGE_SIZE = 25;

export function createServerSupabase() {
  if (process.env.WORKFLOW_TEST_PROJECT) assertTestEnvironment(process.env);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Falten les variables de Supabase a .env.local");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function getSourcePage(input: { page: number; query: string; type: string }): Promise<SourcePage> {
  const supabase = createServerSupabase();
  const from = (input.page - 1) * PAGE_SIZE;
  let request = supabase.from("source_records").select(RECORD_SELECT, { count: "exact" });
  if (input.type !== "totes") request = request.eq("financing_type", input.type);
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
  const db=createServerSupabase();
  const count=async(destination:string)=>{const r=await db.from('current_record_results').select('id',{count:'exact',head:true}).eq('destination',destination);if(r.error)throw r.error;return r.count??0;};
  const [queued,completed,review]=await Promise.all([count('processing'),count('approved'),count('review')]);
  return {queued,completed,review};
}

export function mapRecord(row: Record<string, unknown>): SourceRecord {
  const jobs=Array.isArray(row.pipeline_jobs)?[...row.pipeline_jobs].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id))):[];
  const reviews=Array.isArray(row.review_decisions)?row.review_decisions.filter(r=>r.pipeline_job_id===jobs[0]?.id):[];
  return {
    currentJobId: jobs[0]?.id ?? null,
    currentJobStatus: jobs[0]?.status ?? null,
    reviewHistory: Array.isArray(row.review_decisions)?row.review_decisions.map(r=>({id:String(r.id),jobId:r.pipeline_job_id??null,classification:r.classification??null,decision:r.decision,reason:r.reason??null,reasons:r.reasons??[],createdAt:String(r.created_at)})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)):[],
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
        resolution: item.resolution as SourceRecord['sourceDocuments'][number]['resolution'],
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
    }).sort((a,b)=>Number(b.documentType==='technical_specifications')-Number(a.documentType==='technical_specifications')) : [],
    analysis:latestAnalysis(row.pipeline_jobs),
    matchingCandidates: mapLatestCandidates(row.pipeline_jobs),
    matchingError: mapLatestMatchingError(row.pipeline_jobs),
    reviewDecision: mapReviewDecision(reviews),
    reviewReason: mapLatestReview(reviews)?.reason ?? null,
    reviewedAt: mapLatestReview(reviews)?.createdAt ?? null,
    updatedAt: row.updated_at == null ? null : String(row.updated_at),
    pipelineRunId: mapLatestRun(row.pipeline_jobs)?.id ?? null,
    batchNumber: mapLatestRun(row.pipeline_jobs)?.number ?? null,
    externalEnrichment: mapEnrichment(row.record_enrichments),
  };
}

export function mapLatestCandidates(value: unknown): SourceRecord["matchingCandidates"] {
  if (!Array.isArray(value)) return [];
  const jobs = [...value].map((job) => job as Record<string, unknown>).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id)));
  const latest = jobs[0];
  if (!latest || !Array.isArray(latest.matching_candidates)) return [];
  return latest.matching_candidates.filter(candidate => officialByCode.has(String((candidate as Record<string,unknown>).target_code))).map((candidate) => {
    const item = candidate as Record<string, unknown>;
    const links = Array.isArray(item.matching_candidate_evidence) ? item.matching_candidate_evidence : [];
    return {
      id: String(item.id), pipelineJobId: String(item.pipeline_job_id), rank: Number(item.rank), targetCode: String(item.target_code), targetName: String(item.target_name),
      score: Number(item.score), rationale: String(item.rationale), model: String(item.engine_version),
      serviceDetail: {sectorScope:officialByCode.get(String(item.target_code))?.target_population??null,portfolioStatus:"Dentro"},
      legalReference:officialByCode.get(String(item.target_code))?.legal_reference,
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

export const RECORD_SELECT = "*,source_documents(id,url,resolution,document_type,source_fields,status,mime_type,text_preview,text_length,extraction_method,quality_score,quality_flags,chunk_count),record_enrichments(extracted_title,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,summary,confidence,engine_version,record_enrichment_evidence(evidence_chunks(ordinal,content))),review_decisions(id,pipeline_job_id,classification,reasons,decision,reason,created_at),pipeline_jobs(id,run_id,status,error_message,created_at,analysis_results(*),pipeline_runs(batch_number),matching_candidates(id,pipeline_job_id,rank,target_code,target_name,score,rationale,engine_version,matching_candidate_evidence(explanation,evidence_chunks(ordinal,content))))";

function mapLatestRun(value: unknown) {
  if (!Array.isArray(value) || !value.length) return null;
  const job = [...value].map((item) => item as Record<string, unknown>).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id)))[0];
  const rawRun = Array.isArray(job.pipeline_runs) ? job.pipeline_runs[0] : job.pipeline_runs;
  const run = rawRun as Record<string, unknown> | null;
  return { id: String(job.run_id), number: run?.batch_number == null ? null : String(run.batch_number).padStart(8, "0") };
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
  const {getJobRecord}=await import('./job-record');
  const records:SourceRecord[]=[];
  for(let offset=0;;offset+=100){
    let q=supabase.from('pipeline_jobs').select('id,status').eq('run_id',input.batchId).order('created_at').order('id');
    if(input.state!=='all')q=q.eq('status','needs_review');
    const r=await q.range(offset,offset+99);if(r.error)throw r.error;
    for(const job of r.data??[]){const record=await getJobRecord(job.id);if(!record)continue;
      if(input.type&&input.type!=='totes'&&record.financingType!==input.type)continue;
      if(input.query&&![record.title,record.sourceRecordId,record.providerName].join(' ').toLowerCase().includes(input.query.toLowerCase()))continue;
      records.push(record);
    }
    if((r.data?.length??0)<100)break;
  }
  return {records,total:records.length,reviewed:records.filter(r=>!!r.reviewDecision).length};
}

function mapEnrichment(value: unknown): SourceRecord["externalEnrichment"] {
  const item = Array.isArray(value) ? value[0] as Record<string, unknown> | undefined : value as Record<string, unknown> | null;
  if (!item) return null;
  const links = Array.isArray(item.record_enrichment_evidence) ? item.record_enrichment_evidence : [];
  return { title: item.extracted_title == null ? null : String(item.extracted_title), providerName: item.provider_name == null ? null : String(item.provider_name), providerNif: item.provider_nif == null ? null : String(item.provider_nif), mechanism: item.mechanism == null ? null : String(item.mechanism), awardDate: item.award_date == null ? null : String(item.award_date), amount: item.amount == null ? null : Number(item.amount), contractingBody: item.contracting_body == null ? null : String(item.contracting_body), targetPopulation: item.target_population == null ? null : String(item.target_population), summary: String(item.summary), confidence: Number(item.confidence), model: String(item.engine_version), evidence: links.flatMap((link) => { const chunk = (link as Record<string, unknown>).evidence_chunks; if (!chunk || typeof chunk !== "object") return []; const evidence = chunk as Record<string, unknown>; return [{ ordinal: Number(evidence.ordinal), content: String(evidence.content) }]; }) };
}

function mapReviewDecision(value: unknown): SourceRecord["reviewDecision"] {
  return mapLatestReview(value)?.decision ?? null;
}

function mapLatestReview(value: unknown) {
  if (!Array.isArray(value) || !value.length) return null;
  const latest = [...value].map((item) => item as Record<string, unknown>).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id)))[0];
  return {
    decision: latest.decision as SourceRecord["reviewDecision"],
    reason: latest.reason == null ? null : String(latest.reason),
    createdAt: latest.created_at == null ? null : String(latest.created_at),
  };
}
