import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const helper = fileURLToPath(new URL('../scripts/managed-process.ts', import.meta.url));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

for (const mode of ['interrupt', 'normal-exit', 'permission-error'] as const) {
  test(`managed launcher reaps a resistant grandchild after ${mode}`, { timeout: 12000, skip: process.platform === 'win32' }, async (t) => {
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    const grandchildCode = `process.on('SIGTERM',()=>{}); console.log('GRANDCHILD='+process.pid); setInterval(()=>{},1000);`;
    const workerCode = `const {spawn}=require('node:child_process');
      console.log('WORKER='+process.pid);
      const child=spawn(process.execPath,['-e',${JSON.stringify(grandchildCode)}],{stdio:'inherit'});child.unref();
      ${mode !== 'interrupt' ? 'setTimeout(()=>process.exit(0),500);' : 'setInterval(()=>{},1000);'}`;
    const denyTerm = `const realKill=process.kill.bind(process);process.kill=(pid,signal)=>{if(pid<0&&signal==='SIGTERM')throw Object.assign(new Error('fixture'),{code:'EPERM'});return realKill(pid,signal);};`;
    const launcherCode = `${mode === 'permission-error' ? denyTerm : ''} const {runManagedProcess}=require(${JSON.stringify(helper)}); runManagedProcess(process.execPath,['-e',${JSON.stringify(workerCode)}],{stdio:'inherit'});`;
    const launcher = spawn(process.execPath, ['--import', 'tsx', '-e', launcherCode], { stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = once(launcher, 'close');
    let output = '';
    let errors = '';
    launcher.stderr.on('data', data => { errors += data.toString(); });
    t.after(() => {
      unrelated.kill('SIGKILL');
      launcher.kill('SIGKILL');
      for (const match of output.matchAll(/(?:WORKER|GRANDCHILD)=(\d+)/g)) {
        try { process.kill(Number(match[1]), 'SIGKILL'); } catch { /* Already reaped. */ }
      }
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Fixture did not start: ${errors}`)), 5000);
      launcher.stdout.on('data', data => {
        output += data.toString();
        if (output.includes('GRANDCHILD=')) { clearTimeout(timeout); resolve(); }
      });
    });
    if (mode === 'interrupt') launcher.kill('SIGTERM');
    const [code] = await closed;
    assert.equal(code, mode === 'interrupt' ? 143 : mode === 'permission-error' ? 1 : 0, errors);
    if (mode === 'permission-error') assert.match(errors, /EPERM/, 'live group permission failure was hidden');
    const worker = Number(output.match(/WORKER=(\d+)/)?.[1]);
    const grandchild = Number(output.match(/GRANDCHILD=(\d+)/)?.[1]);
    // The OS may need a scheduling turn to reap an orphan after SIGKILL.
    for (let attempt = 0; attempt < 20 && (alive(worker) || alive(grandchild)); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(alive(worker), false, 'worker survived');
    assert.equal(alive(grandchild), false, 'compiler grandchild survived');
    assert.equal(alive(unrelated.pid!), true, 'another process was affected');
  });
}

test('macOS empty group EPERM does not turn a successful command into a failure', {timeout:10000,skip:process.platform!=='darwin'}, async()=>{
  const code=`const realKill=process.kill.bind(process);process.kill=(pid,signal)=>{if(pid<0)throw Object.assign(new Error('fixture'),{code:'EPERM'});return realKill(pid,signal);};
    const {runManagedProcess}=require(${JSON.stringify(helper)});runManagedProcess(process.execPath,['-e',''],{stdio:'inherit'});`;
  const launcher=spawn(process.execPath,['--import','tsx','-e',code],{stdio:['ignore','pipe','pipe']});
  let errors='';launcher.stderr.on('data',data=>{errors+=data.toString();});
  const [exitCode]=await once(launcher,'close');
  assert.equal(exitCode,0,errors);assert.equal(errors,'');
});
