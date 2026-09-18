import type {SupabaseClient} from '@supabase/supabase-js';
import {assertTestEnvironment} from './test-environment';
import {loadOfficialCatalog} from './official-catalog';
import {CLASSIFICATIONS,validateAnalysis,type Classification} from './analysis-contract';
// Never a provider fallback: only the identified isolated database may execute this runner.
export async function runMockWorkflow(db:SupabaseClient,taskId:string){
 assertTestEnvironment(process.env);
 const task=await db.from('worker_tasks').select('*').eq('id',taskId).single();if(task.error)throw task.error;
 let query=db.from('pipeline_jobs').select('*,source_records(*)');query=task.data.pipeline_job_id?query.eq('id',task.data.pipeline_job_id):query.eq('run_id',task.data.run_id);
 const jobs=await query;if(jobs.error)throw jobs.error;
 if(!jobs.data.length||jobs.data.some(j=>j.source_records.source_payload?.fixture!==true))throw Error('Mock runner refuses non-fixture records');
 const catalog=await loadOfficialCatalog(db),service=catalog.eligible[0];
 const check=(r:{error:unknown})=>{if(r.error)throw r.error;};
 check(await db.from('worker_tasks').update({status:'running'}).eq('id',taskId));
 for(const job of jobs.data){
  if(job.status==='needs_review')continue;
  const record=job.source_records;
  const content=`FITXA FICTÍCIA, SENSE DADES REALS. Servei: ${service.service_name}. Document de prova amb evidència suficient per a comprovar la interfície.`;
  let doc=await db.from('source_documents').select('id').eq('source_record_id',record.id).limit(1).maybeSingle();check(doc);
  if(!doc.data){doc=await db.from('source_documents').insert({source_record_id:record.id,url:`https://example.org/workflow-fixture/${record.id}`,url_hash:'mock-'+record.id,document_type:'publication',status:'fetched',extracted_text:content,content_hash:'mock-'+record.id}).select('id').single();check(doc);}
  const d=doc.data!;
  const existing=await db.from('current_evidence_chunks').select('id,content').eq('source_document_id',d.id);check(existing);
  if(!existing.data?.length)check(await db.rpc('replace_document_chunks',{p_document:d.id,p_chunks:[{ordinal:0,content,content_hash:'mock-'+record.id}],p_metadata:{text_preview:content,quality_score:1,quality_flags:[],extracted_text_hash:'mock-'+record.id}}));
  check(await db.from('source_documents').update({status:'fetched',chunk_count:1}).eq('id',d.id));
  check(await db.from('source_records').update({evidence_status:'ready',processing_status:'preparat'}).eq('id',record.id));
  check(await db.from('pipeline_jobs').update({preparation_status:'ready',status:'ready'}).eq('id',job.id));
  if(task.data.task_type==='prepare_run')continue;
  check(await db.from('record_enrichments').upsert({source_record_id:record.id,summary:'Contrast fictici, proveïdor simulat.',confidence:1,engine:'mock',engine_version:'fixture-v1'},{onConflict:'source_record_id'}));
  check(await db.from('source_records').update({enrichment_status:'completed'}).eq('id',record.id));
  if(task.data.task_type==='enrich_record')continue;
  const chunks=await db.from('current_evidence_chunks').select('id,content').eq('source_document_id',d.id);check(chunks);
  const classification=(CLASSIFICATIONS.includes(record.source_payload.fixture_classification)?record.source_payload.fixture_classification:'insufficient_evidence') as Classification;
  const output=validateAnalysis({classification,reasons:classification==='discarded'?['individual_grant']:[],explanation:'Resultat fictici del proveïdor simulat. Requereix revisió humana.',service_description:service.service_name,target_population:'Població fictícia',evidence_ordinals:[1],population_verified:true,social_service_verified:true,candidates:classification==='in_portfolio'?[{code:service.service_code,score:0.9,rationale:'Proposta fictícia sustentada en un document de prova local, sense cap dada real.',evidence_ordinals:[1],evidence_explanation:'Fragment fictici de prova local.',population_compatible:true,legal_reference:service.legal_reference}]:[]},catalog.all,1);
  check(await db.rpc('persist_analysis',{p_job:job.id,p_version:catalog.version.id,p_result:output,p_candidates:output.candidates.map(c=>({...c,model:'mock',metadata:{provider:'mock'},evidence:chunks.data})),p_evidence:chunks.data}));
 }
 check(await db.from('worker_tasks').update({status:'completed',completed_at:new Date().toISOString()}).eq('id',taskId));
 if(task.data.run_id)check(await db.rpc('refresh_pipeline_run',{p_run_id:task.data.run_id}));
}
