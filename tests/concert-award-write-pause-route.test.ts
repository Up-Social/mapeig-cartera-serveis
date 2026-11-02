import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test('paused award decisions show their reason and do not start archival or decision',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'concert-award-pause-'));
 const before=[process.env.ENABLE_CONCERT_LINE_AWARDS,process.env.CONCERT_LINE_READERS_READY];
 const globals=globalThis as typeof globalThis&{visualTestDb?:unknown};
 try{
  const out=join(dir,'route.mjs');
  await build({entryPoints:['app/api/records/[id]/units/[unitId]/award/route.ts'],bundle:true,platform:'node',format:'esm',outfile:out,alias:{'@/lib/records-page':resolve('tests/fixtures/conveni-visual-db.ts'),'@':resolve('.')},logLevel:'silent'});
  const route=await import(pathToFileURL(out).href);
  process.env.ENABLE_CONCERT_LINE_AWARDS='true';process.env.CONCERT_LINE_READERS_READY='true';
  const calls:string[]=[];
  globals.visualTestDb={rpc:async(name:string)=>{calls.push(name);return {data:{enabled:false,reason:'Comprovació documental'},error:null};}};
  const id='00000000-0000-4000-8000-000000000001',unitId='00000000-0000-4000-8000-000000000002',job='00000000-0000-4000-8000-000000000003';
  const params={params:Promise.resolve({id,unitId})};
  const get=await route.GET(new Request(`http://fixture.invalid?job=${job}`),params);
  assert.deepEqual(await get.json(),{enabled:false,paused:true,reason:'Comprovació documental'});
  const post=await route.POST(new Request('http://fixture.invalid',{method:'POST',body:'{}'}),params);
  assert.equal(post.status,409);const body=await post.json();assert.equal(body.outcome,'not_sent');assert.match(body.error,/Comprovació documental/);
  assert.deepEqual(calls,['concert_line_write_status','concert_line_write_status']);
 }finally{
  if(before[0]===undefined)delete process.env.ENABLE_CONCERT_LINE_AWARDS;else process.env.ENABLE_CONCERT_LINE_AWARDS=before[0];
  if(before[1]===undefined)delete process.env.CONCERT_LINE_READERS_READY;else process.env.CONCERT_LINE_READERS_READY=before[1];
  delete globals.visualTestDb;await rm(dir,{recursive:true,force:true});
 }
});
