import { setAutomaticOcrEnabled } from "@/lib/admin-settings";
import { publicErrorMessage } from "@/lib/public-error";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return Response.json({ error: "El valor d’OCR no és vàlid." }, { status: 400 });
    }
    return Response.json({ setting: await setAutomaticOcrEnabled(body.enabled) });
  } catch (error) {
    return Response.json(
      { error: publicErrorMessage(error, "No s’ha pogut desar la configuració d’OCR.") },
      { status: 409 },
    );
  }
}
