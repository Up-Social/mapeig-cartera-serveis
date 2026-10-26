import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { containSandboxIncident } from '../lib/cloud/sandbox-incident';

for (const failedTable of ['app_settings', 'cloud_resources', 'cloud_resources_zero_rows', 'none']) {
  test(`containment attempts both safeguards when ${failedTable} fails`, async () => {
    const attempted: string[] = [];
    const writes: Array<{ table: string; value: Record<string, unknown> }> = [];
    const db = { from: (table: string) => {
      const result = () => {
        attempted.push(table);
        return table === failedTable
          ? { data: null, error: { message: 'database unavailable' } }
          : table === 'cloud_resources' && failedTable === 'cloud_resources_zero_rows' ? { data: null, error: null }
          : { data: { enabled: false, reason: 'SANDBOX_STOP_UNCONFIRMED', updated_at: '2026-10-26T00:00:00Z' }, error: null };
      };
      const write = (value: Record<string, unknown>) => { writes.push({ table, value }); return q; };
      const q = { select: () => q, eq: () => q, update: write, upsert: write, single: async () => result(), maybeSingle: async () => result(), then: (resolve: (value: ReturnType<typeof result>) => void) => resolve(result()) };
      return q;
    } } as unknown as SupabaseClient;
    if (failedTable === 'none') await containSandboxIncident(db, 'owner', 'SANDBOX_STOP_UNCONFIRMED');
    else await assert.rejects(containSandboxIncident(db, 'owner', 'SANDBOX_STOP_UNCONFIRMED'), /SANDBOX_CONTAINMENT_FAILED/);
    assert.deepEqual(attempted.sort(), ['app_settings', 'cloud_resources']);
    assert.equal(writes.find(write => write.table === 'app_settings')?.value.enabled, false);
    assert.deepEqual(writes.find(write => write.table === 'cloud_resources')?.value, { blocked_kind: 'internal' });
  });
}
