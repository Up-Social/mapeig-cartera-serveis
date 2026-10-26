import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sandbox } from '@vercel/sandbox';
import { extractDocument } from '../lib/cloud/documents';
import { CloudFailure } from '../lib/cloud/errors';
import type { Context } from '../lib/cloud/context';
import { sha256 } from '../lib/source-storage';
import { EXTRACTION_VERSION } from '../lib/pipeline/readable-document';

function database() {
  const bytes = Buffer.from('%PDF-synthetic');
  const digest = sha256(bytes);
  const path = `cases/record/documents/doc/${digest}.pdf`;
  const checkpoints = new Map<string, unknown>();
  const releases: unknown[] = [];
  const state = { enabled: true, reason: null as string | null, blocked_kind: null as string | null };
  const db = {
    storage: { from: () => ({
      list: async () => ({ data: [{ name: `${digest}.pdf` }], error: null }),
      download: async () => ({ data: new Blob([bytes]), error: null }),
    }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'cloud_checkpoint') checkpoints.set(String(args.p_key), args.p_value);
      if (name === 'cloud_resource' && args.p_release) releases.push(args);
      return { data: true, error: null };
    },
    from: (table: string) => {
      let key = '';
      const row = () => table === 'app_settings'
        ? { enabled: state.enabled, reason: state.reason, updated_at: '2026-10-26T00:00:00Z' }
        : table === 'source_documents'
          ? { id: 'doc', source_record_id: 'record', url: 'https://unused.invalid', storage_path: path, storage_sha256: digest, mime_type: 'application/pdf' }
          : table === 'cloud_resources' ? { name: 'sandbox' }
          : table === 'cloud_checkpoints' && checkpoints.has(key) ? { value: checkpoints.get(key) } : null;
      const q = {
        select: () => q,
        eq: (name: string, value: string) => { if (name === 'item_key') key = value; return q; },
        update: (value: Partial<typeof state>) => { Object.assign(state, value); return q; },
        upsert: (value: Partial<typeof state>) => { Object.assign(state, value); return q; },
        maybeSingle: async () => ({ data: row(), error: null }),
        single: async () => ({ data: row(), error: null }),
        then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
      };
      return q;
    },
  };
  return { c: { db, task: 'test', owner: 'owner', generation: 1 } as unknown as Context, checkpoints, releases, state };
}

for (const failure of ['stop_error', 'snapshot', 'stopping', 'creation_unknown'] as const) {
  test(`uncertain cleanup (${failure}) pauses processing and retains the resource reservation`, async () => {
    const original = Sandbox.create;
    const snapshot = process.env.CLOUD_SANDBOX_SNAPSHOT;
    process.env.CLOUD_SANDBOX_SNAPSHOT = 'manual-base';
    const fixture = database();
    Sandbox.create = async () => {
      if (failure === 'creation_unknown') throw new Error('request outcome unknown');
      return { currentSession: () => ({
        sessionId: 'test-session',
        writeFiles: async () => {},
        runCommand: async () => ({ exitCode: 0 }),
        readFileToBuffer: async ({ path }: { path: string }) => Buffer.from(path.endsWith('info.txt') ? 'Pages: 1' : 'Document sintètic amb informació suficient per comprovar una extracció digital segura i conservar-ne el checkpoint.'),
        stop: async () => {
          if (failure === 'stop_error') throw new Error('provider secret');
          return { session: { status: failure === 'stopping' ? 'stopping' : 'stopped' }, ...(failure === 'snapshot' ? { snapshot: { id: 'unexpected' } } : {}) };
        },
      }) } as unknown as Awaited<ReturnType<typeof original>>;
    };
    try {
      await assert.rejects(extractDocument(fixture.c, 'job', 'doc', 'https://unused.invalid', false), error => {
        assert.ok(error instanceof CloudFailure);
        assert.equal(error.kind, 'internal');
        assert.equal(error.diagnostic?.operation, 'sandbox_cleanup');
        return true;
      });
      assert.equal(fixture.state.enabled, false);
      assert.equal(fixture.state.blocked_kind, 'internal');
      assert.equal(fixture.releases.length, 0);
      if (failure !== 'creation_unknown') assert.ok(fixture.checkpoints.has(`document:doc:${EXTRACTION_VERSION}`));
    } finally {
      Sandbox.create = original;
      if (snapshot === undefined) delete process.env.CLOUD_SANDBOX_SNAPSHOT; else process.env.CLOUD_SANDBOX_SNAPSHOT = snapshot;
    }
  });
}

for (const failure of ['stopped_session', 'killed_command', 'missing_executable'] as const) {
test(`${failure} remains infrastructure failure and releases only after confirmed stop`, async () => {
  const original = Sandbox.create;
  const snapshot = process.env.CLOUD_SANDBOX_SNAPSHOT;
  process.env.CLOUD_SANDBOX_SNAPSHOT = 'manual-base';
  const fixture = database();
  let stopped = false;
  Sandbox.create = async () => ({ currentSession: () => ({
    sessionId: 'test-session',
    writeFiles: async () => { if (failure === 'stopped_session') throw Object.assign(new Error('gone'), { response: { status: 410 } }); },
    runCommand: async () => ({ exitCode: failure === 'killed_command' ? 137 : 127 }),
    stop: async () => { stopped = true; return { session: { status: 'stopped' } }; },
  }) }) as unknown as Awaited<ReturnType<typeof original>>;
  try {
    await assert.rejects(extractDocument(fixture.c, 'job', 'doc', 'https://unused.invalid', false), error => {
      assert.ok(error instanceof CloudFailure);
      assert.equal(error.kind, 'internal');
      assert.equal(error.diagnostic?.code, failure === 'stopped_session' ? 'SANDBOX_SESSION_STOPPED' : 'SANDBOX_COMMAND_INTERRUPTED');
      return true;
    });
    assert.equal(stopped, true);
    assert.equal(fixture.releases.length, 1);
    assert.equal(fixture.state.enabled, true);
    assert.equal(fixture.checkpoints.has('document_failed:doc'), false);
  } finally {
    Sandbox.create = original;
    if (snapshot === undefined) delete process.env.CLOUD_SANDBOX_SNAPSHOT; else process.env.CLOUD_SANDBOX_SNAPSHOT = snapshot;
  }
});

}
