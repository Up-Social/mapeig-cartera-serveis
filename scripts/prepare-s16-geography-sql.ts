/** Generates an auditable local candidate only. Does not execute SQL. */
import {execFile} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import {prepareS16GeographySql} from '../lib/concerts/s16-geography-sql';
import {S16_SOURCE_URL,sha} from '../lib/concerts/s16-geography-dry-run';

async function run(){
 if(process.argv.length!==2)throw Error('NO_ARGUMENTS_ALLOWED');
 const preflight=await promisify(execFile)(process.execPath,['--import','tsx','scripts/dry-run-s16-geography.ts'],{timeout:40_000,maxBuffer:200_000,env:process.env});
 const result=JSON.parse(preflight.stdout);
 const local=await readFile('docs/local/concert-e2e-2026-11-02/S1-6-convocatoria-geografia.html');
 const response=await fetch(S16_SOURCE_URL,{redirect:'error',signal:AbortSignal.timeout(15_000)});
 if(!response.ok||!response.headers.get('content-type')?.toLowerCase().includes('text/html'))throw Error('OFFICIAL_SOURCE_UNAVAILABLE');
 const live=new Uint8Array(await response.arrayBuffer());
 if(live.length>4_000_000)throw Error('OFFICIAL_SOURCE_TOO_LARGE');
 const capturedAt=new Date().toISOString();
 const sql=prepareS16GeographySql(result,local,live,capturedAt);
 const output=`docs/local/concert-e2e-2026-11-02/S1-6-geography-candidate-${Date.now()}.sql`;
 await writeFile(output,sql,{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({output,sha256:sha(sql),capturedAt,limitation:'Local candidate only. Requires migration, review and explicit production authorization. No SQL executed.'}));
}
run().catch(error=>{console.error(`S1-6 preparation failed: ${error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'PREPARATION_UNAVAILABLE'}`);process.exitCode=1;});
