/** Rebuild printed names for the three verified local annexes; never approves rows. */
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {extractConcertAnnexRows,extractProgram317Rows} from '../lib/concerts/annex-extraction';
import {sha256} from '../lib/source-storage';

const status=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',env:{...process.env,SUPABASE_TELEMETRY_DISABLED:'1'}}));
if(status.API_URL!=='http://127.0.0.1:54321')throw Error('Només es permet el Supabase local 54321');
const db=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

async function main(){
 for(const edicte of ['605700','605699','511349']){
  const record=await db.from('source_records').select('id').eq('source_record_id',`etauler:1:${edicte}`).single();
  if(record.error)throw record.error;
  const document=await db.from('source_documents').select('id,storage_path,storage_sha256').eq('source_record_id',record.data.id).eq('mime_type','application/pdf').not('storage_path','is',null).limit(1).single();
  if(document.error||!document.data.storage_path)throw document.error??Error(`PDF ${edicte} no arxivat`);
  const downloaded=await db.storage.from('cloud-documents').download(document.data.storage_path);
  if(downloaded.error||!downloaded.data)throw downloaded.error??Error(`PDF ${edicte} absent`);
  const bytes=Buffer.from(await downloaded.data.arrayBuffer());
  if(sha256(bytes)!==document.data.storage_sha256)throw Error(`PDF ${edicte}: SHA-256 incorrecte`);
  const folder=mkdtempSync(join(tmpdir(),'mapeig-observed-'));
  let text='';
  try{const path=join(folder,'resolution.pdf');writeFileSync(path,bytes);text=execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8',maxBuffer:3_000_000});}
  finally{rmSync(folder,{recursive:true,force:true});}
  const rows=edicte==='511349'?extractProgram317Rows(text):extractConcertAnnexRows(text);
  const prefix=`official:${edicte}:${document.data.storage_sha256}:`;
  const existing=await db.from('record_units').select('id,unit_key,status').eq('source_record_id',record.data.id).like('unit_key',`${prefix}%`);
  if(existing.error)throw existing.error;
  const byKey=new Map((existing.data??[]).map(row=>[row.unit_key,row]));
  if(byKey.size!==rows.length)throw Error(`Edicte ${edicte}: ${byKey.size} unitats, ${rows.length} files; no s'actualitza parcialment`);
  for(const row of rows){
   const unit=byKey.get(`${prefix}${row.row}`);
   if(!unit||unit.status!=='draft')continue;
   const update=await db.from('record_units').update({observed_provider_name:row.observedProviderName,
    observed_service_name:'observedServiceName' in row?row.observedServiceName:null})
    .eq('id',unit.id).eq('status','draft');
   if(update.error)throw update.error;
  }
  console.log(`${edicte}: ${rows.length} noms impresos revisats, sense aprovar unitats.`);
 }
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
