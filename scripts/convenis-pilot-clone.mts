/* eslint-disable @typescript-eslint/no-explicit-any -- Dynamic JSON snapshots retain the database schema without lossy field mapping. */
/** Explicit approved pilot. Source client is GET-only; every SQL mutation uses the fixed local container. */
import {createClient} from '@supabase/supabase-js';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {readdirSync,readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {PILOT_API,PILOT_PROJECT,assertPilotTarget} from '../lib/convenis/pilot-budget';
const root='docs/local/piloto-convenis-2026-10-18/ejecucion';
await mkdir(root,{recursive:true});
const selection=JSON.parse(await readFile('docs/local/piloto-convenis-2026-10-18/muestra-propuesta.json','utf8'));
if(selection.rows.length!==24||selection.budget_usd!==6)throw Error('Approval changed');
const sourceUrl=process.env.NEXT_PUBLIC_SUPABASE_URL!,sourceKey=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY!;
if(new URL(sourceUrl).origin!=='https://vvzxlevbfjvzygorbpxn.supabase.co')throw Error('Unexpected read-only source');
const safeFetch:typeof fetch=(input,init)=>{
 const method=init?.method??(input instanceof Request?input.method:'GET');
 if(method.toUpperCase()!=='GET')throw Error('SOURCE_READ_ONLY');return fetch(input,init);
};
const source=createClient(sourceUrl,sourceKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:safeFetch}});
const status=JSON.parse(execFileSync('supabase',['status','--workdir','.cache/convenis-pilot-runtime','-o','json'],{encoding:'utf8',stdio:['pipe','pipe','pipe']}));
assertPilotTarget(status.API_URL,PILOT_PROJECT);
const local=createClient(PILOT_API,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const container=`supabase_db_${PILOT_PROJECT}`;
function sql(input:string){return execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-At'],{input,encoding:'utf8',maxBuffer:30*1024*1024,stdio:['pipe','pipe','pipe']});}
async function rows(table:string,column?:string,ids?:string[]){
 if(ids&&!ids.length)return [];
 const out:Record<string,any>[]=[];
 for(let from=0;;from+=500){let q=source.from(table).select('*');if(column&&ids)q=q.in(column,ids);const r=await q.order(table==='official_services'?'service_code':'id').range(from,from+499);if(r.error)throw Error(`Source SELECT ${table}: ${r.error.message}`);out.push(...r.data);if(r.data.length<500)return out;}
}
if(sql("select to_regclass('public.pilot_runtime_identity') is not null;").trim()==='t')throw Error('Pilot already initialized; never overwrite');
let migrations=0;
const schemaReady=sql("select to_regprocedure('public.conveni_source_hash(uuid)') is not null;").trim()==='t';
for(const name of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()){if(!schemaReady)sql(`begin;${readFileSync(`supabase/migrations/${name}`,'utf8')}commit;`);migrations++;}
if(Number(sql('select count(*) from source_records;').trim())!==0)throw Error('Pilot must start empty');
const ids=selection.rows.map((r:any)=>r.database_id);
const data:Record<string,Record<string,any>[]>={};
data.source_records=await rows('source_records','id',ids);
if(data.source_records.length!==24||data.source_records.some(r=>r.financing_type!=='conveni'||!selection.rows.some((s:any)=>s.database_id===r.id&&s.official_id===r.source_record_id)))throw Error('Source sample changed');
data.review_decisions=await rows('review_decisions','source_record_id',ids);
data.service_provisions=await rows('service_provisions','source_record_id',ids);
if(data.review_decisions.length||data.service_provisions.some(p=>!p.superseded_at))throw Error('New review or provision; recheck approval');
data.import_runs=await rows('import_runs','id',[...new Set(data.source_records.map(r=>r.import_run_id).filter(Boolean))]);
data.source_documents=await rows('source_documents','source_record_id',ids);
data.pipeline_jobs=await rows('pipeline_jobs','source_record_id',ids);
const jobs=data.pipeline_jobs.map(j=>j.id),runs=[...new Set(data.pipeline_jobs.map(j=>j.run_id))],docs=data.source_documents.map(d=>d.id);
data.pipeline_runs=await rows('pipeline_runs','id',runs);
for(const table of ['record_enrichments','record_units','analysis_results'])data[table]=await rows(table,'source_record_id',ids);
for(const table of ['matching_candidates','job_attempts','job_snapshots','provider_calls'])data[table]=await rows(table,'pipeline_job_id',jobs);
data.document_versions=await rows('document_versions','source_document_id',docs);
data.evidence_chunks=await rows('evidence_chunks','source_document_id',docs);
const snapshots=data.job_snapshots.map(s=>s.id);
if(snapshots.length){const q=await source.from('job_document_versions').select('*').in('snapshot_id',snapshots);if(q.error)throw q.error;data.job_document_versions=q.data;}else data.job_document_versions=[];
const active=await source.from('worker_tasks').select('id,status,lease_until').or(`source_record_id.in.(${ids.join(',')}),run_id.in.(${runs.length?runs.join(','):randomUUID()})`);
if(active.error||active.data.some(t=>['queued','running'].includes(t.status)||(t.lease_until&&Date.parse(t.lease_until)>Date.now()))||data.provider_calls.some(c=>c.state==='sending'))throw Error('Source has active or unknown operations');
const cat=await source.from('catalog_versions').select('*');if(cat.error)throw cat.error;
data.catalog_versions=cat.data;
const activeCatalog=data.catalog_versions.find(c=>c.active&&c.validated);
if(activeCatalog?.id!=='pjc-557820-2164168')throw Error('Approved active catalog changed');
data.official_services=await rows('official_services','version_id',data.catalog_versions.map(c=>c.id));
// Preserve a read-only snapshot separately. No workers, credentials or dispatch state are cloned.
const snapshot={observed_at:new Date().toISOString(),source:sourceUrl,catalog:activeCatalog.id,data};
try {const prior=JSON.parse(await readFile(`${root}/source-snapshot.json`,'utf8'));if(JSON.stringify(prior.data)!==JSON.stringify(data))throw Error('Source snapshot changed');} catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;await writeFile(`${root}/source-snapshot.json`,JSON.stringify(snapshot),{flag:'wx',mode:0o600});}
const order=['catalog_versions','official_services','import_runs','source_records','source_documents','pipeline_runs','pipeline_jobs','record_enrichments','record_units','analysis_results','matching_candidates','review_decisions','service_provisions','job_attempts','job_snapshots','document_versions','job_document_versions','evidence_chunks','provider_calls'];
let input='begin;';
for(const table of order)input+=`alter table public.${table} disable trigger user;`;
for(const table of order){
 const rs=data[table];if(!rs.length)continue;
 const cols=JSON.parse(sql(`select json_agg(column_name) from information_schema.columns where table_schema='public' and table_name='${table}' and is_generated='NEVER';`).trim());
 const keys=Object.keys(rs[0]).filter(k=>cols.includes(k));const list=keys.map(k=>`"${k}"`).join(',');const tag=`$pilot_${randomUUID().replaceAll('-','')}$`;
 input+=`insert into public.${table}(${list}) select ${list} from jsonb_populate_recordset(null::public.${table},${tag}${JSON.stringify(rs)}${tag}::jsonb);`;
}
input+='set constraints all immediate;';
for(const table of order)input+=`alter table public.${table} enable trigger user;`;
input+=`create table public.pilot_runtime_identity(project text primary key,catalog_id text not null,sample jsonb not null);revoke all on public.pilot_runtime_identity from public,anon,authenticated;grant select on public.pilot_runtime_identity to service_role;insert into public.pilot_runtime_identity values('${PILOT_PROJECT}','${activeCatalog.id}','${JSON.stringify(ids)}');commit;`;
sql(input);
// Compatibility is local only, required by this CLI's Storage API image.
execFileSync('docker',['exec','-i',container,'psql','-U','supabase_admin','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:'create unique index if not exists pilot_storage_current_name_key on storage.objects(bucket_id,name collate "C") where archived_at is null;',stdio:['pipe','pipe','pipe']});
sql("NOTIFY pgrst, 'reload schema';");
const objects=new Map<string,string|null>();
for(const r of [...data.source_records,...data.source_documents,...data.record_units])if(r.storage_path)objects.set(r.storage_path,r.storage_sha256??null);
for(const r of data.import_runs)for(const entry of Object.values(r.storage_manifest??{}) as any[])if(entry.path)objects.set(entry.path,entry.sha256??null);
const copied=[];
for(const [path,expected] of objects){
 const original=await source.storage.from('cloud-documents').download(path);if(original.error||!original.data)throw Error(`Source archived object unavailable: ${path}`);
 const bytes=Buffer.from(await original.data.arrayBuffer()),digest=createHash('sha256').update(bytes).digest('hex');if(expected&&digest!==expected)throw Error('Source storage hash mismatch');
 const uploaded=await local.storage.from('cloud-documents').upload(path,bytes,{contentType:original.data.type||'application/octet-stream'});if(uploaded.error)throw Error(uploaded.error.message);
 const check=await local.storage.from('cloud-documents').download(path);if(check.error||createHash('sha256').update(Buffer.from(await check.data!.arrayBuffer())).digest('hex')!==digest)throw Error('Copied object hash mismatch');
 copied.push({path,sha256:digest,bytes:bytes.length});
}
const after=await rows('source_records','id',ids);
if(JSON.stringify(after)!==JSON.stringify(data.source_records))throw Error('Source changed while cloning');
const summary={project:PILOT_PROJECT,api:PILOT_API,migrations,rows:24,catalog:activeCatalog.id,history:Object.fromEntries(order.map(t=>[t,data[t].length])),objects:copied,source_unchanged:true};
await writeFile(`${root}/clone-report.json`,JSON.stringify(summary,null,2));
console.log(JSON.stringify({...summary,objects:copied.length}));
