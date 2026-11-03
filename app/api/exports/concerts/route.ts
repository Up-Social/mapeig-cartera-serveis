import {createServerSupabase} from '@/lib/records-page';
import {loadConcertEvolution} from '@/lib/concerts/evolution-store';
import {concertEvolution,isConcertCutoff} from '@/lib/concerts/evolution';
import {createConcertEvolutionExcel} from '@/lib/concerts/export';
import {isUuid} from '@/lib/uuid';
import {LineReadUnavailable} from '@/lib/concerts/line-read-guard';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const url=new URL(request.url),id=url.searchParams.get('record');
 if(!id||!isUuid(id))return Response.json({error:'Cal indicar el registre del concert.'},{status:400});
 const cutoff=url.searchParams.get('cutoff')??new Date().toISOString().slice(0,10);
 if(!isConcertCutoff(cutoff))return Response.json({error:'La data de tall no és vàlida. Introdueix una data existent.'},{status:400});
 try{
  const data=await loadConcertEvolution(createServerSupabase(),id),result=concertEvolution(data,cutoff);
  const buffer=await createConcertEvolutionExcel(result,cutoff,url.origin);
  return new Response(buffer,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="concerts-${cutoff}.xlsx"`,'Cache-Control':'no-store'}});
 }catch(error){if(error instanceof LineReadUnavailable)return Response.json({error:error.message},{status:503});return Response.json({error:'No s’ha pogut generar la foto dels concerts. Torna-ho a provar; si el problema persisteix, revisa la disponibilitat del servei.'},{status:500});}
}
