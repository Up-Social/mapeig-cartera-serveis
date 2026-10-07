/**
 * Reconcile the verified local historical archive with the production project.
 * Audit is read-only. Apply requires an explicit flag and the exact project ref.
 * Re-running apply checks existing bytes and only fills missing DB pointers.
 *
 *   npx tsx --env-file=.env.local scripts/release-historical-storage.ts --audit
 *   npx tsx --env-file=.env.local scripts/release-historical-storage.ts --apply --project-ref=vvzxlevbfjvzygorbpxn
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';

const PROJECT_REF='vvzxlevbfjvzygorbpxn';
const BUCKET='cloud-documents';
const PAGE_SIZE=1000;
const CONCURRENCY=8;
const args=process.argv.slice(2);
const apply=args.includes('--apply');
const audit=args.includes('--audit');
const excludeArgs=args.filter(arg=>arg.startsWith('--exclude-local-document='));
const excludedLocalDocumentId=excludeArgs[0]?.slice('--exclude-local-document='.length);
const skipArgs=args.filter(arg=>arg.startsWith('--skip-diverged-document='));
const skippedDivergedDocumentId=skipArgs[0]?.slice('--skip-diverged-document='.length);
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
if(excludeArgs.length>1 || skipArgs.length>1 || (excludedLocalDocumentId&&!uuidPattern.test(excludedLocalDocumentId)) || (skippedDivergedDocumentId&&!uuidPattern.test(skippedDivergedDocumentId)) || (excludedLocalDocumentId&&excludedLocalDocumentId===skippedDivergedDocumentId))
 throw Error('Identificador de document local exclòs invàlid');
if(apply===audit || args.some(arg=>!['--apply','--audit',`--project-ref=${PROJECT_REF}`].includes(arg)&&!arg.startsWith('--exclude-local-document=')&&!arg.startsWith('--skip-diverged-document=')))
 throw Error('Indica --audit o --apply --project-ref='+PROJECT_REF);
if(apply&&!args.includes(`--project-ref=${PROJECT_REF}`))throw Error('Cal confirmar el ref de producció');

type Row={id:string;source_payload_hash?:string|null;source_record_id?:string;content_hash?:string|null;status?:string;url?:string;storage_path?:string|null;storage_sha256?:string|null};
type Entry={kind:'record'|'document'|'master'|'shared';id?:string;recordId?:string;sourceHash?:string|null;path:string;sha256:string;alreadyLinked?:boolean};
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const client=(url:string,key:string)=>createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});

function localClient():SupabaseClient {
 const raw=execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']});
 const status=JSON.parse(raw) as {API_URL?:string;SERVICE_ROLE_KEY?:string};
 if(!status.API_URL||!status.SERVICE_ROLE_KEY||!/^https?:\/\/(127\.0\.0\.1|localhost):\d+$/.test(status.API_URL))
  throw Error('El Supabase local no està disponible al loopback');
 return client(status.API_URL,status.SERVICE_ROLE_KEY);
}

function productionClient():SupabaseClient {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
 const parsed=url?new URL(url):null;
 if(parsed?.origin!==`https://${PROJECT_REF}.supabase.co`||parsed.pathname!=='/'||parsed.search||parsed.hash||!key)
  throw Error('Projecte remot o clau de servei incorrectes');
 return client(parsed.origin,key);
}

async function rows(db:SupabaseClient,table:string,columns:string):Promise<Row[]> {
 const out:Row[]=[];
 for(let start=0;;start+=PAGE_SIZE){
  const result=await db.from(table).select(columns).order('id').range(start,start+PAGE_SIZE-1);
  if(result.error)throw Error(`${table}: ${result.error.message}`);
  const page=(result.data??[]) as unknown as Row[];
  out.push(...page);
  if(page.length<PAGE_SIZE)break;
 }
 return out;
}

function sameIdentity(table:string,local:Row[],remote:Row[],fields:(keyof Row)[]){
 if(local.length!==remote.length)throw Error(`${table}: nombre de files diferent (${local.length}/${remote.length}); cal renovar la captura`);
 const differences:string[]=[];
 for(let i=0;i<local.length;i++){
  const different=fields.filter(field=>local[i][field]!==remote[i][field]);
  if(different.length)
   differences.push(`${local[i].id}/${remote[i].id}:${different.join(',')}`);
 }
 if(differences.length)throw Error(`${table}: ${differences.length} files amb identitat o contingut diferent (${differences.slice(0,20).join('; ')}); cal renovar la captura`);
}

function entry(kind:Entry['kind'],row:Row):Entry|undefined {
 if(!row.storage_path&&!row.storage_sha256)return;
 if(!row.storage_path||!row.storage_sha256)throw Error(`${kind}: punter incomplet`);
 const path=row.storage_path,hash=row.storage_sha256;
 if(!/^[0-9a-f]{64}$/.test(hash)||!path.endsWith(`/${hash}.${path.split('.').at(-1)}`))throw Error(`${kind}: hash o ruta invàlids`);
 const prefix=kind==='record'?`cases/${row.id}/imports/`:kind==='document'?`cases/${row.source_record_id}/documents/${row.id}/`:`references/master/items/${row.id}/source/`;
 if(!path.startsWith(prefix)||path.includes('..'))throw Error(`${kind}: carpeta incorrecta`);
 return {kind,id:row.id,recordId:row.source_record_id,sourceHash:kind==='document'?row.content_hash:row.source_payload_hash,path,sha256:hash};
}

async function sharedEntries(db:SupabaseClient):Promise<Entry[]> {
 const list=await db.storage.from(BUCKET).list('imports/legacy',{limit:100});
 if(list.error)throw list.error;
 return list.data.filter(item=>item.name).map(item=>{
  const match=/^([0-9a-f]{64})\.(xlsx|json)$/.exec(item.name);
  if(!match)throw Error('Nom de llibre o informe compartit invàlid');
  return {kind:'shared' as const,path:`imports/legacy/${item.name}`,sha256:match[1]};
 });
}

async function inventory(local:SupabaseClient,remote:SupabaseClient):Promise<Entry[]> {
 const tables:[string,string,(keyof Row)[],Entry['kind']][]=[
  ['source_records','id,source_payload_hash,storage_path,storage_sha256',['id','source_payload_hash'],'record'],
  ['source_documents','id,source_record_id,status,content_hash,url,storage_path,storage_sha256',['id','source_record_id','status','content_hash','url'],'document'],
  ['master_services','id,source_payload_hash,storage_path,storage_sha256',['id','source_payload_hash'],'master'],
 ];
 const entries:Entry[]=[];
 for(const [table,localColumns,identity,kind] of tables){
  const remoteColumns=apply?localColumns:localColumns.split(',').filter(column=>!column.startsWith('storage_')).join(',');
  const [allLocalRows,allRemoteRows]=await Promise.all([rows(local,table,localColumns),rows(remote,table,remoteColumns)]);
  let localRows=allLocalRows;
  let remoteRows=allRemoteRows;
  if(table==='source_documents'&&excludedLocalDocumentId){
   const excluded=allLocalRows.filter(row=>row.id===excludedLocalDocumentId);
   if(excluded.length!==1||allRemoteRows.some(row=>row.id===excludedLocalDocumentId))
    throw Error('El document exclòs no és una única fila exclusiva de la base local');
   localRows=allLocalRows.filter(row=>row.id!==excludedLocalDocumentId);
   console.log(`Document exclusiu local exclòs del trasllat: ${excludedLocalDocumentId}`);
  }
  if(table==='source_documents'&&skippedDivergedDocumentId){
   const localRow=localRows.find(row=>row.id===skippedDivergedDocumentId);
   const remoteRow=allRemoteRows.find(row=>row.id===skippedDivergedDocumentId);
   if(!localRow||!remoteRow||localRow.source_record_id!==remoteRow.source_record_id||localRow.url!==remoteRow.url||
      (localRow.status===remoteRow.status&&localRow.content_hash===remoteRow.content_hash))
    throw Error('El document divergent no coincideix amb la diferència local esperada');
   localRows=localRows.filter(row=>row.id!==skippedDivergedDocumentId);
   remoteRows=allRemoteRows.filter(row=>row.id!==skippedDivergedDocumentId);
   console.log(`Document divergent exclòs sense canviar el seu estat remot: ${skippedDivergedDocumentId}`);
  }
  sameIdentity(table,localRows,remoteRows,identity);
  const selected=localRows.map((row,index)=>{
   const item=entry(kind,row);
   if(item&&apply){
    const previous=remoteRows[index];
    if(previous.storage_path||previous.storage_sha256){
     if(previous.storage_path!==item.path||previous.storage_sha256!==item.sha256)
      throw Error(`${table}: punter remot divergent per ${item.id}`);
     item.alreadyLinked=true;
    }
   }
   return item;
  }).filter((value):value is Entry=>Boolean(value));
  entries.push(...selected);
  console.log(`${table}: ${localRows.length} files idèntiques, ${selected.length} arxius locals vinculats`);
 }
 entries.push(...await sharedEntries(local));
 const unique=new Set(entries.map(item=>item.path));
 if(unique.size!==entries.length)throw Error('Rutes d’arxiu duplicades');
 console.log(`Arxius històrics previstos: ${entries.length} (${entries.filter(item=>item.kind==='shared').length} compartits)`);
 return entries;
}

async function downloadAndVerify(db:SupabaseClient,item:Entry):Promise<Buffer>{
 const result=await db.storage.from(BUCKET).download(item.path);
 if(result.error||!result.data)throw Error(`No es pot llegir ${item.path}: ${result.error?.message??'sense dades'}`);
 const bytes=Buffer.from(await result.data.arrayBuffer());
 if(digest(bytes)!==item.sha256)throw Error(`SHA-256 incorrecte: ${item.path}`);
 return bytes;
}

async function link(remote:SupabaseClient,item:Entry){
 if(item.kind==='shared'||item.alreadyLinked)return;
 const table=item.kind==='record'?'source_records':item.kind==='document'?'source_documents':'master_services';
 let query=remote.from(table).update({storage_path:item.path,storage_sha256:item.sha256}).eq('id',item.id!).is('storage_path',null);
 if(item.kind==='document'){
  query=query.eq('source_record_id',item.recordId!);
  query=item.sourceHash?query.eq('content_hash',item.sourceHash):query.is('content_hash',null);
 }else query=query.eq('source_payload_hash',item.sourceHash!);
 const updated=await query.select('id');
 if(updated.error||updated.data?.length!==1){
  // A lost response may hide a successful update; accept only the exact pointer.
  const current=await remote.from(table).select('storage_path,storage_sha256').eq('id',item.id!).maybeSingle();
  if(!current.error&&current.data?.storage_path===item.path&&current.data.storage_sha256===item.sha256)return;
  throw Error(`No s’ha pogut enllaçar ${table}/${item.id}: ${updated.error?.message??current.error?.message??'fila no actualitzada'}`);
 }
}

const retryable=(error:unknown)=>/fetch failed|network|timeout|ECONNRESET|HTTP 5\d\d|HTTP 429|rate limit/i.test(error instanceof Error?error.message:String(error));
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

async function inBatches(items:Entry[],work:(item:Entry)=>Promise<void>){
 for(let start=0;start<items.length;start+=CONCURRENCY){
  const outcomes=await Promise.allSettled(items.slice(start,start+CONCURRENCY).map(work));
  const failures=outcomes.filter((value):value is PromiseRejectedResult=>value.status==='rejected');
  if(failures.length)throw failures[0].reason;
  if((start+CONCURRENCY)%1000<CONCURRENCY||start+CONCURRENCY>=items.length)
   console.log(`Verificats: ${Math.min(start+CONCURRENCY,items.length)}/${items.length}`);
 }
}

async function main(){
 const local=localClient(),remote=productionClient();
 const items=await inventory(local,remote);
 if(audit){
  await inBatches(items,async item=>{await downloadAndVerify(local,item);});
  console.log('Auditoria de bytes locals completa. Producció no modificada.');
  return;
 }
 let uploaded=0,alreadyPresent=0,linked=0;
 await inBatches(items,async item=>{
  for(let attempt=1;attempt<=5;attempt++)try{
   const bytes=await downloadAndVerify(local,item);
   const exists=await remote.storage.from(BUCKET).exists(item.path);
   // storage-js reports a missing HEAD as data:false plus a 400/404 error.
   // Only that documented absence is safe to proceed to upload.
   if(exists.error && !(exists.data===false && [400,404].includes(Number(exists.error.status))))
    throw exists.error;
   if(!exists.data){
    const contentType=item.path.endsWith('.pdf')?'application/pdf':item.path.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':item.path.endsWith('.html')?'text/html':item.path.endsWith('.xml')?'application/xml':item.path.endsWith('.txt')?'text/plain':item.path.endsWith('.json')?'application/json':'application/octet-stream';
    const result=await remote.storage.from(BUCKET).upload(item.path,bytes,{contentType,upsert:false});
    if(result.error)throw Error(`No s’ha pogut pujar ${item.path}: ${result.error.message}`);
    uploaded++;
   }else alreadyPresent++;
   await downloadAndVerify(remote,item);
   await link(remote,item);
   if(item.kind!=='shared'&&!item.alreadyLinked)linked++;
   return;
  }catch(error){
   if(attempt===5||!retryable(error))throw error;
   console.warn(`Error de xarxa transitori; reintent ${attempt}/4 per ${item.kind}/${item.id??'shared'}`);
   await pause(500*2**(attempt-1));
  }
 });
 const finalInventory=await inventory(local,remote);
 if(finalInventory.length!==items.length||finalInventory.some(item=>item.kind!=='shared'&&!item.alreadyLinked))
  throw Error('Postverificació: manca algun punter remot o hi ha hagut deriva de dades');
 console.log(JSON.stringify({uploaded,alreadyPresent,linked,total:items.length}));
}

main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
