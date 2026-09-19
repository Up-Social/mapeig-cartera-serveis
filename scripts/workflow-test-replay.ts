import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {assertTestEnvironment,TEST_PROJECT} from '../lib/test-environment';
const status=JSON.parse(execFileSync('supabase',['status','--workdir','tests/runtime','-o','json'],{encoding:'utf8'}));
assertTestEnvironment({NEXT_PUBLIC_SUPABASE_URL:status.API_URL,WORKFLOW_TEST_PROJECT:TEST_PROJECT,PIPELINE_PROVIDER:'mock'});
const container=`supabase_db_${TEST_PROJECT}`,database=`workflow_replay_${Date.now()}`;
function sql(input:string,db=database,user='postgres'){return execFileSync('docker',['exec','-i',container,'psql','-U',user,'-d',db,'-X','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',maxBuffer:20*1024*1024});}
// Copy only Supabase-managed schemas, never application tables or real data.
const foundation=execFileSync('docker',['exec',container,'pg_dump','-U','postgres','-d','postgres','--schema-only','--exclude-schema=public'],{encoding:'utf8',maxBuffer:20*1024*1024});
sql(`create database ${database};`,'postgres');
sql(foundation,database,'supabase_admin');
let count=0;
for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()){try{sql(`begin;\n${readFileSync(`supabase/migrations/${file}`,'utf8')}\ncommit;`);count++;}catch{throw Error(`Fresh replay failed at ${file}`);}}
const catalog=JSON.parse(readFileSync('data/legal/cartera.json','utf8'));
sql(`select install_official_catalog('${JSON.stringify(catalog.version).replaceAll("'","''")}'::jsonb,'${JSON.stringify(catalog.services).replaceAll("'","''")}'::jsonb);`);
sql(`insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values('aaaaaaaa-0000-4000-8000-000000000001','contractacions','REPLAY-FIXTURE','Contractació pública','Fixture replay','{"fixture":true}');`);
for(const file of readdirSync('tests/sql').filter(f=>f.endsWith('.sql')).sort()){sql(`begin;\nset local role service_role;\n${readFileSync(`tests/sql/${file}`,'utf8')}\nrollback;`);console.log(`PASS fresh service_role ${file}`);}
console.log(JSON.stringify({database,migrations:count,tests:'passed',scope:'isolated local container only'}));
