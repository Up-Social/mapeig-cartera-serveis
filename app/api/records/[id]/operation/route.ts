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

  let operation: RecordOperation;
  let expectedJobId:string|undefined;
  try {
    const body = (await request.json()) as { operation?: unknown;expectedJobId?:unknown };
    if(body.expectedJobId!==undefined){if(typeof body.expectedJobId!=='string'||!isUuid(body.expectedJobId))throw Error('Invalid job');expectedJobId=body.expectedJobId;}
    if (
      typeof body.operation !== "string" ||
      !OPERATIONS.has(body.operation as RecordOperation)
    ) {
      return Response.json({ error: "Operació no vàlida." }, { status: 400 });
    }
    operation = body.operation as RecordOperation;
  } catch {
    return Response.json({ error: "Cos JSON no vàlid." }, { status: 400 });
  }

  try {
    const result = operation === "ocr"
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
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No s'ha pogut iniciar l'operació.",
      },
      { status: 409 },
    );
  }
}
