import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APIError, Sandbox } from '@vercel/sandbox';
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

for (const outcome of ['success', 'ocr-failed', 'timeout', 'cleanup-failed', 'snapshot'] as const) {
  test(`document validation probe (${outcome}) closes before it can clear the block`, async () => {
    const fixture = database();
    const original = Sandbox.create;
    const env = { WORKER_EXECUTION_MODE: process.env.WORKER_EXECUTION_MODE, VERCEL_ENV: process.env.VERCEL_ENV, CLOUD_SANDBOX_SNAPSHOT: process.env.CLOUD_SANDBOX_SNAPSHOT };
    Object.assign(process.env, { WORKER_EXECUTION_MODE: 'vercel_workflow', VERCEL_ENV: 'production', CLOUD_SANDBOX_SNAPSHOT: 'manual-base' });
    const text = 'Servei social per a persones. Servicio social para personas.';
    Sandbox.create = async options => {
      assert.equal(options?.timeout, 90_000);
      assert.equal(options?.persistent, false);
      return { currentSession: () => ({
        sessionId: 'document-probe-session',
        writeFiles: async () => {},
        readFileToBuffer: async ({ path }: { path: string }) => {
          if (path.endsWith('.jpg')) return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
          if (path.endsWith('languages.txt')) return Buffer.from('cat\nspa\n');
          if (path.endsWith('scanned.txt')) return Buffer.from('\f');
          if (outcome === 'ocr-failed' && path.endsWith('ocr.txt')) return Buffer.from('');
          return Buffer.from(text);
        },
        runCommand: async (command: string) => {
          fixture.events.push(command);
          if (outcome === 'timeout') throw new DOMException('The operation was aborted', 'TimeoutError');
          return { exitCode: 0 };
        },
        stop: async () => {
          fixture.events.push('stop');
          if (outcome === 'cleanup-failed') throw new Error('provider details');
          return { session: { status: 'stopped' }, ...(outcome === 'snapshot' ? { snapshot: { id: 'unexpected' } } : {}) };
        },
      }) } as unknown as Awaited<ReturnType<typeof original>>;
    };
    try {
      if (outcome === 'success') {
        assert.deepEqual(await probeVercelAvailability(fixture.db, { force: true, checkDocuments: true }), { status: 'available' });
        assert.ok(fixture.events.includes('tesseract'));
        assert.deepEqual(fixture.events.slice(-2), ['stop', 'unblock']);
      } else {
        await assert.rejects(probeVercelAvailability(fixture.db, { force: true, checkDocuments: true }), /VERCEL_CHECK_UNAVAILABLE/);
        assert.ok(fixture.events.includes('stop'));
        assert.equal(fixture.events.includes('unblock'), false);
        assert.equal(fixture.resource.blocked_kind, ['cleanup-failed', 'snapshot'].includes(outcome) ? 'internal' : 'vercel_quota');
      }
      assert.equal(fixture.setting.enabled, false);
    } finally {
      Sandbox.create = original;
      for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
}


for (const kind of [400, 401, 402, 403, 429, 200, 500, 'network', 'untrusted-400'] as const) {
  test(`creation failure ${kind} preserves containment regardless of the last HTTP response`, async context => {
    const fixture = database();
    const env = { WORKER_EXECUTION_MODE: process.env.WORKER_EXECUTION_MODE, VERCEL_ENV: process.env.VERCEL_ENV, CLOUD_SANDBOX_SNAPSHOT: process.env.CLOUD_SANDBOX_SNAPSHOT };
    Object.assign(process.env, { WORKER_EXECUTION_MODE: 'vercel_workflow', VERCEL_ENV: 'production', CLOUD_SANDBOX_SNAPSHOT: 'manual-base' });
    const secret = 'secret-provider-content';
    const status = typeof kind === 'number' ? kind : 500;
    const error = kind === 'network' ? new TypeError('fetch failed') : kind === 'untrusted-400' ? Object.assign(new Error(secret), {response:{status:400}}) : new APIError(Response.json({}, {status}), {message:`snapshotExpiration ${secret}`, json:{secret}, text:secret});
    const logs: unknown[][] = [];
    context.mock.method(console, 'error', (...args: unknown[]) => { logs.push(args); });
    context.mock.method(Sandbox, 'create', async () => { throw error; });
    try {
      const expected = kind === 402 ? /VERCEL_CHECK_QUOTA/ : [400, 401, 403].includes(Number(kind)) ? /VERCEL_CHECK_CONFIGURATION/ : /VERCEL_CHECK_UNAVAILABLE/;
      await assert.rejects(probeVercelAvailability(fixture.db, {force:true,checkDocuments:true}), expected);
      assert.equal(fixture.setting.enabled, false);
      assert.equal(fixture.events.includes('unblock'), false);
      assert.equal(fixture.resource.blocked_kind, 'internal');
      assert.ok(fixture.resource.owner);
      assert.ok(new Date(fixture.resource.lease_until!).getTime() > Date.now());
      assert.equal(fixture.setting.reason, 'SANDBOX_CREATION_UNCONFIRMED');
      assert.equal((logs[0]?.[1] as {phase:string}).phase, 'create');
      assert.ok(!JSON.stringify(logs).includes(secret));
    } finally {
      for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
}

for (const firstFailure of ['network', 'server-500'] as const) {
  test(`real SDK creation retry ${firstFailure} then HTTP 400 retains the lease`, async context => {
    const fixture = database();
    const original = Sandbox.create;
    const env = { WORKER_EXECUTION_MODE: process.env.WORKER_EXECUTION_MODE, VERCEL_ENV: process.env.VERCEL_ENV, CLOUD_SANDBOX_SNAPSHOT: process.env.CLOUD_SANDBOX_SNAPSHOT };
    Object.assign(process.env, { WORKER_EXECUTION_MODE:'vercel_workflow', VERCEL_ENV:'production', CLOUD_SANDBOX_SNAPSHOT:'manual-base' });
    let attempts = 0;
    const fakeFetch: typeof fetch = async (input, options) => {
      assert.ok(new URL(String(input)).pathname.endsWith('/v3/sandboxes'));
      assert.equal(options?.method, 'POST');
      attempts++;
      if (attempts === 1) {
        // A VM may exist even though its creation response was lost or failed.
        if (firstFailure === 'network') throw new TypeError('fetch failed');
        return Response.json({error:{message:'synthetic lost response'}}, {status:500});
      }
      return Response.json({error:{message:'snapshotExpiration synthetic rejection'}}, {status:400});
    };
    context.mock.method(Sandbox, 'create', (options: Parameters<typeof Sandbox.create>[0]) => original.call(Sandbox, {...options,teamId:'synthetic-team',projectId:'synthetic-project',token:'synthetic-token',fetch:fakeFetch}));
    const logs: unknown[][] = [];
    context.mock.method(console, 'error', (...args: unknown[]) => {logs.push(args);});
    try {
      await assert.rejects(probeVercelAvailability(fixture.db, {force:true}), /VERCEL_CHECK_CONFIGURATION/);
      assert.equal(attempts, 2);
      assert.equal(fixture.events.includes('unblock'), false);
      assert.equal(fixture.setting.enabled, false);
      assert.equal(fixture.setting.reason, 'SANDBOX_CREATION_UNCONFIRMED');
      assert.equal(fixture.resource.blocked_kind, 'internal');
      assert.ok(fixture.resource.owner);
      assert.ok(new Date(fixture.resource.lease_until!).getTime() > Date.now());
      assert.deepEqual(logs[0]?.[1], {phase:'create',category:'api',status:400,fields:['snapshotExpiration']});
    } finally {
      for (const [key, value] of Object.entries(env)) {if (value === undefined) delete process.env[key]; else process.env[key] = value;}
    }
  });
}
