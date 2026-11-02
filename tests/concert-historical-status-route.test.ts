import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

test('disabled history does not need experimental SQL and does not invent a completed or unstarted recovery',async()=>{
 const previous=process.env.HISTORICAL_CONCERTS_ENABLED,dir=await mkdtemp(join(tmpdir(),'concert-history-disabled-'));
 const testGlobal=globalThis as typeof globalThis&{historyStatusDb?:unknown};let calls=0;
 try{
  const context=join(dir,'context.js'),workflow=join(dir,'workflow.js'),api=join(dir,'api.js'),processing=join(dir,'processing.js'),output=join(dir,'route.mjs');
  await writeFile(context,'export function cloudDb(){return globalThis.historyStatusDb;}');
  await writeFile(processing,'export async function getProcessingSetting(db){return db.processing();}');
  await writeFile(workflow,'export function recoverHistoricalConcerts(){throw Error("unexpected workflow");}');
  await writeFile(api,'export function start(){throw Error("unexpected dispatch");}');
  await build({entryPoints:['app/api/admin/settings/concert-history/route.ts'],bundle:true,platform:'node',format:'esm',outfile:output,alias:{'@/lib/cloud/context':context,'@/lib/processing-control':processing,'@/workflows/historical-concerts':workflow,'workflow/api':api,'@':resolve('.')},logLevel:'silent'});
  const route=await import(pathToFileURL(output).href);
  testGlobal.historyStatusDb=new Proxy({}, {get(){calls++;throw Error('disabled feature reached database');}});
  for(const flag of [undefined,'false']){
   if(flag===undefined)delete process.env.HISTORICAL_CONCERTS_ENABLED;else process.env.HISTORICAL_CONCERTS_ENABLED=flag;
   const response:Response=await route.GET();
   assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');
   assert.deepEqual(await response.json(),{state:'disabled',reason:'FEATURE_DISABLED',can_start:false,feature_enabled:false,source_exhaustive:false});
  }
  assert.equal(calls,0);
  process.env.HISTORICAL_CONCERTS_ENABLED='true';
  testGlobal.historyStatusDb={rpc:async(name:string)=>{assert.equal(name,'experimental_history_status');calls++;return {data:{state:'completed',records_saved:20},error:null};},processing:async()=>({enabled:true})};
  const response:Response=await route.GET();assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.state,'completed');assert.equal(data.records_saved,20);assert.equal(data.can_start,false);assert.equal(calls,1);
 }finally{if(previous===undefined)delete process.env.HISTORICAL_CONCERTS_ENABLED;else process.env.HISTORICAL_CONCERTS_ENABLED=previous;delete testGlobal.historyStatusDb;await rm(dir,{recursive:true,force:true});}
});
