import { Sandbox, Snapshot } from '@vercel/sandbox';
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

/** Full pagination, bounded by time. Partial/error results must never certify safety. */
export async function readSandboxInventory(): Promise<SandboxInventory> {
  const signal = AbortSignal.timeout(45_000);
  const [snapshotPages, sandboxPages] = await Promise.all([
    Snapshot.list({limit: 100, signal}), Sandbox.list({limit: 100, signal}),
  ]);
  const [snapshots, sandboxes] = await Promise.all([snapshotPages.toArray(), sandboxPages.toArray()]);
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
