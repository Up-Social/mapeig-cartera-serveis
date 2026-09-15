import {reclassifyHistory} from '@/lib/cloud/enqueue';
import {executionMode} from '@/lib/pipeline/execution-mode';
import {cloudDb,rpc} from '@/lib/cloud/context';
import {launchCloudTask} from '@/lib/cloud/launch';
import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';
import {
  createGuidedBatch,
  createAutomatedBatch,
  generateBalancedSample,
  replaceFailedBatchJob,
  replaceSampleRecord,
  startBatchMatching,
  startBatchPreparation,
} from "@/app/batches/actions";
import type { FinancingType } from "@/lib/financing-types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    let result: unknown;
    switch (body.operation) {
      case "reclassify_history": {
        if(executionMode()!=='vercel_workflow')throw Error('Disponible només amb execució remota de producció.');
        result=await reclassifyHistory();break;
      }
      case "resume": {
        if(typeof body.batchId!=='string'||!isUuid(body.batchId))throw Error('Identificador no vàlid');
        if(executionMode()==='vercel_workflow'){const task=await rpc<string>(cloudDb(),'cloud_resume',{p_run:body.batchId});await launchCloudTask(task);result={id:body.batchId};break;}
        const resumed=await createServerSupabase().rpc('resume_analysis_run',{p_run:body.batchId});if(resumed.error)throw resumed.error;result={id:body.batchId};break;
      }
      case "create_and_process":
        result = await createAutomatedBatch(Number(body.size));
        break;
      case "generate_sample":
        result = await generateBalancedSample(stringArray(body.excludedIds));
        break;
      case "replace_sample":
        result = await replaceSampleRecord(
          String(body.financingType) as FinancingType,
          stringArray(body.excludedIds),
        );
        break;
      case "create_batch":
        result = await createGuidedBatch(stringArray(body.recordIds));
        break;
      case "prepare_batch":
        result = await startBatchPreparation(String(body.batchId));
        break;
      case "match_batch":
        result = await startBatchMatching(String(body.batchId));
        break;
      case "replace_failed_job":
        result = await replaceFailedBatchJob(
          String(body.batchId),
          String(body.jobId),
        );
        break;
      default:
        return Response.json({ error: "Operació no vàlida." }, { status: 400 });
    }
    return Response.json({ result });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No s'ha pogut completar l'operació.",
      },
      { status: 409 },
    );
  }
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
