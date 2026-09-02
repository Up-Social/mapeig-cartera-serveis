import { getBatch } from "@/lib/batches";
import { isUuid } from "@/lib/uuid";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!isUuid(id))
    return Response.json({ error: "Identificador de lot no vàlid." }, { status: 400 });
  const batch = await getBatch(id);
  if (!batch)
    return Response.json({ error: "Lot no trobat." }, { status: 404 });
  return Response.json(
    { batch },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
