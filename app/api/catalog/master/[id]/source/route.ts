import {createServerSupabase} from '@/lib/records-page';
import {SOURCE_BUCKET,sha256} from '@/lib/source-storage';
import {isUuid} from '@/lib/uuid';

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!isUuid(id))return Response.json({error:'Servei no vàlid'},{status:400});
 const db=createServerSupabase();
 const result=await db.from('master_services').select('source_file,source_sheet,source_row,source_payload_hash,storage_path,storage_sha256').eq('id',id).maybeSingle();
 const row=result.data;
 if(result.error||!row?.storage_path||!row.storage_sha256||row.storage_path!==`references/master/items/${id}/source/${row.storage_sha256}.json`)
  return Response.json({error:'Font mestra arxivada no disponible'},{status:404});
 const stored=await db.storage.from(SOURCE_BUCKET).download(row.storage_path);
 if(stored.error||!stored.data)return Response.json({error:'Fila absent de Storage'},{status:503});
 const rowBytes=Buffer.from(await stored.data.arrayBuffer());
 if(sha256(rowBytes)!==row.storage_sha256)return Response.json({error:'La fila no supera la verificació d’integritat'},{status:503});
 let snapshot:Record<string,unknown>;
 try{snapshot=JSON.parse(rowBytes.toString('utf8')) as Record<string,unknown>;}catch{return Response.json({error:'Fila arxivada invàlida'},{status:503});}
 const workbook=snapshot.workbook as Record<string,unknown>|undefined;
 if(snapshot.kind!=='historical_master_reconciliation'||snapshot.master_id!==id||snapshot.source_file!==row.source_file||snapshot.source_sheet!==row.source_sheet||snapshot.source_row!==row.source_row||snapshot.source_payload_hash!==row.source_payload_hash||!workbook||workbook.bucket!==SOURCE_BUCKET||typeof workbook.sha256!=='string'||workbook.path!==`imports/legacy/${workbook.sha256}.xlsx`)
  return Response.json({error:'Procedència mestra invàlida'},{status:503});
 const downloaded=await db.storage.from(SOURCE_BUCKET).download(workbook.path);
 if(downloaded.error||!downloaded.data)return Response.json({error:'Llibre absent de Storage'},{status:503});
 const bytes=Buffer.from(await downloaded.data.arrayBuffer());
 if(sha256(bytes)!==workbook.sha256)return Response.json({error:'La còpia no supera la verificació d’integritat'},{status:503});
 return new Response(bytes,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="master-${id}.xlsx"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
