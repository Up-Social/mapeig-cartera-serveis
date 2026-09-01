import { reviewMatching } from "@/app/actions";
import { getSourceRecord } from "@/lib/records-page";
import { isUuid } from "@/lib/uuid";

const OUTCOMES = new Set(["select", "reject", "insufficient"]);

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

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.outcome !== "string" || !OUTCOMES.has(body.outcome)) {
      return Response.json({ error: "Decisió no vàlida." }, { status: 400 });
    }
    await reviewMatching({
      sourceRecordId: id,
      outcome: body.outcome as "select" | "reject" | "insufficient",
      candidateId:
        typeof body.candidateId === "string" ? body.candidateId : undefined,
      serviceCode:
        typeof body.serviceCode === "string" ? body.serviceCode : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    const record = await getSourceRecord(id);
    if (!record) {
      return Response.json(
        { error: "El registre no existeix." },
        { status: 404 },
      );
    }
    return Response.json({ record });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No s'ha pogut registrar la decisió.",
      },
      { status: 409 },
    );
  }
}
