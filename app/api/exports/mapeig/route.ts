import {createServerSupabase} from '@/lib/records-page';
import {LineReadUnavailable} from '@/lib/concerts/line-read-guard';
import {buildMapeigExport,MapeigTooManyRowsError} from '@/lib/exports/mapeig';
import {parseMapeigFilters} from '@/lib/exports/mapeig/filters';
import {saveMapeigExport} from '@/lib/exports/mapeig/history';
import {MapeigFilterError,MapeigTemplateError,MapeigUnavailableTypeError} from '@/lib/exports/mapeig/types';
export const dynamic='force-dynamic';
export const maxDuration=60;

/** GET so the download keeps the same query string as the page preview. */
export async function GET(request:Request){
 const url=new URL(request.url);
 let filters;
 try{filters=parseMapeigFilters(url.searchParams);}
 catch(error){if(error instanceof MapeigFilterError)return Response.json({error:error.message},{status:400});throw error;}
 try{
  const db=createServerSupabase();
  const result=await buildMapeigExport(db,filters,url.origin);
  if(!result.rowCount)return Response.json({error:'No hi ha cap línia que compleixi aquests filtres.'},{status:409});
  // The file is served even when the history cannot be written; the header
  // tells the page so the user knows the export is not listed.
  let historyId='unavailable';
  try{
   const saved=await saveMapeigExport(db,{bytes:result.bytes,sha256:result.sha256,fileName:result.fileName,filters,rowCount:result.rowCount,totalCents:result.preview.totalCents,
    summary:{byProvince:result.preview.byProvince,counts:result.preview.counts,excluded:result.preview.excluded},notes:result.preview.notes});
   historyId=saved.id;
  }catch(error){console.error('mapeig export history failed',error);}
  return new Response(new Uint8Array(result.bytes),{headers:{
   'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
   'Content-Disposition':`attachment; filename="${result.fileName}"`,
   'Cache-Control':'no-store',
   'X-Export-Rows':String(result.rowCount),
   'X-Export-Sha256':result.sha256,
   'X-Export-History':historyId,
  }});
 }catch(error){
  if(error instanceof MapeigUnavailableTypeError)return Response.json({error:error.message},{status:400});
  if(error instanceof MapeigTooManyRowsError)return Response.json({error:error.message},{status:422});
  if(error instanceof LineReadUnavailable)return Response.json({error:error.message},{status:503});
  if(error instanceof MapeigTemplateError)return Response.json({error:error.message},{status:500});
  console.error('mapeig export failed',error);
  return Response.json({error:'No s’ha pogut generar l’Excel del Mapeig. Torna-ho a provar; si el problema persisteix, revisa la disponibilitat del servei.'},{status:500});
 }
}
