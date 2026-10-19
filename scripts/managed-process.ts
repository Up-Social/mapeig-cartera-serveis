import { execFileSync, spawn, type SpawnOptions } from 'node:child_process';

function groupHasLiveMembers(groupId: number): boolean | undefined {
  try {
    return execFileSync('/bin/ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8', timeout: 2000 })
      .trim().split('\n').some(row => {
        const [group, state] = row.trim().split(/\s+/);
        return Number(group) === groupId && !state?.startsWith('Z');
      });
  } catch { return undefined; } // An unavailable check must not hide a cleanup failure.
}

/** Own one POSIX process group, including compiler workers, for this launcher. */
export function runManagedProcess(command: string, args: string[], options: SpawnOptions = {}) {
  const child = spawn(command, args, {
    ...options,
    detached: process.platform !== 'win32',
  });
  let stopping = false;
  let cleanupFailed = false;
  let requestedExit: number | undefined;
  const signalGroup = async (signal: NodeJS.Signals, canWait = true) => {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return;
      if (process.platform === 'darwin' && code === 'EPERM') {
        // macOS can deny a signal while the last group members are exiting.
        // A single ps snapshot can still see them as live. Confirm their exit
        // over a bounded grace period; never ignore a live or unverifiable group.
        for (let attempt = 0; ; attempt++) {
          const live = groupHasLiveMembers(child.pid);
          if (live === false) return;
          if (live === undefined || !canWait || attempt === 4) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      console.error(`No se pudo cerrar el grupo de procesos del lanzador (${code ?? 'unknown'}).`);
      cleanupFailed = true;
      process.exitCode = 1;
    }
  };
  const cleanup = async () => {
    if (stopping) return;
    stopping = true;
    await signalGroup('SIGTERM');
    // Keep the launcher alive long enough to reap workers that ignore SIGTERM,
    // even if Next/npm has already exited. Never signal another process group.
    await new Promise(resolve => setTimeout(resolve, 2000));
    await signalGroup('SIGKILL');
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    process.removeListener('exit', onExit);
  };
  const onInterrupt = () => { requestedExit = 130; void cleanup(); };
  const onTerminate = () => { requestedExit = 143; void cleanup(); };
  // Exit listeners cannot wait for timers; this fallback only signals/checks once.
  const onExit = () => { void signalGroup('SIGTERM', false); };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  process.once('exit', onExit);
  child.once('error', () => { process.exitCode = 1; void cleanup(); });
  child.once('exit', (code) => {
    process.exitCode = cleanupFailed ? 1 : requestedExit ?? code ?? 1;
    void cleanup();
  });
  return child;
}
