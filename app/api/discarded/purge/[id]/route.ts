import {purgeDeletion} from '@/lib/discard-deletion';
import {isUuid} from '@/lib/uuid';
export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!isUuid(id))return Response.json({error:'Identificador no vàlid'},{status:400});
 try{return Response.json(await purgeDeletion(id));}catch{return Response.json({error:'La neteja continua pendent.'},{status:503});}
}
