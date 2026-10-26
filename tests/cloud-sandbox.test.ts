import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APIError, Sandbox, type Session } from '@vercel/sandbox';
import { createEphemeralSandbox, stopEphemeralSession, SandboxLifecycleError, sandboxFailureDiagnostic } from '../lib/cloud/sandbox';

test('all processing sessions are ephemeral, bounded and never use implicit resume', async context => {
  const original = Sandbox.create;
  const expectedTimeout = { document: 600_000, probe: 60_000, synthetic: 90_000 } as const;
  let stopped = 0;
  let resumed = 0;
  const optionsSeen: Parameters<typeof Sandbox.create>[0][] = [];
  const deadlines: number[] = [];
  const timeout = AbortSignal.timeout;
  context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    deadlines.push(milliseconds);
    return timeout(milliseconds);
  });
  Sandbox.create = async options => {
    optionsSeen.push(options);
    // Model the provider default: omission of persistent means true.
    const persistent = options?.persistent ?? true;
    let active = true;
    const session = {
      sessionId: 'test-specific-session',
      runCommand: async () => {
        if (!active) throw Object.assign(new Error('stopped'), { response: { status: 410 } });
        return { exitCode: 0 };
      },
      stop: async ({ signal }: { signal: AbortSignal }) => {
        assert.equal(signal.aborted, false);
        active = false;
        stopped++;
        return { session: { status: 'stopped' }, ...(persistent ? { snapshot: { id: 'automatically-retained' } } : {}) };
      },
    };
    return {
      currentSession: () => session,
      // A regression to Sandbox.runCommand would re-create a VM here.
      runCommand: async () => { resumed++; return { exitCode: 0 }; },
    } as unknown as Awaited<ReturnType<typeof original>>;
  };
  try {
    for (const purpose of ['document', 'probe', 'synthetic'] as const) {
      const handle = await createEphemeralSandbox(purpose, 'manual-base');
      assert.equal((await handle.session.runCommand('true')).exitCode, 0);
      await handle.close();
      await handle.close(); // Idempotent ownership: no second stop/resume.
      await assert.rejects(handle.session.runCommand('true'), /stopped/);
      const options = optionsSeen.at(-1)!;
      assert.equal(options?.persistent, false);
      assert.equal(options?.snapshotExpiration, 86_400_000);
      assert.equal(options?.timeout, expectedTimeout[purpose]);
      assert.deepEqual(options?.resources, { vcpus: 1 });
      assert.equal(options?.networkPolicy, 'deny-all');
    }
    assert.equal(stopped, 3);
    assert.equal(resumed, 0);
    assert.deepEqual(deadlines, [60_000, 600_000, 60_000, 60_000, 60_000, 90_000]);
    assert.ok(60_000 + Math.max(...Object.values(expectedTimeout)) + 15_000 < 12 * 60_000);
  } finally { Sandbox.create = original; }
});

test('cleanup rejects snapshots, uncertain state and API errors without exposing provider messages', async () => {
  const values = [
    { session: { status: 'stopped' }, snapshot: { id: 'unexpected' } },
    { session: { status: 'stopping' } },
    new Error('secret-provider-response'),
  ];
  for (const value of values) {
    const session = { sessionId: 'test', stop: async () => { if (value instanceof Error) throw value; return value; } } as unknown as Session;
    await assert.rejects(stopEphemeralSession(session), error => {
      assert.ok(error instanceof SandboxLifecycleError);
      assert.equal(error.code, 'snapshot' in value ? 'SANDBOX_UNEXPECTED_SNAPSHOT' : 'SANDBOX_STOP_UNCONFIRMED');
      assert.doesNotMatch(error.message, /secret-provider-response/);
      return true;
    });
  }
});

test('cleanup has an independent 15-second deadline even if the API ignores cancellation', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let cleanupSignal: AbortSignal | undefined;
  const session = {
    sessionId: 'timeout-test',
    stop: ({ signal }: { signal: AbortSignal }) => { cleanupSignal = signal; return new Promise(() => {}); },
  } as unknown as Session;
  const closing = stopEphemeralSession(session);
  const rejected = assert.rejects(closing, /SANDBOX_STOP_UNCONFIRMED/);
  context.mock.timers.tick(15_000);
  await rejected;
  assert.equal(cleanupSignal?.aborted, true);
  context.mock.timers.reset();
});


test('sandbox diagnostics expose only a fixed phase, status and field vocabulary', async () => {
  const secret = 'secret-token-url-and-document-content';
  const error = new APIError(Response.json({}, {status:400}), {message:`snapshotExpiration is invalid: ${secret}`,json:{secret},text:secret});
  assert.deepEqual(sandboxFailureDiagnostic('create', error), {phase:'create',category:'api',status:400,fields:['snapshotExpiration']});
  const schema = new APIError(Response.json({}), {message:`Response JSON is not valid: currentSnapshotId ${secret}`});
  assert.deepEqual(sandboxFailureDiagnostic('create', schema), {phase:'create',category:'response_schema',status:200,fields:['currentSnapshotId']});
  await assert.rejects(stopEphemeralSession({sessionId:'synthetic',stop:async()=>{throw error;}}), caught => {
    assert.ok(caught instanceof SandboxLifecycleError);
    assert.deepEqual(caught.diagnostic, {phase:'stop',category:'api',status:400,fields:['snapshotExpiration']});
    assert.ok(!JSON.stringify(caught).includes(secret));
    return true;
  });
});


test('the real SDK sends ephemeral creation parameters accepted by the documented retention contract', async () => {
  const original = Sandbox.create;
  const session = {id:'sbx_fixture',memory:2048,vcpus:1,region:'iad1',timeout:90000,status:'running',requestedAt:1,createdAt:1,updatedAt:1,cwd:'/vercel'};
  const sandbox = {name:'fixture',persistent:false,createdAt:1,updatedAt:1,currentSessionId:session.id,status:'running'};
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname.endsWith('/v3/sandboxes')) {
      const body = JSON.parse(String(init?.body));
      // Official custom retention contract: one day minimum, or zero for no expiry.
      if (body.snapshotExpiration !== 0 && (!Number.isInteger(body.snapshotExpiration) || body.snapshotExpiration < 86_400_000)) {
        return Response.json({error:{code:'bad_request',message:'snapshotExpiration must be at least one day'}}, {status:400});
      }
      assert.equal(body.persistent, false);
      assert.equal(body.source.type, 'snapshot');
      assert.equal(body.resources.vcpus, 1);
      assert.deepEqual(body.networkPolicy, {mode:'deny-all'});
      return Response.json({session,sandbox,routes:[]});
    }
    assert.ok(url.pathname.endsWith('/v2/sandboxes/sessions/sbx_fixture/stop'));
    return Response.json({session:{...session,status:'stopped'},sandbox:{...sandbox,status:'stopped'}});
  };
  Sandbox.create = options => original.call(Sandbox, {...options,teamId:'synthetic-team',projectId:'synthetic-project',token:'synthetic-token',fetch:fakeFetch});
  try {
    const handle = await createEphemeralSandbox('synthetic', 'manual-base');
    await handle.close();
    assert.equal(calls.length, 2);
  } finally { Sandbox.create = original; }
});
