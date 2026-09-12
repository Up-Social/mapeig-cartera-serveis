import {Sandbox} from '@vercel/sandbox';
import {checkpoint,readCheckpoint,rpc,type Context} from './context';
import {CloudFailure,CloudYield} from './errors';
import {fetchWithLimits,htmlToText,cleanText} from '../pipeline/document-input';
import {hash} from '../pipeline/chunks';
type Extraction={text:string;method:string;hash:string;mime:string;partial:boolean};
export async function extractDocument(c:Context,id:string,url:string,ocr:boolean):Promise<Extraction>{
 const cached=await readCheckpoint<Extraction>(c,`document:${id}`);if(cached)return cached;
 let fetched:{bytes:Buffer;mimeType:string};
 const original=await readCheckpoint<{path:string;mime:string;hash:string}>(c,`original:${id}`);
 if(original){
  const r=await c.db.storage.from('cloud-documents').download(original.path);if(r.error||!r.data)throw new CloudFailure('internal');
  fetched={bytes:Buffer.from(await r.data.arrayBuffer()),mimeType:original.mime};
 }else{
  try {fetched=await fetchWithLimits(url);}catch {throw new CloudFailure('document');}
  const digest=hash(fetched.bytes.toString('base64'));const path=`${c.task}/${id}/${digest}`;
  const r=await c.db.storage.from('cloud-documents').upload(path,fetched.bytes,{upsert:true,contentType:fetched.mimeType});if(r.error)throw new CloudFailure('internal');
  await checkpoint(c,`original:${id}`,{path,mime:fetched.mimeType,hash:digest});
 }
 const digest=hash(fetched.bytes.toString('base64'));
 const pdf=fetched.mimeType.includes('pdf')||fetched.bytes.subarray(0,4).toString()==='%PDF';
 if(!pdf){
  if(!fetched.mimeType.includes('html')&&fetched.mimeType!=='text/plain')throw new CloudFailure('document');
  const result={text:cleanText(htmlToText(fetched.bytes.toString('utf8'))),method:'html-basic',hash:digest,mime:fetched.mimeType,partial:false};
  if(result.text.length<50)throw new CloudFailure('document');await checkpoint(c,`document:${id}`,result);return result;
 }
 if(!process.env.CLOUD_SANDBOX_SNAPSHOT)throw new CloudFailure('credentials');
 if(!await rpc<boolean>(c.db,'cloud_resource',{p_name:'sandbox',p_owner:c.owner}))throw new CloudFailure('transient',30);
 let sb:Sandbox|undefined;let blocked:string|null=null;
 try {
  sb=await Sandbox.create({source:{type:'snapshot',snapshotId:process.env.CLOUD_SANDBOX_SNAPSHOT},timeout:600_000,resources:{vcpus:1},networkPolicy:'deny-all'});
  await sb.writeFiles([{path:'/tmp/source.pdf',content:fetched.bytes}]);
  const command=await quietCommand(sb,'pdftotext',['-layout','/tmp/source.pdf','/tmp/source.txt'],{timeoutMs:20_000});
  if(command.exitCode!==0)throw new CloudFailure('document');
  let text=(await sb.readFileToBuffer({path:'/tmp/source.txt'}))?.toString('utf8')??'';
  let method='pdftotext';let partial=text.length>200_000;
  if(text.trim().length<50&&ocr){
   method='tesseract-ocr';
   await quietCommand(sb,'sh',['-c','pdfinfo /tmp/source.pdf > /tmp/info.txt 2>/dev/null'],{timeoutMs:20_000});
   const info=(await sb.readFileToBuffer({path:'/tmp/info.txt'}))?.toString('utf8')??'';
   const pageCount=Number(info.match(/Pages:\s+(\d+)/)?.[1]);
   if(!pageCount)throw new CloudFailure('document');partial=pageCount>25;
   const pages:string[]=[];
   for(let page=1;page<=Math.min(25,pageCount);page++){
    const key=`ocr:${digest}:${page}:v1`;
    let result=await readCheckpoint<{text:string}>(c,key);
    if(!result){
     const render=await quietCommand(sb,'pdftoppm',['-png','-r','200','-f',String(page),'-l',String(page),'-singlefile','/tmp/source.pdf','/tmp/page'],{timeoutMs:60_000});
     if(render.exitCode!==0)throw new CloudFailure('document');
     const recognize=await quietCommand(sb,'tesseract',['/tmp/page.png','/tmp/page','-l','cat+spa'],{timeoutMs:120_000});
     if(recognize.exitCode!==0)throw new CloudFailure('document');
     result={text:(await sb.readFileToBuffer({path:'/tmp/page.txt'}))?.toString('utf8')??''};
     await checkpoint(c,key,result);
     throw new CloudYield();
    }
    pages.push(result.text);
    await rpc(c.db,'cloud_resource',{p_name:'sandbox',p_owner:c.owner});
   }
   text=pages.join('\n\n');
  }
  if(text.trim().length<50)throw new CloudFailure('document');
  const result={text:cleanText(text),method,hash:digest,mime:'application/pdf',partial:partial||text.length>200_000};
  await checkpoint(c,`document:${id}`,result);return result;
 }catch(error){
  if(error instanceof CloudFailure||error instanceof CloudYield)throw error;
  const status=(error as {status?:number;statusCode?:number}).status??(error as {statusCode?:number}).statusCode;
  if(status===402||status===429){blocked='vercel_quota';throw new CloudFailure('vercel_quota');}
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
