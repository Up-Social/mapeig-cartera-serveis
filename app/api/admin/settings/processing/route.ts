import {createServerSupabase} from '@/lib/records-page';
import {getProcessingSetting} from '@/lib/processing-control';
import {configureProcessing} from '@/lib/processing-activation';
import {auditSandboxInventory} from '@/lib/cloud/sandbox-inventory';
import {checkVercelAvailability} from '@/lib/cloud/vercel-availability';

export const maxDuration = 300;

export async function GET() {
  return Response.json({setting: await getProcessingSetting(createServerSupabase())});
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({error: 'El valor de processament no és vàlid.'}, {status: 400});
  }
  if (!body || typeof body !== 'object' || !('enabled' in body) || typeof body.enabled !== 'boolean') {
    return Response.json({error: 'El valor de processament no és vàlid.'}, {status: 400});
  }
  const db = createServerSupabase();
  try {
    const setting = await configureProcessing(db, body.enabled, {
      audit: () => auditSandboxInventory(db),
      probe: () => checkVercelAvailability({force: true}),
    });
    return Response.json({setting});
  } catch {
    return Response.json({
      setting: await getProcessingSetting(db),
      error: 'No s’ha pogut canviar el processament. Revisa la incidència, l’inventari de Vercel i la connexió abans de tornar-ho a provar.',
    }, {status: 409});
  }
}
