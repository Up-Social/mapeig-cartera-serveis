import {startConcertReprocess,ConcertReprocessError} from '@/lib/start-concert-reprocess';
import {validateOcrRecovery,type OcrRecovery} from '@/lib/ocr-recovery';
import {
  enrichRecordFromSources,
  matchPreparedRecord,
  processRecordAutomatically,
  prepareRecordSources,
  recoverRecordWithOcr,
} from "@/app/actions";
import type { RecordOperation } from "@/lib/record-operation";
import { isUuid } from "@/lib/uuid";
import {startRecordOperation} from '@/lib/start-record-operation';
import {publicErrorMessage} from '@/lib/public-error';

const OPERATIONS = new Set<RecordOperation>(["prepare", "enrich", "match", "process", "ocr"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return Response.json(
      { error: "Identificador de registre no vàlid." },
      { status: 400 },
    );
  }

  let recovery:OcrRecovery|undefined;
  let operation: RecordOperation;
  let expectedJobId:string|undefined;
  let concertRefresh=false;
  try {
    const body = (await request.json()) as { operation?: unknown;expectedJobId?:unknown;ocrRecovery?:unknown;concertRefresh?:unknown };
    if(body.concertRefresh!==undefined&&typeof body.concertRefresh!=='boolean')throw Error('Invalid refresh');
    concertRefresh=body.concertRefresh===true;
    if(concertRefresh&&(body.operation!=='process'||body.ocrRecovery!==undefined||!('expectedJobId' in body)))throw Error('Invalid refresh');
    if(body.expectedJobId!==undefined&&!(concertRefresh&&body.expectedJobId===null)){if(typeof body.expectedJobId!=='string'||!isUuid(body.expectedJobId))throw Error('Invalid job');expectedJobId=body.expectedJobId;}
    if (
      typeof body.operation !== "string" ||
      !OPERATIONS.has(body.operation as RecordOperation)
    ) {
      return Response.json({ error: "Operació no vàlida." }, { status: 400 });
    }
    operation = body.operation as RecordOperation;
    if(body.ocrRecovery!==undefined){if(operation!=='ocr')throw Error();recovery=validateOcrRecovery(body.ocrRecovery);}
  } catch {
    return Response.json({ error: "Cos JSON no vàlid." }, { status: 400 });
  }

  try {
    const result = concertRefresh ? await startConcertReprocess(id,expectedJobId??null) : recovery ? await startRecordOperation(id,operation,expectedJobId,recovery) : operation === "ocr"
      ? await (expectedJobId?startRecordOperation(id,operation,expectedJobId):recoverRecordWithOcr(id))
      : expectedJobId ? await startRecordOperation(id,operation,expectedJobId)
      : operation === "process"
      ? await processRecordAutomatically(id)
      : operation === "prepare"
        ? await prepareRecordSources(id)
        : operation === "enrich"
          ? await enrichRecordFromSources(id)
          : await matchPreparedRecord(id);
    return Response.json({ ok: true, result });
  } catch (error) {
    if(error instanceof ConcertReprocessError)return Response.json({ok:false,error:error.message,code:error.code,...(!['CONCERT_START_UNCERTAIN','CONCERT_DISPATCH_PENDING'].includes(error.code)?{outcome:'not_started'}:{}),...(error.result?{result:error.result}:{})},{status:409});
    const activeTask=error instanceof Error&&error.message==='ACTIVE_TASK';
    return Response.json(
      {
        error: publicErrorMessage(error, "No s'ha pogut iniciar l'operació."),
        ...(activeTask?{code:'ACTIVE_TASK'}:{}),
      },
      { status: 409 },
    );
  }
}
