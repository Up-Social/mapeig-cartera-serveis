import { APIError, Sandbox, Snapshot } from '@vercel/sandbox';
import type { SupabaseClient } from '@supabase/supabase-js';
import { disableProcessing } from '../processing-control';

export type SnapshotEntry = {
  id: string; sourceSessionId: string; status: string; sizeBytes: number;
  createdAt: number; expiresAt?: number; lastUsedAt?: number;
  creationMethod?: string; parentId?: string;
};
export type SandboxEntry = {
  name: string; persistent: boolean; status: string; currentSessionId: string;
  currentSnapshotId?: string; createdAt: number;
};
export type SandboxInventory = {
  capturedAt: string; snapshots: SnapshotEntry[]; sandboxes: SandboxEntry[];
};

type InventoryDiagnostic = {
  phase: 'snapshots' | 'sandboxes';
  category: 'credentials' | 'api' | 'response_schema' | 'timeout' | 'network' | 'unknown';
  status?: number;
  fields?: string[];
};
export class SandboxInventoryError extends Error {
  constructor(public diagnostic: InventoryDiagnostic) { super('SANDBOX_INVENTORY_UNAVAILABLE'); }
}

/** Never publish provider messages, response bodies, URLs, headers or credentials. */
function inventoryDiagnostic(phase: InventoryDiagnostic['phase'], error: unknown): InventoryDiagnostic {
  if (error instanceof APIError) {
    const status = error.response.status;
    if (status >= 200 && status < 300) {
      const fields: string[] = [];
      const allowed = new Set(['snapshots','sandboxes','pagination','count','next','id','name','sourceSessionId','status','sizeBytes','createdAt','updatedAt','expiresAt','lastUsedAt','creationMethod','parentId','region','persistent','currentSessionId','currentSnapshotId']);
      const prefix = 'Response JSON is not valid: ';
      if (error.message.startsWith(prefix)) {
        try {
          const issues: unknown = JSON.parse(error.message.slice(prefix.length));
          if (Array.isArray(issues)) for (const issue of issues.slice(0, 20)) {
            if (Array.isArray(issue?.path)) fields.push(issue.path.slice(0,10).map((part: unknown) => typeof part === 'number' ? '*' : typeof part === 'string' && allowed.has(part) ? part : '?').join('.'));
          }
        } catch { /* The fixed category is sufficient for non-JSON validation failures. */ }
      }
      return {phase, category:'response_schema', status, fields:[...new Set(fields)]};
    }
    return {phase, category:'api', status};
  }
  const name = error instanceof Error ? error.name : '';
  if (['LocalOidcContextError','VercelOidcContextError'].includes(name)) return {phase, category:'credentials'};
  if (['AbortError','TimeoutError'].includes(name)) return {phase, category:'timeout'};
  if (name === 'TypeError' && error instanceof Error && error.message === 'fetch failed') return {phase, category:'network'};
  return {phase, category:'unknown'};
}

async function inventoryCollection<T>(phase: InventoryDiagnostic['phase'], read: () => Promise<T>): Promise<T> {
  try { return await read(); }
  catch (error) {
    const diagnostic = inventoryDiagnostic(phase, error);
    console.error('SANDBOX_INVENTORY_UNAVAILABLE', diagnostic);
    throw new SandboxInventoryError(diagnostic);
  }
}

/** Full pagination, bounded by time. Partial/error results must never certify safety. */
export async function readSandboxInventory(): Promise<SandboxInventory> {
  const signal = AbortSignal.timeout(45_000);
  const [snapshots, sandboxes] = await Promise.all([
    inventoryCollection('snapshots', async () => (await Snapshot.list({limit: 100, signal})).toArray()),
    inventoryCollection('sandboxes', async () => (await Sandbox.list({limit: 100, signal})).toArray()),
  ]);
  return {capturedAt: new Date().toISOString(), snapshots, sandboxes};
}

export function inspectSandboxInventory(inventory: SandboxInventory, baseSnapshotId: string | undefined) {
  const retained = inventory.snapshots.filter(s => s.status !== 'deleted');
  const automatic = retained.filter(s => s.creationMethod === 'automatic');
  const unknown = retained.filter(s => !['automatic', 'manual'].includes(s.creationMethod ?? ''));
  const active = inventory.sandboxes.filter(s => !['stopped', 'failed', 'aborted'].includes(s.status));
  const base = retained.find(s => s.id === baseSnapshotId);
  const baseReady = Boolean(base && base.status === 'created' && base.creationMethod === 'manual' &&
    (!base.expiresAt || base.expiresAt > Date.now()));
  return {
    healthy: baseReady && automatic.length === 0 && unknown.length === 0 && active.every(s => !s.persistent),
    baseReady, snapshotCount: retained.length, automaticCount: automatic.length,
    unknownCount: unknown.length, activeCount: active.length,
    bytes: retained.reduce((sum, s) => sum + s.sizeBytes, 0), capturedAt: inventory.capturedAt,
  };
}

/** Observe only; deletions require a separately reviewed, explicit manifest. */
export async function auditSandboxInventory(db: SupabaseClient) {
  try {
    const result = inspectSandboxInventory(await readSandboxInventory(), process.env.CLOUD_SANDBOX_SNAPSHOT);
    if (!result.healthy) await disableProcessing(db, 'sandbox_inventory_unsafe');
    return result;
  } catch {
    await disableProcessing(db, 'sandbox_inventory_unavailable');
    throw new Error('SANDBOX_INVENTORY_UNAVAILABLE');
  }
}
