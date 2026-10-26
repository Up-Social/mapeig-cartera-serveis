import { APIError, Sandbox, type Session } from '@vercel/sandbox';

export const SANDBOX_SYNTHETIC_TIMEOUT_MS = 90_000;
const TIMEOUTS = { document: 600_000, probe: 60_000, synthetic: SANDBOX_SYNTHETIC_TIMEOUT_MS } as const;
export const SANDBOX_CLEANUP_TIMEOUT_MS = 15_000;
// Vercel documents a minimum custom snapshot retention of one day.
export const SANDBOX_SNAPSHOT_EXPIRATION_MS = 86_400_000;
const CREATION_TIMEOUT_MS = 60_000;
export type SandboxPurpose = keyof typeof TIMEOUTS;
// Expose only a specific session. Sandbox methods can silently resume a new VM.
export type DocumentSession = Pick<Session, 'writeFiles' | 'readFileToBuffer'> & {
  runCommand(command: string, args?: string[], options?: { signal?: AbortSignal; timeoutMs?: number }): ReturnType<Session['runCommand']>;
};
export type EphemeralSandbox = {
  session: DocumentSession;
  sessionId: string;
  close(): Promise<void>;
};

export type SandboxFailureDiagnostic = {
  phase: 'create' | 'work' | 'stop';
  category: 'api' | 'response_schema' | 'timeout' | 'network' | 'unknown';
  status?: number;
  fields?: string[];
};

/** Fixed vocabulary only: never log provider messages, payloads, headers or URLs. */
export function sandboxFailureDiagnostic(phase: SandboxFailureDiagnostic['phase'], error: unknown): SandboxFailureDiagnostic {
  if (error instanceof SandboxLifecycleError && error.diagnostic) return error.diagnostic;
  if (error instanceof APIError) {
    const status = error.response.status;
    const category = status >= 200 && status < 300 ? 'response_schema' : 'api';
    const fields = ['source', 'snapshotId', 'snapshotExpiration', 'persistent', 'timeout', 'resources', 'vcpus', 'memory', 'runtime', 'image', 'region', 'networkPolicy', 'projectId', 'session', 'sandbox', 'currentSessionId', 'currentSnapshotId']
      .filter(field => new RegExp(`\\b${field}\\b`, 'u').test(error.message));
    return { phase, category, status, ...(fields.length ? { fields } : {}) };
  }
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) return { phase, category: 'timeout' };
  if (error instanceof TypeError && error.message === 'fetch failed') return { phase, category: 'network' };
  return { phase, category: 'unknown' };
}

export class SandboxLifecycleError extends Error {
  constructor(
    public code: 'SANDBOX_CREATION_UNCONFIRMED' | 'SANDBOX_STOP_UNCONFIRMED' | 'SANDBOX_UNEXPECTED_SNAPSHOT',
    public sessionId: string,
    public snapshotId?: string,
    public diagnostic?: SandboxFailureDiagnostic,
  ) { super(code); }
}

/** Creates no durable filesystem. Originals and checkpoints live in Supabase. */
export async function createEphemeralSandbox(purpose: SandboxPurpose, snapshotId: string): Promise<EphemeralSandbox> {
  const startedAt = Date.now();
  const sandbox = await Sandbox.create({
    source: { type: 'snapshot', snapshotId },
    persistent: false,
    // Defense in depth if platform behavior changes; normal operation creates none.
    snapshotExpiration: SANDBOX_SNAPSHOT_EXPIRATION_MS,
    resources: { vcpus: 1 },
    networkPolicy: 'deny-all',
    timeout: TIMEOUTS[purpose],
    // The resource lease starts before creation: 60s + 600s + 15s < 12min.
    signal: AbortSignal.timeout(CREATION_TIMEOUT_MS),
  });
  const session = sandbox.currentSession();
  const workSignal = AbortSignal.timeout(TIMEOUTS[purpose]);
  const boundedSignal = (signal?: AbortSignal) => signal ? AbortSignal.any([signal, workSignal]) : workSignal;
  const operations: DocumentSession = {
    writeFiles: (files, options) => session.writeFiles(files, { ...options, signal: boundedSignal(options?.signal) }),
    readFileToBuffer: (file, options) => session.readFileToBuffer(file, { ...options, signal: boundedSignal(options?.signal) }),
    runCommand: (command, args, options) => session.runCommand(command, args, { ...options, signal: boundedSignal(options?.signal) }),
  };
  let closing: Promise<void> | undefined;
  return {
    session: operations,
    sessionId: session.sessionId,
    close() {
      return closing ??= stopEphemeralSession(session).then(() => {
        console.info('SANDBOX_CLOSED', { purpose, sessionId: session.sessionId, durationMs: Date.now() - startedAt });
      });
    },
  };
}

/** A fresh deadline, independent of work cancellation and of the VM timeout. */
export async function stopEphemeralSession(session: Pick<Session, 'stop' | 'sessionId'>): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      session.stop({ signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new SandboxLifecycleError('SANDBOX_STOP_UNCONFIRMED', session.sessionId));
        }, SANDBOX_CLEANUP_TIMEOUT_MS);
      }),
    ]);
    if (result.snapshot) throw new SandboxLifecycleError('SANDBOX_UNEXPECTED_SNAPSHOT', session.sessionId, result.snapshot.id);
    if (result.session.status !== 'stopped') throw new SandboxLifecycleError('SANDBOX_STOP_UNCONFIRMED', session.sessionId);
  } catch (error) {
    if (error instanceof SandboxLifecycleError) throw error;
    throw new SandboxLifecycleError('SANDBOX_STOP_UNCONFIRMED', session.sessionId, undefined, sandboxFailureDiagnostic('stop', error));
  } finally {
    clearTimeout(timer);
  }
}
