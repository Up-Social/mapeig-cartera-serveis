import {refreshConcertSource} from './refresh-source';
import {EXTRACTION_VERSION,recoverPdfText,preserveUnselectedPdfPages} from '../pipeline/readable-document';
import {createEphemeralSandbox,SandboxLifecycleError,type EphemeralSandbox,type DocumentSession} from './sandbox';
import {containSandboxIncident} from './sandbox-incident';
import {checkpoint,readCheckpoint,readBoundedPdfCheckpoint,rpc,lease,acquireResource,progress,type Context} from './context';
import {CloudFailure,CloudYield} from './errors';
import {htmlToText,cleanTextWithCoverage,hasCurrentTextCoverage} from '../pipeline/document-input';
import {hash} from '../pipeline/chunks';
import {fetchOfficialDocument} from '../pipeline/official-resolution';
import {archiveSource,readSource,sha256,ArchivedSourceUnavailableError} from '../source-storage';
import {parsePdfSignatureDate} from '../concerts/pdf-signature-date';
type Extraction={text:string;method:string;hash:string;mime:string;partial:boolean;extraction_version:string;coverage?:unknown;source_sha256?:string;source_url?:string;source_path?:string;previous_text_sha256?:string;target_previous_extraction_id?:string;target_pages?:number[]};
const OCR_RENDER_DPI=300;
// Maximum transient checkpoint payload, measured in UTF-8 bytes before transfer.
const PDF_PREFLIGHT_VERSION='pdf-preflight-v1';
const MAX_PREFLIGHT_BYTES=8_000_000;
const MAX_OCR_BYTES=8_000_000;
const MAX_PDF_PAGES=2000;
type PdfPreflight={version:string;documentId:string;sourceSha256:string;sourcePath:string;sourceUrl:string;snapshotHash:string;rawText:string;rawHash:string;pageCount:number;exitCode:number};
type OcrCheckpoint={version:string;documentId:string;sourceSha256:string;sourcePath:string;sourceUrl:string;page:number;dpi:number;text:string;textHash:string};
export async function extractDocument(c:Context,job:string,id:string,url:string,ocr:boolean, forcedPages:number[]=[],refreshSource=false):Promise<Extraction>{
 const dpi=forcedPages.length?400:OCR_RENDER_DPI;
 const extractionKey=`document:${id}:${EXTRACTION_VERSION}${forcedPages.length?`:targeted:${job}:${forcedPages.join('-')}`:''}`;
 const source=await c.db.from('source_documents').select('id,source_record_id,url,content_hash,storage_path,storage_sha256,mime_type,extracted_text,active_extraction_id').eq('id',id).single();
 if(source.error||!source.data)throw new CloudFailure('internal');
 if(url!==source.data.url)throw new CloudFailure('validation',5,{operation:'document_source',code:'DOCUMENT_SOURCE_CHANGED',message:'La URL del document ha canviat abans de la lectura.'});
 if(refreshSource){
  const verified=await refreshConcertSource(c,source.data);
  source.data.storage_path=verified.path;source.data.storage_sha256=verified.sha256;
 }
 const cached=await readCheckpoint<Extraction>(c,extractionKey);
 // A failed attempt can copy an incomplete extraction into a recovery task.
 // It must be recomputed with the new OCR setting instead of failing again.
 // Historic HTML checkpoints did not report truncation; reread the archived bytes
 // without disturbing PDF/OCR checkpoints or triggering provider calls.
 if(cached&&!cached.partial&&hasCurrentTextCoverage(cached.method,cached.coverage,cached.mime)){
  if(forcedPages.length&&(cached.previous_text_sha256!==sha256(Buffer.from(source.data.extracted_text??'', 'utf8'))||!cached.target_previous_extraction_id||cached.target_previous_extraction_id!==source.data.active_extraction_id))
   throw new CloudFailure('validation',5,{operation:'pdf_target',code:'DOCUMENT_CHECKPOINT_SOURCE_CHANGED'});
  // A checkpoint is identified by document ID, not by its current revision.
  // Bind the text to verified bytes before reusing it; historical extractions
  // used either a byte SHA-256 or the hash of the base64 representation.
  const stored=await readSource(c.db,source.data);
  const encodedHash=hash(stored.bytes.toString('base64'));
  if(!cached.hash||(cached.hash!==stored.sha256&&cached.hash!==encodedHash)
   ||(cached.source_sha256!==undefined&&cached.source_sha256!==stored.sha256)
   ||(cached.source_path!==undefined&&cached.source_path!==stored.path)
   ||(cached.source_url!==undefined&&cached.source_url!==source.data.url))
   throw new CloudFailure('validation',5,{operation:'document_checkpoint',code:'DOCUMENT_CHECKPOINT_SOURCE_CHANGED',message:'La lectura guardada no correspon a la còpia documental vigent. Cal una nova anàlisi; no s’ha reutilitzat l’extracció.'});
  return {...cached,source_sha256:stored.sha256,source_url:source.data.url,source_path:stored.path};
 }
 let fetched:{bytes:Buffer;mimeType:string};let sourcePath:string;
 const original=await readCheckpoint<{path:string;mime:string;hash:string}>(c,`original:${id}`);
 if(original&&original.path===source.data.storage_path&&original.hash===source.data.storage_sha256){
  const stored=await readSource(c.db,source.data);
  fetched={bytes:stored.bytes,mimeType:stored.mimeType};sourcePath=stored.path;
 }else if(original){
  const r=await c.db.storage.from('cloud-documents').download(original.path);if(r.error||!r.data)throw new CloudFailure('internal');
  fetched={bytes:Buffer.from(await r.data.arrayBuffer()),mimeType:original.mime};
  const originalDigest=sha256(fetched.bytes);
  // Before canonical case storage, checkpoints hashed the base64 text instead of the bytes.
  if(originalDigest!==original.hash&&hash(fetched.bytes.toString('base64'))!==original.hash)throw new ArchivedSourceUnavailableError('La còpia del checkpoint no supera la verificació d’integritat');
  const stored=await readSource(c.db,source.data,fetched);
  if(stored.sha256!==originalDigest)throw new ArchivedSourceUnavailableError('La còpia arxivada no correspon al checkpoint original');
  fetched={bytes:stored.bytes,mimeType:stored.mimeType};sourcePath=stored.path;
 }else{
  let archived:{path:string;sha256:string};
  if(source.data.storage_path&&source.data.storage_sha256){
   const stored=await readSource(c.db,source.data);
   fetched={bytes:stored.bytes,mimeType:stored.mimeType};sourcePath=stored.path;
   archived=stored;
  }else{
   try {fetched=await fetchOfficialDocument(url);}catch {throw new CloudFailure('document');}
   archived=await archiveSource(c.db,source.data,fetched);
  }
  sourcePath=archived.path;
  await checkpoint(c,`original:${id}`,{path:archived.path,mime:fetched.mimeType,hash:archived.sha256});
 }
 const digest=hash(fetched.bytes.toString('base64'));
 const pdf=fetched.mimeType.includes('pdf')||fetched.bytes.subarray(0,4).toString()==='%PDF';
 if(!pdf){
  if(!fetched.mimeType.includes('html')&&fetched.mimeType!=='text/plain')throw new CloudFailure('document');
  const result={...cleanTextWithCoverage(htmlToText(fetched.bytes.toString('utf8'))),method:'html-basic',hash:digest,mime:fetched.mimeType,extraction_version:EXTRACTION_VERSION,source_sha256:sha256(fetched.bytes),source_url:source.data.url,source_path:sourcePath};
  if(result.text.length<50)throw new CloudFailure('document');await checkpoint(c,extractionKey,result);return result;
 }
 const sourceSha256=sha256(fetched.bytes);
 const snapshotId=process.env.CLOUD_SANDBOX_SNAPSHOT;
 if(!snapshotId)throw new CloudFailure('credentials');
 const snapshotHash=sha256(Buffer.from(snapshotId,'utf8'));
 const identity={documentId:id,sourceSha256,sourcePath,sourceUrl:source.data.url};
 const inputKey=`pdf-input:${id}:${EXTRACTION_VERSION}`;
 const preflightKey=`pdf-preflight:${id}:${sourceSha256}:${EXTRACTION_VERSION}:${PDF_PREFLIGHT_VERSION}`;
 const preflightRead=await readBoundedPdfCheckpoint<PdfPreflight>(c,job,id,'preflight',preflightKey,MAX_PREFLIGHT_BYTES);
 const existingPreflight=preflightRead.found?preflightRead.value:null;
 if(existingPreflight&&existingPreflight.snapshotHash!==snapshotHash)
  throw new CloudFailure('validation',5,{operation:'pdf_preflight',code:'DOCUMENT_CHECKPOINT_SOURCE_CHANGED'});
 const input=await readCheckpoint<{sourceSha256:string;sourcePath:string;sourceUrl:string;snapshotHash:string}>(c,inputKey);
 if(input&&(input.sourceSha256!==sourceSha256||input.sourcePath!==sourcePath||input.sourceUrl!==source.data.url||input.snapshotHash!==snapshotHash))
  throw new CloudFailure('validation',5,{operation:'pdf_input',code:'DOCUMENT_CHECKPOINT_SOURCE_CHANGED'});
 if(!input)await checkpoint(c,inputKey,{sourceSha256,sourcePath,sourceUrl:source.data.url,snapshotHash});
 const targetKey=`pdf-target:${id}:${job}:${sourceSha256}:${EXTRACTION_VERSION}:${forcedPages.join('-')}`;
 if(forcedPages.length){
  const previousHash=sha256(Buffer.from(source.data.extracted_text??'', 'utf8'));
  const target=await readCheckpoint<{previousHash:string;sourcePath:string;sourceUrl:string;extractionId:string}>(c,targetKey);
  if(!source.data.active_extraction_id||target&&(target.previousHash!==previousHash||target.sourcePath!==sourcePath||target.sourceUrl!==source.data.url||target.extractionId!==source.data.active_extraction_id))
   throw new CloudFailure('validation',5,{operation:'pdf_target',code:'DOCUMENT_CHECKPOINT_SOURCE_CHANGED'});
  if(!target)await checkpoint(c,targetKey,{previousHash,sourcePath,sourceUrl:source.data.url,extractionId:source.data.active_extraction_id});
 }
 const journalStep=async(action:'document_status'|'status'|'begin'|'confirm'|'verify',page:number,value:unknown=null)=>{
  const state=await rpc<string>(c.db,'cloud_ocr_page_journal_step',{...lease(c),p_job:job,p_document:id,p_source_sha256:sourceSha256,
   p_source_path:sourcePath,p_source_url:source.data.url,p_snapshot_hash:snapshotHash,p_page:page,p_dpi:dpi,p_extraction_version:EXTRACTION_VERSION,p_action:action,p_value:value});
  if(state==='uncertain'||state==='existing')throw new CloudFailure('validation',5,{operation:'ocr_journal',code:state==='uncertain'?'OCR_PAGE_OUTCOME_UNCERTAIN':'OCR_PAGE_EXISTS_ELSEWHERE'});
  if(state!==(action==='document_status'||action==='status'?'new':action==='begin'?'started':action==='verify'?'verified':'confirmed'))throw new CloudFailure('internal',5,{operation:'ocr_journal',code:'OCR_JOURNAL_INVALID_RESPONSE'});
 };
 let handle:EphemeralSandbox|undefined;let blocked:string|null=null;let creationUncertain=false;let acquired=false;
 const openSandbox=async()=>{
  if(handle)return handle.session;
  await acquireResource(c,'sandbox');acquired=true;
  creationUncertain=true;
  handle=await createEphemeralSandbox('document',snapshotId);
  creationUncertain=false;
  await handle.session.writeFiles([{path:'/tmp/source.pdf',content:fetched.bytes}]);
  return handle.session;
 };
 try {
  let preflight=existingPreflight;
  if(preflight){
   if(preflight.version!==PDF_PREFLIGHT_VERSION||preflight.documentId!==id||preflight.sourceSha256!==sourceSha256||preflight.sourcePath!==sourcePath||preflight.sourceUrl!==source.data.url||preflight.snapshotHash!==snapshotHash
    ||typeof preflight.rawText!=='string'||Buffer.byteLength(preflight.rawText,'utf8')>MAX_PREFLIGHT_BYTES||preflight.rawHash!==sha256(Buffer.from(preflight.rawText,'utf8'))
    ||!Number.isInteger(preflight.pageCount)||preflight.pageCount<1||preflight.pageCount>MAX_PDF_PAGES||!Number.isInteger(preflight.exitCode))
    throw new CloudFailure('validation',5,{operation:'pdf_preflight',code:'INVALID_DOCUMENT_CHECKPOINT'});
  }else{
   // A recovery may lack preflight even though an earlier task began OCR.
   // Inspect the durable journal before creating another VM.
   await journalStep('document_status',0);
   const sb=await openSandbox();
   // Optional supplemental observation. Never create another sandbox or
   // invalidate a text/OCR checkpoint just to inspect a signature. Missing
   // pdfsig, absent schema and verification errors must not stop extraction.
   if(process.env.CONCERT_SIGNATURE_DATES_ENABLED==='true'){
    try {
     const scope=await c.db.from('source_records').select('financing_type').eq('id',source.data.source_record_id).maybeSingle();
     if(!scope.error&&scope.data?.financing_type==='concert'){
      const signature=await quietCommand(sb,'sh',['-c','command -v pdfsig >/dev/null 2>&1 && TZ=UTC LC_ALL=C pdfsig -no-ocsp /tmp/source.pdf > /tmp/signature.txt 2>/dev/null && test "$(wc -c < /tmp/signature.txt)" -le 256000'],{timeoutMs:20_000});
      if(signature.exitCode===0){
       const content=await sb.readFileToBuffer({path:'/tmp/signature.txt'});
       const observation=content?parsePdfSignatureDate(content.toString('utf8')):null;
       if(observation)await rpc(c.db,'cloud_store_concert_signature',{...lease(c),p_job:job,p_document:id,p_sha:sourceSha256,p_claimed_utc:observation.claimedUtc,p_local_date:observation.localDate,p_certificate_trust:observation.certificateTrust});
      }
     }
    }catch {
     // The observation is optional; its failure never implies an invalid PDF.
     console.warn('CONCERT_SIGNATURE_OBSERVATION_UNAVAILABLE');
    }
   }
   const command=await quietCommand(sb,'pdftotext',['-layout','/tmp/source.pdf','/tmp/source.txt'],{timeoutMs:20_000});
   // A failed pdftotext may leave no file. Treat it as empty for OCR, as before.
   const size=await quietCommand(sb,'sh',['-c',`test ! -f /tmp/source.txt || test "$(wc -c < /tmp/source.txt)" -le ${MAX_PREFLIGHT_BYTES}`],{timeoutMs:20_000});
   if(size.exitCode!==0)throw new CloudFailure('document',5,{operation:'pdf_preflight',code:'PDF_TEXT_TOO_LARGE'});
   const rawText=(await sb.readFileToBuffer({path:'/tmp/source.txt'}))?.toString('utf8')??'';
   if(Buffer.byteLength(rawText,'utf8')>MAX_PREFLIGHT_BYTES)throw new CloudFailure('document',5,{operation:'pdf_preflight',code:'PDF_TEXT_TOO_LARGE'});
   const infoResult=await quietCommand(sb,'sh',['-c','pdfinfo /tmp/source.pdf > /tmp/info.txt 2>/dev/null'],{timeoutMs:20_000});
   if(infoResult.exitCode!==0)throw new CloudFailure('document');
   const infoLimit=await quietCommand(sb,'sh',['-c','test "$(wc -c < /tmp/info.txt)" -le 65536'],{timeoutMs:20_000});
   if(infoLimit.exitCode!==0)throw new CloudFailure('document',5,{operation:'pdf_preflight',code:'PDF_INFO_TOO_LARGE'});
   const info=(await sb.readFileToBuffer({path:'/tmp/info.txt'}))?.toString('utf8')??'';
   const pageCount=Number(info.match(/Pages:\s+(\d+)/)?.[1]);
   if(!Number.isInteger(pageCount)||pageCount<1||pageCount>MAX_PDF_PAGES)throw new CloudFailure('document',5,{operation:'pdf_preflight',code:'PDF_PAGE_LIMIT'});
   preflight={version:PDF_PREFLIGHT_VERSION,...identity,snapshotHash,rawText,rawHash:sha256(Buffer.from(rawText,'utf8')),pageCount,exitCode:command.exitCode};
   await checkpoint(c,preflightKey,preflight);
  }
  if(preflight.exitCode!==0&&!ocr)throw new CloudFailure('document');
  const pageCount=preflight.pageCount;
  const inputText=preserveUnselectedPdfPages(preflight.rawText,source.data.extracted_text,forcedPages,pageCount);
  let ocrBytes=0;
  const recovered=await recoverPdfText(inputText,ocr,async page=>{
    await progress(c,'ocr',page-1,pageCount,`OCR de la pàgina ${page} de ${pageCount}`,job);
    const key=`ocr-v2:${id}:${sourceSha256}:${page}:dpi${dpi}:${EXTRACTION_VERSION}`;
    const pageRead=await readBoundedPdfCheckpoint<OcrCheckpoint>(c,job,id,'page',key,MAX_OCR_BYTES-ocrBytes);
    const cached=pageRead.found?pageRead.value:null;
    if(cached){
     if(cached.version!=='ocr-page-v2'||cached.documentId!==id||cached.sourceSha256!==sourceSha256||cached.sourcePath!==sourcePath||cached.sourceUrl!==source.data.url||cached.page!==page||cached.dpi!==dpi
      ||typeof cached.text!=='string'||cached.textHash!==sha256(Buffer.from(cached.text,'utf8')))throw new CloudFailure('validation',5,{operation:'ocr_checkpoint',code:'INVALID_DOCUMENT_CHECKPOINT'});
    }else{
     // Legacy keys do not identify the sandbox image or canonical source path.
     // Stop rather than reusing them or repeating a previously confirmed OCR.
     const legacy=await readBoundedPdfCheckpoint(c,job,id,'legacy',`ocr:${digest}:${page}:dpi${dpi}:${EXTRACTION_VERSION}`,0);
     if(legacy.found||await readCheckpoint(c,`legacy-ocr-pending:${id}`)!==null)
      throw new CloudFailure('validation',5,{operation:'ocr_checkpoint',code:'LEGACY_OCR_SOURCE_UNVERIFIED'});
    }
    if(cached){
     // The page key predates the journal and does not encode the sandbox image.
     // Verify a confirmed receipt for this exact source and image before reuse.
     await journalStep('verify',page,{textHash:cached.textHash});
     ocrBytes+=Buffer.byteLength(cached.text,'utf8');
     if(ocrBytes>MAX_OCR_BYTES)throw new CloudFailure('document',5,{operation:'ocr_checkpoint',code:'OCR_TEXT_TOO_LARGE'});
     return cached.text;
    }
    // Check uncertainty before acquiring a fresh VM. A prior confirmed page is
    // already returned by the bounded checkpoint read above.
    await journalStep('status',page);
    const sb=await openSandbox();
    const render=await quietCommand(sb,'pdftoppm',['-png','-r',String(dpi),'-f',String(page),'-l',String(page),'-singlefile','/tmp/source.pdf','/tmp/page'],{timeoutMs:60_000});
    if(render.exitCode!==0)throw new CloudFailure('document');
    // Durable before Tesseract: a crash from this point must never rerun it silently.
    await journalStep('begin',page);
    const recognize=await quietCommand(sb,'tesseract',['/tmp/page.png','/tmp/page','-l','cat+spa'],{timeoutMs:120_000});
    if(recognize.exitCode!==0)throw new CloudFailure('document');
    const size=await quietCommand(sb,'sh',['-c',`test "$(wc -c < /tmp/page.txt)" -le ${MAX_OCR_BYTES-ocrBytes}`],{timeoutMs:20_000});
    if(size.exitCode!==0)throw new CloudFailure('document',5,{operation:'ocr_checkpoint',code:'OCR_TEXT_TOO_LARGE'});
    const text=(await sb.readFileToBuffer({path:'/tmp/page.txt'}))?.toString('utf8')??'';
    if(ocrBytes+Buffer.byteLength(text,'utf8')>MAX_OCR_BYTES)throw new CloudFailure('document',5,{operation:'ocr_checkpoint',code:'OCR_TEXT_TOO_LARGE'});
    await journalStep('confirm',page,{version:'ocr-page-v2',...identity,page,dpi,text,textHash:sha256(Buffer.from(text,'utf8'))} satisfies OcrCheckpoint);
    throw new CloudYield();
  },pageCount,forcedPages);
  const result={...recovered,coverage:recovered.method==='pdf-ocr-markdown-v2'?{...recovered.coverage,ocrEngine:'tesseract',ocrLanguages:['cat','spa'],ocrDpi:dpi,...(forcedPages.length?{requestedPages:forcedPages}:{})}:recovered.coverage,hash:digest,mime:'application/pdf',source_sha256:sourceSha256,source_url:source.data.url,source_path:sourcePath,...(forcedPages.length?{previous_text_sha256:sha256(Buffer.from(source.data.extracted_text??'', 'utf8')),target_previous_extraction_id:source.data.active_extraction_id,target_pages:forcedPages}:{})};
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
  if(acquired)await rpc(c.db,'cloud_resource',{p_name:'sandbox',p_owner:c.owner,p_release:true,p_block:blocked});
 }
}

async function quietCommand(sb:DocumentSession,command:string,args:string[]=[],options?:{timeoutMs:number}){
 const result=await sb.runCommand('sh',['-c','exec "$@" >/tmp/operation.stdout 2>/tmp/operation.stderr','cloud',command,...args],options);
 // Missing executables, killed processes and timeouts are infrastructure incidents.
 if(result.exitCode===124||result.exitCode>=126)throw new CloudFailure('internal',5,{operation:'sandbox_command',code:'SANDBOX_COMMAND_INTERRUPTED',details:{command,exitCode:result.exitCode}});
 return result;
}
