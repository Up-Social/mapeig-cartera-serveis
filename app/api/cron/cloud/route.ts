import {cloudDb} from '@/lib/cloud/context';
import {launchCloudTask} from '@/lib/cloud/launch';
import {safeEqual} from '@/lib/access-auth';
import {executionMode} from '@/lib/pipeline/execution-mode';
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET;
 if(!secret||!safeEqual(request.headers.get('authorization')??'',`Bearer ${secret}`))return new Response(null,{status:401});
 if(executionMode()!=='vercel_workflow')return Response.json({enabled:false});
 const db=cloudDb();
 const r=await db.from('worker_tasks').select('id').eq('executor','vercel_workflow').or(`execution_state.eq.pending,and(execution_state.eq.running,lease_until.lt.${new Date().toISOString()})`).order('created_at').limit(100);
 if(r.error)return Response.json({error:'QUEUE_UNAVAILABLE'},{status:503});
 for(const t of r.data)await launchCloudTask(t.id);
 return Response.json({checked:r.data.length});
}
