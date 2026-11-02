import { reviewMatching } from "@/app/actions";
import { getSourceRecord } from "@/lib/records-page";
import { isUuid } from "@/lib/uuid";

const OUTCOMES = new Set(["select", "reject", "insufficient", "outside"]);

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
      expectedJobId: typeof body.expectedJobId === 'string' && isUuid(body.expectedJobId) ? body.expectedJobId : '00000000-0000-4000-8000-000000000000',
      reasons: Array.isArray(body.reasons) ? body.reasons.filter((r):r is string=>typeof r==='string') : [],
      sourceRecordId: id,
      outcome: body.outcome as "select" | "reject" | "insufficient" | "outside",
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
    if(error&&typeof error==='object'&&'message' in error&&error.message==='DIAGNOSTIC_REVIEW_INDIVIDUAL_REQUIRED')return Response.json({error:'Aquest concert té diverses línies documentals. Revisa i aprova cada línia individualment; no s’ha registrat cap aprovació global.'},{status:409});
    if(error&&typeof error==='object'&&'code' in error&&error.code==='55P03')return Response.json({error:'Una altra operació està modificant aquest expedient. No s’ha desat la revisió; torna-ho a provar.'},{status:409});
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
