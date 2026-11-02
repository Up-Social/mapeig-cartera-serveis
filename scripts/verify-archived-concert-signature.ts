/** Read-only operator action: no jobs, external calls beyond the selected
 * Supabase archive, writes to production, Sandbox, Docker, or checkpoints.
 * Run explicitly with the environment loaded and --project/--record/
 * --document/--sha. This only prints an observation for later review. */
import {createClient} from '@supabase/supabase-js';
import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {verifyArchivedConcertSignature} from '../lib/concerts/archived-signature-verification';
import {isUuid} from '../lib/uuid';

const execFileAsync=promisify(execFile);
async function run(){
 const args=process.argv.slice(2);
 if(args.length!==8||args[0]!=='--project'||args[2]!=='--record'||args[4]!=='--document'||args[6]!=='--sha')throw Error('EXPECTED_PROJECT_RECORD_DOCUMENT_SHA');
 const [,project,,recordId,,documentId,,expectedSha]=args;
 if(!/^[a-z0-9]{20}$/.test(project)||!isUuid(recordId)||!isUuid(documentId)||!/^[a-f0-9]{64}$/.test(expectedSha))throw Error('INVALID_ARGUMENT');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key||new URL(url).protocol!=='https:'||new URL(url).hostname!==`${project}.supabase.co`)throw Error('PROJECT_NOT_CONFIRMED');
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const [record,document]=await Promise.all([
  db.from('source_records').select('id,financing_type').eq('id',recordId).maybeSingle(),
  db.from('source_documents').select('id,source_record_id,storage_path,storage_sha256,status,mime_type').eq('id',documentId).eq('source_record_id',recordId).maybeSingle(),
 ]);
 if(record.error||document.error||record.data?.financing_type!=='concert'||!document.data)throw Error('CONCERT_DOCUMENT_NOT_AVAILABLE');
 const result=await verifyArchivedConcertSignature(document.data,recordId,expectedSha,async path=>{
  const object=await db.storage.from('cloud-documents').download(path);
  if(object.error||!object.data)throw Error('ARCHIVE_NOT_AVAILABLE');
  return new Uint8Array(await object.data.arrayBuffer());
 },async bytes=>{
  const dir=await mkdtemp(join(tmpdir(),'mapeig-signature-'));
  try {
   const file=join(dir,'source.pdf');await writeFile(file,bytes,{mode:0o600,flag:'wx'});
   const result=await execFileAsync('pdfsig',['-no-ocsp',file],{timeout:20_000,maxBuffer:256_000,env:{NODE_ENV:'production',PATH:process.env.PATH??'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TZ:'UTC'}});
   return result.stdout;
  } finally {await rm(dir,{recursive:true,force:true});}
 });
 console.log(JSON.stringify({...result,limitation:'Declared signing time, not a trusted timestamp or award date. No production data changed.'},null,2));
}
run().catch(error=>{console.error(`Signature verification failed: ${error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'VERIFICATION_UNAVAILABLE'}`);process.exitCode=1;});
