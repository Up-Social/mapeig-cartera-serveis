import {
  enrichRecordFromSources,
  matchPreparedRecord,
  prepareRecordSources,
} from "@/app/actions";
import type { RecordOperation } from "@/lib/record-operation";
import { isUuid } from "@/lib/uuid";

const OPERATIONS = new Set<RecordOperation>(["prepare", "enrich", "match"]);

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
  try {
    const body = (await request.json()) as { operation?: unknown };
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
    const result =
      operation === "prepare"
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
