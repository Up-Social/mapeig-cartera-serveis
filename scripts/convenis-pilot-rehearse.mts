/* eslint-disable @typescript-eslint/no-explicit-any -- Dynamic JSON snapshots retain the database schema without lossy field mapping. */
/** Backup/restore rehearsal for the fixed pilot container only. Never connects to production. */
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {PILOT_API,PILOT_PROJECT,assertPilotTarget} from '../lib/convenis/pilot-budget';
const root='docs/local/piloto-convenis-2026-10-18/ejecucion/rehearsal-fixed',container=`supabase_db_${PILOT_PROJECT}`;
const status=JSON.parse(execFileSync('supabase',['status','--workdir','.cache/convenis-pilot-runtime','-o','json'],{encoding:'utf8',stdio:['pipe','pipe','pipe']}));assertPilotTarget(status.API_URL,PILOT_PROJECT);
const db=createClient(PILOT_API,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const identity=await db.from('pilot_runtime_identity').select('*').single();if(identity.error||identity.data.project!==PILOT_PROJECT)throw Error('Wrong pilot');
const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:PILOT_API,SUPABASE_SECRET_KEY:status.SERVICE_ROLE_KEY};
function sql(input:string,database='postgres'){return execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d',database,'-X','-v','ON_ERROR_STOP=1','-At'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']});}
function fingerprint(database='postgres'){
 const tables=JSON.parse(sql("select json_agg(tablename order by tablename) from pg_tables where schemaname='public';",database));
 const queries=tables.map((t:string)=>`select '${t}' as table_name,count(*) as rows,md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t))::text,'')) as fingerprint from public.\"${t}\" t`);
 return JSON.parse(sql(`select json_agg(x order by table_name) from (${queries.join(' union all ')}) x;`,database));
}
await mkdir(root,{recursive:true});
const before=fingerprint();
const backup=execFileSync('docker',['exec',container,'pg_dump','-U','postgres','-d','postgres','-Fc','--no-owner'],{maxBuffer:100*1024*1024,stdio:['pipe','pipe','pipe']});
await writeFile(`${root}/baseline.dump`,backup,{flag:'wx',mode:0o600});
await writeFile(`${root}/baseline-fingerprints.json`,JSON.stringify(before,null,2),{flag:'wx'});
const objects=JSON.parse(await readFile('docs/local/piloto-convenis-2026-10-18/ejecucion/clone-report.json','utf8')).objects;
await mkdir(`${root}/storage-baseline`,{recursive:true});
for(const object of objects){const r=await db.storage.from('cloud-documents').download(object.path);if(r.error)throw r.error;await writeFile(`${root}/storage-baseline/${object.sha256}`,Buffer.from(await r.data.arrayBuffer()),{mode:0o600});}
const run=(args:string[])=>execFileSync(process.execPath,['--import','tsx','scripts/conveni-amount-migration.ts',...args],{env,encoding:'utf8',stdio:['pipe','pipe','pipe']});
console.log(run(['--output',`${root}/preview-rehearsal-all.json`]).trim());
const p=JSON.parse(await readFile(`${root}/preview-rehearsal-all.json`,'utf8'));
const wanted=new Set(JSON.parse(await readFile('docs/local/piloto-convenis-2026-10-18/migracion-candidatos.json','utf8')).differences.map((r:any)=>r.database_id));
p.entries=p.entries.filter((e:any)=>wanted.has(e.id));if(p.entries.length!==5||p.entries.some((e:any)=>!e.eligible))throw Error('Rehearsal manifest changed');
const path=`${root}/preview-rehearsal-five.json`;await writeFile(path,JSON.stringify(p,null,2),{flag:'wx'});
console.log(run(['--apply',path,'--execute']).trim());console.log(run(['--apply',path,'--execute']).trim());
for(const e of p.entries){const r=await db.from('source_records').select('amount').eq('id',e.id).single();if(r.error||r.data.amount!==e.after_amount)throw Error('Apply mismatch');}
console.log(run(['--revert',path,'--execute']).trim());console.log(run(['--revert',path,'--execute']).trim());
for(const e of p.entries){const r=await db.from('source_records').select('amount').eq('id',e.id).single();if(r.error||r.data.amount!==e.before_amount)throw Error('Revert mismatch');}
const after=fingerprint();
if(JSON.stringify(before.filter((x:any)=>x.table_name!=='conveni_amount_operations'))!==JSON.stringify(after.filter((x:any)=>x.table_name!=='conveni_amount_operations')))throw Error('Rehearsal changed other application data');
const restore=`pilot_restore_${Date.now()}`;sql(`create database ${restore};`);
execFileSync('docker',['exec','-i',container,'pg_restore','-U','supabase_admin','-d',restore,'--no-owner','--no-privileges','--exit-on-error','--clean','--if-exists'],{input:backup,maxBuffer:10*1024*1024,stdio:['pipe','pipe','pipe']});
const restored=fingerprint(restore);if(JSON.stringify(before)!==JSON.stringify(restored))throw Error('Restore fingerprints differ');
const report={project:PILOT_PROJECT,backup:'baseline.dump',restore_database:restore,tables_compared:before.length,rows_restored:restored.reduce((n:number,r:any)=>n+Number(r.rows),0),operations:5,apply_idempotent:true,revert_idempotent:true,other_data_unchanged:true,full_restore_verified:true,storage_objects_backed_up:objects.length,at:new Date().toISOString()};
await writeFile(`${root}/rehearsal-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
