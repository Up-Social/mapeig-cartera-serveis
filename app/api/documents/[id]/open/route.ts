import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';
import {officialJson,OFFICIAL_DOCUMENT_HOSTS} from '@/lib/pipeline/official-resolution';
import {hasUnitSchema} from '@/lib/runtime-schema';
import {ArchivedSourceUnavailableError,readSource,SourceContentChangedError} from '@/lib/source-storage';

/** The same case-scoped archive serves every source dataset. Never redirect to an unarchived original. */
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 if(!isUuid(id))return Response.json({error:'Document no vàlid'},{status:400});
 const db=createServerSupabase();
 const {data,error}=await db.from('source_documents').select('*').eq('id',id).maybeSingle();
 if(error||!data)return Response.json({error:'Document no disponible'},{status:404});
 // The already-running local preview still uses the pre-migration remote schema.
 if(!hasUnitSchema())return legacyOpen(data.url);
 try{
  const archived=await readSource(db,data);
  const headers=new Headers({'Content-Type':archived.mimeType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
  if(/html|xml|svg/i.test(archived.mimeType))headers.set('Content-Security-Policy',"sandbox; default-src 'none'");
  return new Response(archived.bytes,{headers});
 }catch(cause){
  if(cause instanceof SourceContentChangedError)return Response.json({error:cause.message},{status:409});
  if(cause instanceof ArchivedSourceUnavailableError)return Response.json({error:cause.message},{status:503});
  return Response.json({error:'No s’ha pogut descarregar i arxivar la font a Storage'},{status:503});
 }
}

async function legacyOpen(original:string){
 try{
  let url=new URL(original);
  if(url.hostname==='tauler.seu-e.cat'&&/^\/api\/documents\/[a-f0-9-]+\/info$/.test(url.pathname)){
   const info=await officialJson(url.toString());
   if(typeof info.url!=='string')throw Error();
   url=new URL(info.url);
   if(!OFFICIAL_DOCUMENT_HOSTS.includes(url.hostname))throw Error();
  }
  if(url.protocol!=='https:'&&url.protocol!=='http:')throw Error();
  return new Response(null,{status:302,headers:{Location:url.toString(),'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'No s’ha pogut resoldre el document oficial.'},{status:502});}
}
