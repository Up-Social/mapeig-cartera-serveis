import { checkVercelAvailability } from "@/lib/cloud/vercel-availability";

export const maxDuration = 90;

export async function POST() {
  try {
    return Response.json({ result: await checkVercelAvailability() });
  } catch (error) {
    return Response.json(
      { error: availabilityMessage(error) },
      { status: 503 },
    );
  }
}

function availabilityMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "VERCEL_CHECK_QUOTA") return "Vercel encara no permet crear l’entorn de procés. El bloqueig es manté actiu.";
  if (code === "VERCEL_CHECK_CONFIGURATION") return "No s’ha pogut validar la configuració de Vercel. El bloqueig es manté actiu.";
  if (code === "VERCEL_CHECK_BUSY") return "Ja hi ha una comprovació en curs. Torna-ho a provar d’aquí a un moment.";
  if (code === "VERCEL_CHECK_UNEXPECTED_BLOCK") return "El procés està aturat per un altre motiu i no es pot desbloquejar des d’aquesta comprovació.";
  if (code === "VERCEL_CHECK_DISABLED") return "La comprovació de Vercel no està disponible en aquest entorn.";
  return "No s’ha pogut confirmar que Vercel estigui disponible. El bloqueig es manté actiu.";
}
