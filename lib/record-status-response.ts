import { isUuid } from "./uuid";

export async function createRecordStatusResponse<T>(
  id: string,
  loadRecord: (id: string) => Promise<T | null>,
) {
  if (!isUuid(id)) {
    return Response.json(
      { error: "Identificador de registre no vàlid." },
      { status: 400 },
    );
  }

  try {
    const record = await loadRecord(id);
    if (!record) {
      return Response.json(
        { error: "El registre no existeix." },
        { status: 404 },
      );
    }
    return Response.json(
      { record },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No s'ha pogut consultar el registre.",
      },
      { status: 500 },
    );
  }
}
