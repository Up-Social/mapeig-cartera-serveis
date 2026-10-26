import type { SupabaseClient } from '@supabase/supabase-js';
import { disableProcessing } from '../processing-control';

/** Neither protective write depends on the other succeeding. Keep the lease. */
export async function containSandboxIncident(db: SupabaseClient, owner: string, reason: string): Promise<void> {
  const results = await Promise.allSettled([
    disableProcessing(db, reason),
    (async () => {
      const result = await db.from('cloud_resources').update({ blocked_kind: 'internal' }).eq('name', 'sandbox').eq('owner', owner).select('name').maybeSingle();
      if (result.error || !result.data) throw new Error('SANDBOX_RESOURCE_BLOCK_FAILED');
    })(),
  ]);
  if (results.some(result => result.status === 'rejected')) throw new Error('SANDBOX_CONTAINMENT_FAILED');
}
