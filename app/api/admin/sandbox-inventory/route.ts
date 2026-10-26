import {readSandboxInventory, inspectSandboxInventory, SandboxInventoryError} from '@/lib/cloud/sandbox-inventory';

export const maxDuration = 60;

/** Authenticated operational export. Lists metadata only; never creates or deletes resources. */
export async function GET() {
  try {
    const inventory = await readSandboxInventory();
    const baseSnapshotId = process.env.CLOUD_SANDBOX_SNAPSHOT;
    return Response.json({
      ...inventory, baseSnapshotId,
      assessment: inspectSandboxInventory(inventory, baseSnapshotId),
    }, {headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="sandbox-inventory.json"',
    }});
  } catch (error) {
    return Response.json({
      error: 'No s’ha pogut completar l’inventari de Vercel.',
      diagnostic: error instanceof SandboxInventoryError ? error.diagnostic : undefined,
    }, {status: 503, headers: {'Cache-Control':'no-store'}});
  }
}
