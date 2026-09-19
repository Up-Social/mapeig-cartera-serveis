import {createClient} from '@supabase/supabase-js';
async function main(){
 if(!process.argv.includes('--read-only'))throw Error('Explicit --read-only required');
 process.loadEnvFile('.env.local');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('Configuration missing');
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{const method=init?.method??(input instanceof Request?input.method:'GET');if(method.toUpperCase()!=='GET')throw Error('Preflight forbids every non-GET request');return fetch(input,init);}}});
 const latest=await db.from('pipeline_runs').select('id,batch_number,created_at,status').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).single();if(latest.error)throw latest.error;
 const jobs=[];
 for(let offset=0;;offset+=500){const page=await db.from('pipeline_jobs').select('id,source_record_id,status,analysis_results(classification,reviewed_classification),source_records(source_record_id,source_documents(id,status,chunk_count,content_hash,url))').eq('run_id',latest.data.id).order('source_record_id').range(offset,offset+499);if(page.error)throw page.error;jobs.push(...page.data);if(page.data.length<500)break;}
 const members=jobs.map(j=>{const r=(Array.isArray(j.source_records)?j.source_records[0]:j.source_records),a=(Array.isArray(j.analysis_results)?j.analysis_results[0]:j.analysis_results) as {classification:string;reviewed_classification:string|null}|null;return {recordId:j.source_record_id,jobId:j.id,externalId:r?.source_record_id,execution:j.status,automaticClassification:a?.classification??null,humanClassification:a?.reviewed_classification??null,documents:r?.source_documents??[]};});
 const summary:Record<string,number>={};for(const member of members){const key=member.automaticClassification??member.execution;summary[key]=(summary[key]??0)+1;}
 const related=await db.from('pipeline_jobs').select('id,run_id,status').in('source_record_id',members.map(m=>m.recordId));if(related.error)throw related.error;
 const tasks=await db.from('worker_tasks').select('id,status,execution_state,failure_kind').in('run_id',[...new Set(related.data.map(j=>j.run_id))]);if(tasks.error)throw tasks.error;
 const unresolved=tasks.data.length?await db.from('cloud_checkpoints').select('task_id,item_key').in('task_id',tasks.data.map(t=>t.id)).eq('value->>state','sending'):{data:[],error:null};if(unresolved.error)throw unresolved.error;
 const activeJobs=related.data.filter(j=>['queued','selected','preparing','ready','matching'].includes(j.status));
 const output={observedAt:new Date().toISOString(),target:new URL(url).hostname,origin:latest.data,count:members.length,provider:'openai',model:process.env.OPENAI_MATCHING_MODEL??null,estimatedCost:null,estimatedSeconds:null,summary,members,activeJobs,activeTasks:tasks.data.filter(t=>['queued','running'].includes(t.status)),unresolvedProviderReferences:unresolved.data,boundary:'READ ONLY. No new batch, provider calls, migrations, deploy or push. Historical evidence missing from the old schema cannot be reconstructed.'};
 console.log(JSON.stringify(process.argv.includes('--summary')?{...output,members:members.map(m=>({recordId:m.recordId,externalId:m.externalId,storedExtractions:m.documents.filter(d=>d.status==='fetched'&&d.chunk_count>0).length,reuseValidated:false,rediscoveryRequired:m.documents.some(d=>d.url.includes('contractaciopublica.cat')||d.url.includes('tauler.seu-e.cat')||d.status!=='fetched')}))}:output,null,2));
}
main().catch(error=>{console.error(error.message??'Read-only preflight failed');process.exitCode=1;});
