import {createServerSupabase} from '@/lib/records-page';
import {SOURCE_BUCKET,sha256} from '@/lib/source-storage';
import {isUuid} from '@/lib/uuid';

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!isUuid(id))return Response.json({error:'Registre no vàlid'},{status:400});
 const db=createServerSupabase();
 const row=await db.from('source_records').select('source_file,source_sheet,source_row,source_payload_hash,import_run_id,storage_path,storage_sha256').eq('id',id).maybeSingle();
 if(row.error||!row.data?.source_file)return Response.json({error:'Font no disponible'},{status:404});
 let entry:{bucket:string;path:string;sha256:string}|undefined;
 if(row.data.import_run_id){
  const run=await db.from('import_runs').select('storage_manifest').eq('id',row.data.import_run_id).maybeSingle();
  entry=run.data?.storage_manifest?.[row.data.source_file];
  if(run.error||!entry||entry.bucket!==SOURCE_BUCKET||typeof entry.path!=='string'||typeof entry.sha256!=='string'||entry.path!==`imports/${row.data.import_run_id}/${entry.sha256}.xlsx`)
   return Response.json({error:'Llibre arxivat no disponible'},{status:404});
 }else{
  const {storage_path:path,storage_sha256:digest}=row.data;
  if(!path||!digest||path!==`cases/${id}/imports/legacy/${digest}.json`)return Response.json({error:'Fila històrica no arxivada'},{status:404});
  const stored=await db.storage.from(SOURCE_BUCKET).download(path);
  if(stored.error||!stored.data)return Response.json({error:'Fila absent de Storage'},{status:503});
  const bytes=Buffer.from(await stored.data.arrayBuffer());
  if(sha256(bytes)!==digest)return Response.json({error:'La fila no supera la verificació d’integritat'},{status:503});
  let snapshot:Record<string,unknown>;
  try{snapshot=JSON.parse(bytes.toString('utf8')) as Record<string,unknown>;}catch{return Response.json({error:'Fila arxivada invàlida'},{status:503});}
  if(snapshot.record_id!==id||snapshot.source_file!==row.data.source_file||snapshot.source_sheet!==row.data.source_sheet||snapshot.source_row!==row.data.source_row||snapshot.source_payload_hash!==row.data.source_payload_hash)
   return Response.json({error:'Procedència històrica invàlida'},{status:503});
  if(snapshot.kind==='historical_api_reconciliation'){
   const report=snapshot.report as Record<string,unknown>|undefined;
   if(!report||report.bucket!==SOURCE_BUCKET||typeof report.sha256!=='string'||report.path!==`imports/legacy/${report.sha256}.json`)
    return Response.json({error:'Informe d’origen invàlid'},{status:503});
   return new Response(bytes,{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="origen-${id}.json"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  const workbook=snapshot.workbook as Record<string,unknown>|undefined;
  if(snapshot.kind!=='historical_reconciliation'||!workbook||workbook.bucket!==SOURCE_BUCKET||typeof workbook.sha256!=='string'||workbook.path!==`imports/legacy/${workbook.sha256}.xlsx`)
   return Response.json({error:'Procedència històrica invàlida'},{status:503});
  entry={bucket:SOURCE_BUCKET,path:workbook.path,sha256:workbook.sha256};
 }
 const downloaded=await db.storage.from(SOURCE_BUCKET).download(entry.path);
 if(downloaded.error||!downloaded.data)return Response.json({error:'Llibre absent de Storage'},{status:503});
 const bytes=Buffer.from(await downloaded.data.arrayBuffer());
 if(sha256(bytes)!==entry.sha256)return Response.json({error:'La còpia no supera la verificació d’integritat'},{status:503});
 return new Response(bytes,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="origen-${id}.xlsx"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
