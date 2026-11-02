import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test('discard purge completes only for an explicit absence from Storage',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mapeig-purge-response-'));
 const holder=globalThis as typeof globalThis&{visualTestDb?:unknown};
 try{
  const noServerOnly=join(dir,'server-only.js'),out=join(dir,'purge.mjs');
  await writeFile(noServerOnly,'export {};');
  await build({entryPoints:['lib/discard-deletion.ts'],bundle:true,platform:'node',format:'esm',outfile:out,
   alias:{'server-only':noServerOnly},plugins:[{name:'fixture-db',setup(build){
    build.onResolve({filter:/^\.\/records-page$/},()=>({path:resolve('tests/fixtures/conveni-visual-db.ts')}));
   }}],logLevel:'silent'});
  const {purgeDeletion}=await import(pathToFileURL(out).href);
  for(const value of [false,true,null,undefined,'false']){
   const updates:Array<{table:string;body:Record<string,unknown>}>=[];let removes=0,lists=0;
   holder.visualTestDb={
    from:(table:string)=>({
     select:()=>table==='storage_purge_batches'?{eq:()=>({single:async()=>({data:{id:'batch'},error:null})})}:
      {eq:()=>({eq:()=>({order:()=>({range:async()=>({data:[{id:'item',bucket:'cloud-documents',path:'fixture',attempts:0}],error:null})})})})},
     update:(body:Record<string,unknown>)=>({eq:async()=>{updates.push({table,body});return {error:null};}}),
    }),
    storage:{from:()=>({remove:async()=>{removes++;return {error:null};},exists:async()=>({data:value,error:null}),list:async()=>{lists++;throw Error('Unexpected listing');}})},
   };
   const result=await purgeDeletion('batch');
   assert.equal(removes,1);assert.equal(lists,0);
   assert.equal(result.complete,value===false);
   assert.equal(updates[0].body.status,value===false?'complete':'pending');
   assert.equal(updates.some(x=>x.table==='storage_purge_batches'),value===false);
  }
 }finally{delete holder.visualTestDb;await rm(dir,{recursive:true,force:true});}
});
