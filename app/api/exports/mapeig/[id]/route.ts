import {createServerSupabase} from '@/lib/records-page';
import {MapeigExportNotFoundError,MapeigHistoryError,readMapeigExport} from '@/lib/exports/mapeig/history';
export const dynamic='force-dynamic';

/** Serves a workbook from the history exactly as it was generated. */
export async function GET(_request:Request,context:RouteContext<'/api/exports/mapeig/[id]'>){
 const {id}=await context.params;
 try{
  const {record,bytes}=await readMapeigExport(createServerSupabase(),id);
  return new Response(new Uint8Array(bytes),{headers:{
   'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
   'Content-Disposition':`attachment; filename="${record.fileName}"`,
   'Cache-Control':'no-store',
   'X-Export-Rows':String(record.rowCount),
   'X-Export-Sha256':record.sha256,
  }});
 }catch(error){
  if(error instanceof MapeigExportNotFoundError)return Response.json({error:error.message},{status:404});
  if(error instanceof MapeigHistoryError)return Response.json({error:error.message},{status:503});
  console.error('mapeig history download failed',error);
  return Response.json({error:'No s’ha pogut recuperar el fitxer de l’històric.'},{status:500});
 }
}
