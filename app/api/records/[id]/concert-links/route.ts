import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';

export const dynamic='force-dynamic';

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 if(!isUuid(id))return Response.json({error:'Registre no vàlid'},{status:400});
 const db=createServerSupabase();
 const [outgoing,incoming]=await Promise.all([
  db.from('concert_record_links').select('*').eq('later_record_id',id).order('created_at'),
  db.from('concert_record_links').select('*').eq('earlier_record_id',id).order('created_at'),
 ]);
 if(outgoing.error||incoming.error)return Response.json({error:'No s’han pogut consultar els vincles del concert'},{status:500});
 const links=[...(outgoing.data??[]).map(row=>({...row,direction:'anterior'})),...(incoming.data??[]).map(row=>({...row,direction:'posterior'}))];
 const ids=[...new Set(links.map(row=>row.direction==='anterior'?row.earlier_record_id:row.later_record_id))];
 if(!ids.length)return Response.json({links:[]});
 const records=await db.from('source_records').select('id,title,source_record_id,source_payload').in('id',ids);
 if(records.error)return Response.json({error:'No s’han pogut carregar les resolucions relacionades'},{status:500});
 const byId=new Map((records.data??[]).map(row=>[row.id,row]));
 return Response.json({links:links.map(row=>{
  const other=byId.get(row.direction==='anterior'?row.earlier_record_id:row.later_record_id);
  return {id:row.id,direction:row.direction,kind:row.link_kind,method:row.matching_method,status:row.status,evidence:row.evidence,
   reviewNote:row.review_note,record:other?{id:other.id,title:other.title,sourceRecordId:other.source_record_id,
    officialUrl:typeof other.source_payload?.record_url==='string'?other.source_payload.record_url:null,
    publishedAt:typeof other.source_payload?.data_publicacio==='string'?other.source_payload.data_publicacio:null}:null};
 })});
}
