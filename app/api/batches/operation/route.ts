import {reclassifyHistory} from '@/lib/cloud/enqueue';
import {executionMode} from '@/lib/pipeline/execution-mode';
import {cloudDb,rpc} from '@/lib/cloud/context';
import {launchCloudTask} from '@/lib/cloud/launch';
import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';
import {createAutomatedBatch} from "@/app/batches/actions";
import { publicErrorMessage } from "@/lib/public-error";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    let result: unknown;
    switch (body.operation) {
      case "reclassify_history": {
        if(executionMode()!=='vercel_workflow')throw Error('Disponible només amb execució remota de producció.');
        result=await reclassifyHistory();break;
      }
      case "retry_validation": {
        if(executionMode()!=='vercel_workflow'||typeof body.batchId!=='string'||!isUuid(body.batchId))throw Error('Operació no vàlida.');
        const task=await rpc<string>(cloudDb(),'cloud_retry_validation',{p_run:body.batchId,p_revision:'validation-v2'});
        const current=await cloudDb().from('worker_tasks').select('dispatch_at').eq('id',task).single();
        if(current.error)throw Error('No s’ha pogut consultar la recuperació.');
        if(!current.data.dispatch_at)await launchCloudTask(task);result={id:body.batchId};break;
      }
      case "resume": {
        if(typeof body.batchId!=='string'||!isUuid(body.batchId))throw Error('Identificador no vàlid');
        if(executionMode()==='vercel_workflow'){const task=await rpc<string>(cloudDb(),'cloud_resume',{p_run:body.batchId});await launchCloudTask(task);result={id:body.batchId};break;}
        const resumed=await createServerSupabase().rpc('resume_analysis_run',{p_run:body.batchId});if(resumed.error)throw resumed.error;result={id:body.batchId};break;
      }
      case "create_and_process":
        result = await createAutomatedBatch(Number(body.size));
        break;
      default:
        return Response.json({ error: "Operació no vàlida." }, { status: 400 });
    }
    return Response.json({ result });
  } catch (error) {
    return Response.json(
      {
        error: publicErrorMessage(error),
      },
      { status: 409 },
    );
  }
}
