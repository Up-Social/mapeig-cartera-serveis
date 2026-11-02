import {createServerSupabase} from '@/lib/records-page';
import {captureVerifiedArchivePair} from '@/lib/concerts/population-archive';
import {handleAward} from '@/lib/concerts/line-award-handler';
import {readConcertWriteStatus} from '@/lib/concerts/line-write-status';
import {isUuid} from '@/lib/uuid';

type Params={params:Promise<{id:string;unitId:string}>};
const available=()=>process.env.ENABLE_CONCERT_LINE_AWARDS==='true'&&process.env.CONCERT_LINE_READERS_READY==='true';
const writeStatus=(db:ReturnType<typeof createServerSupabase>)=>readConcertWriteStatus(()=>db.rpc('concert_line_write_status'));
export async function GET(request:Request,{params}:Params){
 if(!available())return Response.json({enabled:false},{headers:{'Cache-Control':'no-store'}});
 const {id,unitId}=await params;const job=new URL(request.url).searchParams.get('job');
 if(!isUuid(id)||!isUuid(unitId)||!job||!isUuid(job))return Response.json({error:'Identificadors invàlids'},{status:400});
 const db=createServerSupabase();const status=await writeStatus(db);
 if(status.state==='paused')return Response.json({enabled:false,paused:true,reason:status.reason},{headers:{'Cache-Control':'no-store'}});
 if(status.state==='unavailable')return Response.json({error:'No s’ha pogut comprovar si les revisions estan disponibles.'},{status:503});
 const result=await db.rpc('concert_line_award_archive_snapshot',{p_record:id,p_job:job,p_unit:unitId});
 if(result.error||!result.data)return Response.json({error:'No s’ha pogut consultar la revisió econòmica.'},{status:409});
 return Response.json({enabled:true,previousId:result.data.previous_decision??null},{headers:{'Cache-Control':'no-store'}});
}
// The feature is deliberately closed until the reader, receipt and review
// contracts are deployed and verified together.
export async function POST(request:Request,{params}:Params){
 if(!available())return Response.json({error:'La revisió econòmica individual encara no està disponible.'},{status:503});
 const {id,unitId:unit}=await params;const db=createServerSupabase();
 const status=await writeStatus(db);
 if(status.state==='paused')return Response.json({error:`Les revisions econòmiques de Concerts estan temporalment aturades.${status.reason?` Motiu: ${status.reason}`:''} No s’ha enviat cap decisió.`,outcome:'not_sent'},{status:409});
 if(status.state==='unavailable')return Response.json({error:'No s’ha pogut comprovar si les revisions estan disponibles. No s’ha enviat cap decisió.',outcome:'not_sent'},{status:503});
 return handleAward(request,id,unit,{
  snapshot:async(record,job,line)=>{const result=await db.rpc('concert_line_award_archive_snapshot',{p_record:record,p_job:job,p_unit:line});if(result.error)throw result.error;return result.data;},
  capture:(snapshot,signal)=>captureVerifiedArchivePair(db,snapshot.document_path,snapshot.unit_path,snapshot.document_sha256,signal),
  retain:async(record,job,line,snapshot,bytes,signal)=>{const result=await db.rpc('concert_line_retain_archive',{p_record:record,p_job:job,p_unit:line,p_snapshot:snapshot,p_base64:Buffer.from(bytes).toString('base64')}).abortSignal(AbortSignal.any([signal,AbortSignal.timeout(30000)]));if(result.error||result.data!==snapshot.document_sha256)throw result.error??Error('RETAINED_HASH_MISMATCH');},
  decide:async(input)=>{const result=await db.rpc('concert_line_award_decide',input);if(result.error)throw result.error;return result.data;},
 });
}
