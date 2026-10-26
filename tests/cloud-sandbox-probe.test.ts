import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sandbox } from '@vercel/sandbox';
import type { SupabaseClient } from '@supabase/supabase-js';
import { probeVercelAvailability } from '../lib/cloud/sandbox-probe';

function database() {
  const events: string[] = [];
  const resource = { blocked_kind: 'vercel_quota' as string | null, owner: null as string | null, lease_until: null as string | null };
  const setting = { enabled: false, reason: 'administrative_pause' };
  const db = { from: (table: string) => {
    let update: Record<string, unknown> | undefined;
    const execute = () => {
      if (update) {
        if (table === 'cloud_resources') {
          if (update.blocked_kind === null) events.push('unblock');
          Object.assign(resource, update);
        } else Object.assign(setting, update);
      }
      return { data: table === 'cloud_resources' ? { ...resource, name: 'sandbox' } : { ...setting, updated_at: '2026-10-26T00:00:00Z' }, error: null };
    };
    const q = {
      select: () => q, eq: () => q, is: () => q,
      update: (value: Record<string, unknown>) => { update = value; return q; },
      upsert: (value: Record<string, unknown>) => { update = value; return q; },
      single: async () => execute(), maybeSingle: async () => execute(),
      then: (resolve: (value: ReturnType<typeof execute>) => void) => resolve(execute()),
    };
    return q;
  } } as unknown as SupabaseClient;
  return { db, events, resource, setting };
}

for (const cleanup of ['success', 'failed', 'snapshot'] as const) {
  test(`availability probe (${cleanup}) can only clear the quota after verified cleanup`, async () => {
    const fixture = database();
    const original = Sandbox.create;
    const env = { WORKER_EXECUTION_MODE: process.env.WORKER_EXECUTION_MODE, VERCEL_ENV: process.env.VERCEL_ENV, CLOUD_SANDBOX_SNAPSHOT: process.env.CLOUD_SANDBOX_SNAPSHOT };
    process.env.WORKER_EXECUTION_MODE = 'vercel_workflow';
    process.env.VERCEL_ENV = 'production';
    process.env.CLOUD_SANDBOX_SNAPSHOT = 'manual-base';
    Sandbox.create = async () => ({ currentSession: () => ({
      sessionId: 'probe-session',
      runCommand: async () => { fixture.events.push('command'); return { exitCode: 0 }; },
      stop: async () => {
        fixture.events.push('stop');
        if (cleanup === 'failed') throw new Error('provider details');
        return { session: { status: 'stopped' }, ...(cleanup === 'snapshot' ? { snapshot: { id: 'unexpected' } } : {}) };
      },
    }) }) as unknown as Awaited<ReturnType<typeof original>>;
    try {
      if (cleanup === 'success') {
        assert.deepEqual(await probeVercelAvailability(fixture.db, { force: true }), { status: 'available' });
        assert.deepEqual(fixture.events, ['command', 'stop', 'unblock']);
        assert.equal(fixture.resource.blocked_kind, null);
        assert.equal(fixture.resource.owner, null);
      } else {
        await assert.rejects(probeVercelAvailability(fixture.db, { force: true }), /VERCEL_CHECK_UNAVAILABLE/);
        assert.equal(fixture.events.includes('unblock'), false);
        assert.equal(fixture.resource.blocked_kind, 'internal');
        assert.ok(fixture.resource.owner);
        assert.match(fixture.setting.reason, /SANDBOX_/);
      }
      // Checking infrastructure never resumes workloads.
      assert.equal(fixture.setting.enabled, false);
    } finally {
      Sandbox.create = original;
      for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
}

test('an active resource lease prevents even an explicit recovery probe', async () => {
  const fixture = database();
  fixture.resource.lease_until = new Date(Date.now() + 60_000).toISOString();
  await assert.rejects(probeVercelAvailability(fixture.db, { force: true }), /VERCEL_CHECK_BUSY/);
  assert.deepEqual(fixture.events, []);
});

test('a same-owner lease renewal between read and claim cannot be stolen by a probe', async () => {
  const oldLease = new Date(Date.now() - 1000).toISOString();
  const resource = { name: 'sandbox', owner: 'existing-owner', lease_until: oldLease, blocked_kind: 'vercel_quota' };
  let writes = 0;
  const db = { from: () => {
    let update: Record<string, unknown> | undefined;
    const predicates: Array<[string, unknown]> = [];
    const q = {
      select: () => q,
      eq: (key: string, value: unknown) => { predicates.push([key, value]); return q; },
      is: (key: string, value: unknown) => { predicates.push([key, value]); return q; },
      single: async () => {
        const observed = { ...resource };
        resource.lease_until = new Date(Date.now() + 60_000).toISOString();
        return { data: observed, error: null };
      },
      update: (value: Record<string, unknown>) => { update = value; return q; },
      maybeSingle: async () => {
        const matches = predicates.every(([key, value]) => resource[key as keyof typeof resource] === value);
        if (matches) { writes++; Object.assign(resource, update); }
        return { data: matches ? { name: 'sandbox' } : null, error: null };
      },
    };
    return q;
  } } as unknown as SupabaseClient;
  await assert.rejects(probeVercelAvailability(db, { force: true }), /VERCEL_CHECK_BUSY/);
  assert.equal(writes, 0);
  assert.equal(resource.owner, 'existing-owner');
});
