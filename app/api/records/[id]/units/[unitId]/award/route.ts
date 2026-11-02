import {createServerSupabase} from '@/lib/records-page';
import {verifyPopulationArchive} from '@/lib/concerts/population-archive';
import {handleAward} from '@/lib/concerts/line-award-handler';
import {isUuid} from '@/lib/uuid';

type Params={params:Promise<{id:string;unitId:string}>};
const available=()=>process.env.ENABLE_CONCERT_LINE_AWARDS==='true'&&process.env.CONCERT_LINE_READERS_READY==='true';
export async function GET(request:Request,{params}:Params){
 if(!available())return Response.json({enabled:false},{headers:{'Cache-Control':'no-store'}});
 const {id,unitId}=await params;const job=new URL(request.url).searchParams.get('job');
 if(!isUuid(id)||!isUuid(unitId)||!job||!isUuid(job))return Response.json({error:'Identificadors invàlids'},{status:400});
 const result=await createServerSupabase().rpc('concert_line_award_archive_snapshot',{p_record:id,p_job:job,p_unit:unitId});
 if(result.error||!result.data)return Response.json({error:'No s’ha pogut consultar la revisió econòmica.'},{status:409});
 return Response.json({enabled:true,previousId:result.data.previous_decision??null},{headers:{'Cache-Control':'no-store'}});
}
// The feature is deliberately closed until the reader, receipt and review
// contracts are deployed and verified together.
export async function POST(request:Request,{params}:Params){
 if(!available())return Response.json({error:'La revisió econòmica individual encara no està disponible.'},{status:503});
 const {id,unitId:unit}=await params;const db=createServerSupabase();
 return handleAward(request,id,unit,{
  snapshot:async(record,job,line)=>{const result=await db.rpc('concert_line_award_archive_snapshot',{p_record:record,p_job:job,p_unit:line});if(result.error)throw result.error;return result.data;},
  verify:(path,sha,signal)=>verifyPopulationArchive(db,path,sha,signal),
  decide:async(input)=>{const result=await db.rpc('concert_line_award_decide',input);if(result.error)throw result.error;return result.data;},
 });
}
