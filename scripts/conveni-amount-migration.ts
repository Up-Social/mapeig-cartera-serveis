/** Two-phase selective correction. Preview is the default; never reimport rows. */
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {readPages} from '../lib/read-pages';
import {isUuid} from '../lib/uuid';
type Entry={id:string;source_record_id:string;before_amount:number|null;after_amount:number|null;source_hash:string;has_human_review:boolean;has_active_provision:boolean;operation_id:string;eligible:boolean};
type Manifest={version:1;database:string;created_at:string;entries:Entry[]};
const option=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
async function main(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('Missing database configuration');
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const apply=option('--apply'),revert=option('--revert');
 if(apply&&revert)throw Error('Choose apply OR revert');
 if(!apply&&!revert){
  const rows=await readPages((from,to)=>db.from('conveni_amount_preview').select('*').order('id').range(from,to));
  const entries=rows.filter(r=>r.before_amount!==r.after_amount).map(r=>({...r,operation_id:randomUUID(),eligible:r.after_amount!==null&&!r.has_human_review&&!r.has_active_provision})) as Entry[];
  const manifest:Manifest={version:1,database:new URL(url).origin,created_at:new Date().toISOString(),entries};
  const path=resolve(option('--output')??`docs/local/conveni-amount-preview-${Date.now()}.json`);await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(manifest,null,2),{flag:'wx'});
  console.log(`${entries.length} differing rows; ${entries.filter(e=>e.eligible).length} eligible for selective correction. No data changed. Manifest: ${path}`);return;
 }
 if(!process.argv.includes('--execute'))throw Error('Review the preview manifest first, then explicitly add --execute');
 const local=['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
 if(!local&&!process.argv.includes('--allow-remote-write'))throw Error('Remote writes require separate authorization and --allow-remote-write');
 const manifest=JSON.parse(await readFile(resolve((apply??revert)!), 'utf8')) as Manifest;
 if(manifest.version!==1||manifest.database!==new URL(url).origin||!Array.isArray(manifest.entries))throw Error('Manifest does not match this database');
 const entries=manifest.entries.filter(e=>e.eligible);
 if(entries.some(e=>!isUuid(e.id)||!isUuid(e.operation_id)||!e.source_hash||e.after_amount===null||e.has_human_review||e.has_active_provision))throw Error('Invalid manifest');
 // Each atomic operation checks the original hash/value and journals its before/after.
 for(const e of revert?[...entries].reverse():entries){
  if(revert){
   const operation=await db.from('conveni_amount_operations').select('source_record_id,source_hash').eq('id',e.operation_id).maybeSingle();if(operation.error)throw Error(operation.error.message);
   if(!operation.data){console.log(`Not applied; nothing to revert: ${e.source_record_id}`);continue;}
   if(operation.data.source_record_id!==e.id||operation.data.source_hash!==e.source_hash)throw Error('Reversal operation does not match the manifest');
  }
  const result=revert?await db.rpc('revert_conveni_amount',{p_operation:e.operation_id}):await db.rpc('migrate_conveni_amount',{p_record:e.id,p_operation:e.operation_id,p_hash:e.source_hash,p_before:e.before_amount});
  if(result.error)throw Error(`${e.source_record_id}: ${result.error.message}. Completed operations remain journaled; rerun the same manifest to resume.`);
  console.log(`${revert?'Reverted':'Applied'} ${e.source_record_id} · ${e.operation_id}`);
 }
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
