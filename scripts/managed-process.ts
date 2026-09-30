import { execFileSync, spawn, type SpawnOptions } from 'node:child_process';

function groupHasLiveMembers(groupId: number) {
  // On macOS a dying group can report EPERM while its last members are zombies.
  // Only disregard that error when a fresh OS snapshot confirms none are live.
  try {
    return execFileSync('ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8', timeout: 2000 })
      .trim().split('\n').some(row => {
        const [group, state] = row.trim().split(/\s+/);
        return Number(group) === groupId && !state?.startsWith('Z');
      });
  } catch { return true; } // An unavailable check must not hide a cleanup failure.
}

/** Own one POSIX process group, including compiler workers, for this launcher. */
export function runManagedProcess(command: string, args: string[], options: SpawnOptions = {}) {
  const child = spawn(command, args, {
    ...options,
    detached: process.platform !== 'win32',
  });
  let stopping = false;
  let requestedExit: number | undefined;
  const signalGroup = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (process.platform === 'darwin' && (error as NodeJS.ErrnoException).code === 'EPERM'
        && !groupHasLiveMembers(child.pid)) return;
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        console.error(`No se pudo cerrar el grupo de procesos del lanzador (${(error as NodeJS.ErrnoException).code ?? 'unknown'}).`);
        process.exitCode = 1;
      }
    }
  };
  const cleanup = () => {
    if (stopping) return;
    stopping = true;
    signalGroup('SIGTERM');
    // Keep the launcher alive long enough to reap workers that ignore SIGTERM,
    // even if Next/npm has already exited. Never signal another process group.
    setTimeout(() => {
      signalGroup('SIGKILL');
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
      process.removeListener('exit', onExit);
    }, 2000);
  };
  const onInterrupt = () => { requestedExit = 130; cleanup(); };
  const onTerminate = () => { requestedExit = 143; cleanup(); };
  const onExit = () => signalGroup('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  process.once('exit', onExit);
  child.once('error', () => { process.exitCode = 1; cleanup(); });
  child.once('exit', (code) => {
    process.exitCode = requestedExit ?? code ?? 1;
    cleanup();
  });
  return child;
}
