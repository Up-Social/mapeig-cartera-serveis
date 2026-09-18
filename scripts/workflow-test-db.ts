import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {TEST_API, TEST_PROJECT, assertTestEnvironment} from '../lib/test-environment';

async function main() {
// Uses only a separately named Docker project. Never reads .env.local.
const container = `supabase_db_${TEST_PROJECT}`;
const status = JSON.parse(execFileSync('supabase',['status','--workdir','tests/runtime','-o','json'],{encoding:'utf8'}));
const env = {NEXT_PUBLIC_SUPABASE_URL:status.API_URL, WORKFLOW_TEST_PROJECT:TEST_PROJECT, PIPELINE_PROVIDER:'mock'};
assertTestEnvironment(env);
function sql(input:string) {return execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-At'],{input,encoding:'utf8'});}
sql('create table if not exists public.workflow_test_migrations (name text primary key); revoke all on public.workflow_test_migrations from public, anon, authenticated;');
const applied=new Set(sql('select name from public.workflow_test_migrations').trim().split('\n'));
for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) {
  if(applied.has(file))continue;
  sql(`begin;\n${readFileSync(`supabase/migrations/${file}`,'utf8')}\ninsert into public.workflow_test_migrations values ('${file.replaceAll("'","''")}');\ncommit;`);
  console.log(`Applied ${file}`);
}
sql("NOTIFY pgrst, 'reload schema';");
await new Promise(resolve=>setTimeout(resolve,1000));
const db=createClient(TEST_API,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const catalog=JSON.parse(readFileSync('data/legal/cartera.json','utf8'));
const current=await db.from('catalog_versions').select('id').eq('id',catalog.version.id).maybeSingle();
if(current.error)throw new Error(current.error.message);
if(!current.data){const r=await db.rpc('install_official_catalog',{p_version:catalog.version,p_services:catalog.services});if(r.error)throw new Error(r.error.message);}
console.log('Isolated schema and official catalog ready');
sql(`insert into public.source_records(id,source_dataset,source_record_id,mechanism,title,provider_name,suggested_code,suggested_name,suggested_confidence,suggested_evidence,source_payload)
values('aaaaaaaa-0000-4000-8000-000000000001','contractacions','WORKFLOW-TEST-001','Contractació pública','Servei fictici de prova aïllada','Entitat fictícia','','',0,'', '{"fixture":true}') on conflict(id) do nothing;`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
