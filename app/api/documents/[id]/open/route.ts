import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';
import {officialJson,OFFICIAL_DOCUMENT_HOSTS} from '@/lib/pipeline/official-resolution';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!isUuid(id))return Response.json({error:'Document no vàlid'},{status:400});
 const {data,error}=await createServerSupabase().from('source_documents').select('url').eq('id',id).maybeSingle();
 if(error||!data)return Response.json({error:'Document no disponible'},{status:404});
 try{let url=new URL(data.url);if(url.hostname==='tauler.seu-e.cat'&&/^\/api\/documents\/[a-f0-9-]+\/info$/.test(url.pathname)){
  const info=await officialJson(url.toString());if(typeof info.url!=='string')throw Error();url=new URL(info.url);if(!OFFICIAL_DOCUMENT_HOSTS.includes(url.hostname))throw Error();
 }if(url.protocol!=='https:'&&url.protocol!=='http:')throw Error();
 return new Response(null,{status:302,headers:{Location:url.toString(),'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'No s’ha pogut resoldre el document oficial.'},{status:502});}
}
