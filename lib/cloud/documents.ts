import {EXTRACTION_VERSION,recoverPdfText} from '../pipeline/readable-document';
import {Sandbox} from '@vercel/sandbox';
import {checkpoint,readCheckpoint,rpc,acquireResource,progress,type Context} from './context';
import {CloudFailure,CloudYield} from './errors';
import {htmlToText,cleanText} from '../pipeline/document-input';
import {hash} from '../pipeline/chunks';
import {fetchOfficialDocument} from '../pipeline/official-resolution';
import {archiveSource,readSource} from '../source-storage';
type Extraction={text:string;method:string;hash:string;mime:string;partial:boolean;extraction_version:string;coverage?:unknown};
const OCR_RENDER_DPI=300;
export async function extractDocument(c:Context,job:string,id:string,url:string,ocr:boolean):Promise<Extraction>{
 const source=await c.db.from('source_documents').select('id,source_record_id,url,content_hash,storage_path,storage_sha256,mime_type').eq('id',id).single();
 if(source.error||!source.data)throw new CloudFailure('internal');
 const cached=await readCheckpoint<Extraction>(c,`document:${id}:${EXTRACTION_VERSION}`);
 // A failed attempt can copy an incomplete extraction into a recovery task.
 // It must be recomputed with the new OCR setting instead of failing again.
 if(cached&&!cached.partial){await archiveSource(c.db,source.data);return cached;}
 let fetched:{bytes:Buffer;mimeType:string};
 const original=await readCheckpoint<{path:string;mime:string;hash:string}>(c,`original:${id}`);
 if(original){
  const r=await c.db.storage.from('cloud-documents').download(original.path);if(r.error||!r.data)throw new CloudFailure('internal');
  fetched={bytes:Buffer.from(await r.data.arrayBuffer()),mimeType:original.mime};
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
 if(original)await archiveSource(c.db,source.data,fetched);
 const digest=hash(fetched.bytes.toString('base64'));
 const pdf=fetched.mimeType.includes('pdf')||fetched.bytes.subarray(0,4).toString()==='%PDF';
 if(!pdf){
  if(!fetched.mimeType.includes('html')&&fetched.mimeType!=='text/plain')throw new CloudFailure('document');
  const result={text:cleanText(htmlToText(fetched.bytes.toString('utf8'))),method:'html-basic',hash:digest,mime:fetched.mimeType,partial:false,extraction_version:EXTRACTION_VERSION};
  if(result.text.length<50)throw new CloudFailure('document');await checkpoint(c,`document:${id}:${EXTRACTION_VERSION}`,result);return result;
 }
 if(!process.env.CLOUD_SANDBOX_SNAPSHOT)throw new CloudFailure('credentials');
 await acquireResource(c,'sandbox');
 let sb:Sandbox|undefined;let blocked:string|null=null;
 try {
  sb=await Sandbox.create({source:{type:'snapshot',snapshotId:process.env.CLOUD_SANDBOX_SNAPSHOT},timeout:600_000,resources:{vcpus:1},networkPolicy:'deny-all'});
  await sb.writeFiles([{path:'/tmp/source.pdf',content:fetched.bytes}]);
  const command=await quietCommand(sb,'pdftotext',['-layout','/tmp/source.pdf','/tmp/source.txt'],{timeoutMs:20_000});
  if(command.exitCode!==0&&!ocr)throw new CloudFailure('document');
  const rawText=(await sb.readFileToBuffer({path:'/tmp/source.txt'}))?.toString('utf8')??'';
  await quietCommand(sb,'sh',['-c','pdfinfo /tmp/source.pdf > /tmp/info.txt 2>/dev/null'],{timeoutMs:20_000});
  const info=(await sb.readFileToBuffer({path:'/tmp/info.txt'}))?.toString('utf8')??'';
  const pageCount=Number(info.match(/Pages:\s+(\d+)/)?.[1]);
  if(!pageCount)throw new CloudFailure('document');
  const recovered=await recoverPdfText(rawText,ocr,async page=>{
    await progress(c,'ocr',page-1,pageCount,`OCR de la pàgina ${page} de ${pageCount}`,job);
    const key=`ocr:${digest}:${page}:dpi${OCR_RENDER_DPI}:${EXTRACTION_VERSION}`;
    const cached=await readCheckpoint<{text:string}>(c,key);
    if(cached)return cached.text;
    const render=await quietCommand(sb!,'pdftoppm',['-png','-r',String(OCR_RENDER_DPI),'-f',String(page),'-l',String(page),'-singlefile','/tmp/source.pdf','/tmp/page'],{timeoutMs:60_000});
    if(render.exitCode!==0)throw new CloudFailure('document');
    const recognize=await quietCommand(sb!,'tesseract',['/tmp/page.png','/tmp/page','-l','cat+spa'],{timeoutMs:120_000});
    if(recognize.exitCode!==0)throw new CloudFailure('document');
    const text=(await sb!.readFileToBuffer({path:'/tmp/page.txt'}))?.toString('utf8')??'';
    await checkpoint(c,key,{text});
    throw new CloudYield();
  },pageCount);
  const result={...recovered,coverage:recovered.method==='pdf-ocr-markdown-v2'?{...recovered.coverage,ocrEngine:'tesseract',ocrLanguages:['cat','spa'],ocrDpi:OCR_RENDER_DPI}:recovered.coverage,hash:digest,mime:'application/pdf'};
  await checkpoint(c,`document:${id}:${EXTRACTION_VERSION}`,result);return result;
 }catch(error){
  if(error instanceof CloudFailure||error instanceof CloudYield)throw error;
  const status=(error as {response?:Response}).response?.status;
  const code=(error as {json?:{error?:{code?:string}}}).json?.error?.code;
  if(code&&/quota|usage_limit|limit_exceeded/.test(code)){blocked='vercel_quota';throw new CloudFailure('vercel_quota');}
  if(status===429)throw new CloudFailure('transient',30);
  if(status===402){blocked='vercel_quota';throw new CloudFailure('vercel_quota');}
  if(status===401||status===403)throw new CloudFailure('credentials');
  throw new CloudFailure('document');
 }finally{
  try {await sb?.stop();}catch { /* Session has a hard ten-minute expiry. */ }
  await rpc(c.db,'cloud_resource',{p_name:'sandbox',p_owner:c.owner,p_release:true,p_block:blocked});
 }
}

async function quietCommand(sb:Sandbox,command:string,args:string[]=[],options?:{timeoutMs:number}){
 return sb.runCommand('sh',['-c','exec "$@" >/tmp/operation.stdout 2>/tmp/operation.stderr','cloud',command,...args],options);
}
