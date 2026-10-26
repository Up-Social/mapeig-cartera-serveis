import type { SupabaseClient } from '@supabase/supabase-js';
import {getProcessingSetting, setProcessingEnabled} from './processing-control';

type Checks = {audit: () => Promise<{healthy: boolean; activeCount: number}>; probe: () => Promise<unknown>};

/** No task resumes here. A concurrent pause during verification invalidates activation. */
export async function configureProcessing(db: SupabaseClient, enabled: boolean, checks: Checks) {
  if (!enabled) return setProcessingEnabled(db, false, 'operator_pause');
  const previous = await getProcessingSetting(db);
  if (!previous.updatedAt) throw new Error('PROCESSING_CONTROL_UNAVAILABLE');
  if (previous.enabled) return previous;
  const before = await checks.audit();
  if (!before.healthy || before.activeCount !== 0) throw new Error('PROCESSING_INVENTORY_UNSAFE');
  await checks.probe();
  const after = await checks.audit();
  if (!after.healthy || after.activeCount !== 0) throw new Error('PROCESSING_INVENTORY_UNSAFE');
  return setProcessingEnabled(db, true, null, previous.updatedAt);
}
