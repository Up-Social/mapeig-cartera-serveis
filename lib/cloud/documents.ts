import {EXTRACTION_VERSION,recoverPdfText,preserveUnselectedPdfPages} from '../pipeline/readable-document';
import {createEphemeralSandbox,SandboxLifecycleError,type EphemeralSandbox,type DocumentSession} from './sandbox';
import {containSandboxIncident} from './sandbox-incident';
import {checkpoint,readCheckpoint,rpc,acquireResource,progress,type Context} from './context';
import {CloudFailure,CloudYield} from './errors';
import {htmlToText,cleanText} from '../pipeline/document-input';
import {hash} from '../pipeline/chunks';
import {fetchOfficialDocument} from '../pipeline/official-resolution';
import {archiveSource,readSource,sha256,ArchivedSourceUnavailableError} from '../source-storage';
type Extraction={text:string;method:string;hash:string;mime:string;partial:boolean;extraction_version:string;coverage?:unknown};
const OCR_RENDER_DPI=300;
export async function extractDocument(c:Context,job:string,id:string,url:string,ocr:boolean, forcedPages:number[]=[]):Promise<Extraction>{
 const dpi=forcedPages.length?400:OCR_RENDER_DPI;
 const extractionKey=`document:${id}:${EXTRACTION_VERSION}${forcedPages.length?`:targeted:${job}:${forcedPages.join('-')}`:''}`;
 const source=await c.db.from('source_documents').select('id,source_record_id,url,content_hash,storage_path,storage_sha256,mime_type,extracted_text').eq('id',id).single();
 if(source.error||!source.data)throw new CloudFailure('internal');
 const cached=await readCheckpoint<Extraction>(c,extractionKey);
 // A failed attempt can copy an incomplete extraction into a recovery task.
 // It must be recomputed with the new OCR setting instead of failing again.
 if(cached&&!cached.partial){await archiveSource(c.db,source.data);return cached;}
 let fetched:{bytes:Buffer;mimeType:string};
 const original=await readCheckpoint<{path:string;mime:string;hash:string}>(c,`original:${id}`);
 if(original&&original.path===source.data.storage_path&&original.hash===source.data.storage_sha256){
  const stored=await readSource(c.db,source.data);
  fetched={bytes:stored.bytes,mimeType:stored.mimeType};
 }else if(original){
  const r=await c.db.storage.from('cloud-documents').download(original.path);if(r.error||!r.data)throw new CloudFailure('internal');
  fetched={bytes:Buffer.from(await r.data.arrayBuffer()),mimeType:original.mime};
  const originalDigest=sha256(fetched.bytes);
  // Before canonical case storage, checkpoints hashed the base64 text instead of the bytes.
  if(originalDigest!==original.hash&&hash(fetched.bytes.toString('base64'))!==original.hash)throw new ArchivedSourceUnavailableError('La còpia del checkpoint no supera la verificació d’integritat');
  const stored=await readSource(c.db,source.data,fetched);
  if(stored.sha256!==originalDigest)throw new ArchivedSourceUnavailableError('La còpia arxivada no correspon al checkpoint original');
  fetched={bytes:stored.bytes,mimeType:stored.mimeType};
 }else{
  let archived:{path:string;sha256:string};
  if(source.data.storage_path&&source.data.storage_sha256){
   const stored=await readSource(c.db,source.data);
   fetched={bytes:stored.bytes,mimeType:stored.mimeType};
   archived=stored;
  }else{
   try {fetched=await fetchOfficialDocument(url);}catch {throw new CloudFailure('document');}
   archived=await archiveSource(c.db,source.data,fetched);
  }
  await checkpoint(c,`original:${id}`,{path:archived.path,mime:fetched.mimeType,hash:archived.sha256});
 }
 const digest=hash(fetched.bytes.toString('base64'));
 const pdf=fetched.mimeType.includes('pdf')||fetched.bytes.subarray(0,4).toString()==='%PDF';
 if(!pdf){
  if(!fetched.mimeType.includes('html')&&fetched.mimeType!=='text/plain')throw new CloudFailure('document');
  const result={text:cleanText(htmlToText(fetched.bytes.toString('utf8'))),method:'html-basic',hash:digest,mime:fetched.mimeType,partial:false,extraction_version:EXTRACTION_VERSION};
  if(result.text.length<50)throw new CloudFailure('document');await checkpoint(c,extractionKey,result);return result;
 }
 if(!process.env.CLOUD_SANDBOX_SNAPSHOT)throw new CloudFailure('credentials');
 await acquireResource(c,'sandbox');
 let handle:EphemeralSandbox|undefined;let blocked:string|null=null;let creationUncertain=false;
 try {
  creationUncertain=true;
  handle=await createEphemeralSandbox('document',process.env.CLOUD_SANDBOX_SNAPSHOT);
  creationUncertain=false;
  const sb=handle.session;
  await sb.writeFiles([{path:'/tmp/source.pdf',content:fetched.bytes}]);
  const command=await quietCommand(sb,'pdftotext',['-layout','/tmp/source.pdf','/tmp/source.txt'],{timeoutMs:20_000});
  if(command.exitCode!==0&&!ocr)throw new CloudFailure('document');
  const rawText=(await sb.readFileToBuffer({path:'/tmp/source.txt'}))?.toString('utf8')??'';
  await quietCommand(sb,'sh',['-c','pdfinfo /tmp/source.pdf > /tmp/info.txt 2>/dev/null'],{timeoutMs:20_000});
  const info=(await sb.readFileToBuffer({path:'/tmp/info.txt'}))?.toString('utf8')??'';
  const pageCount=Number(info.match(/Pages:\s+(\d+)/)?.[1]);
  if(!pageCount)throw new CloudFailure('document');
  const inputText=preserveUnselectedPdfPages(rawText,source.data.extracted_text,forcedPages,pageCount);
  const recovered=await recoverPdfText(inputText,ocr,async page=>{
    await progress(c,'ocr',page-1,pageCount,`OCR de la pàgina ${page} de ${pageCount}`,job);
    const key=`ocr:${digest}:${page}:dpi${dpi}:${EXTRACTION_VERSION}`;
    const cached=await readCheckpoint<{text:string}>(c,key);
    if(cached)return cached.text;
    const render=await quietCommand(sb,'pdftoppm',['-png','-r',String(dpi),'-f',String(page),'-l',String(page),'-singlefile','/tmp/source.pdf','/tmp/page'],{timeoutMs:60_000});
    if(render.exitCode!==0)throw new CloudFailure('document');
    const recognize=await quietCommand(sb,'tesseract',['/tmp/page.png','/tmp/page','-l','cat+spa'],{timeoutMs:120_000});
    if(recognize.exitCode!==0)throw new CloudFailure('document');
    const text=(await sb.readFileToBuffer({path:'/tmp/page.txt'}))?.toString('utf8')??'';
    await checkpoint(c,key,{text});
    throw new CloudYield();
  },pageCount,forcedPages);
  const result={...recovered,coverage:recovered.method==='pdf-ocr-markdown-v2'?{...recovered.coverage,ocrEngine:'tesseract',ocrLanguages:['cat','spa'],ocrDpi:dpi,...(forcedPages.length?{requestedPages:forcedPages}:{})}:recovered.coverage,hash:digest,mime:'application/pdf'};
  await checkpoint(c,extractionKey,result);return result;
 }catch(error){
  if(error instanceof CloudFailure||error instanceof CloudYield)throw error;
  const status=(error as {response?:Response}).response?.status;
  const code=(error as {json?:{error?:{code?:string}}}).json?.error?.code;
  // The SDK may already have created a VM before retrying and returning this error.
  if(code&&/quota|usage_limit|limit_exceeded/.test(code)){blocked='vercel_quota';throw new CloudFailure('vercel_quota');}
  if(status===429){throw new CloudFailure('transient',30);}
  if(status===402){blocked='vercel_quota';throw new CloudFailure('vercel_quota');}
  if(status===401||status===403){throw new CloudFailure('credentials');}
  // A VM/network/SDK failure does not establish that the original PDF is invalid.
  throw new CloudFailure('internal',5,{operation:'sandbox',code:status===410?'SANDBOX_SESSION_STOPPED':'SANDBOX_OPERATION_FAILED'});
 }finally{
  try {
   if(creationUncertain)throw new SandboxLifecycleError('SANDBOX_CREATION_UNCONFIRMED','unknown');
   await handle?.close();
  }catch(error){
   const diagnostic=error instanceof SandboxLifecycleError?{code:error.code,sessionId:error.sessionId,snapshotId:error.snapshotId}:{code:'SANDBOX_STOP_UNCONFIRMED'};
   console.error('SANDBOX_LIFECYCLE_INCIDENT',{taskId:c.task,...diagnostic});
   // Keep the lease until its 12-minute deadline. Never advertise an uncertain VM as free.
   try {await containSandboxIncident(c.db,c.owner,diagnostic.code);}
   catch {throw new CloudFailure('internal',5,{operation:'sandbox_cleanup',code:'SANDBOX_CONTAINMENT_FAILED',details:diagnostic});}
   throw new CloudFailure('internal',5,{operation:'sandbox_cleanup',code:diagnostic.code,details:diagnostic});
  }
  await rpc(c.db,'cloud_resource',{p_name:'sandbox',p_owner:c.owner,p_release:true,p_block:blocked});
 }
}

async function quietCommand(sb:DocumentSession,command:string,args:string[]=[],options?:{timeoutMs:number}){
 const result=await sb.runCommand('sh',['-c','exec "$@" >/tmp/operation.stdout 2>/tmp/operation.stderr','cloud',command,...args],options);
 // Missing executables, killed processes and timeouts are infrastructure incidents.
 if(result.exitCode===124||result.exitCode>=126)throw new CloudFailure('internal',5,{operation:'sandbox_command',code:'SANDBOX_COMMAND_INTERRUPTED',details:{command,exitCode:result.exitCode}});
 return result;
}
