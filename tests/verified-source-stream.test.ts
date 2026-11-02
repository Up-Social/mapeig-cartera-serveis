import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build,type Plugin} from 'esbuild';

const record='11111111-1111-4111-8111-111111111111';
const unit='22222222-2222-4222-8222-222222222222';
const document='33333333-3333-4333-8333-333333333333';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const fixture=globalThis as typeof globalThis&{streamFixture?:{db:unknown;archive?:unknown;archiveError?:unknown}};

test('archived sources stream only after verification and preserve headers for large documents',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mapeig-verified-stream-'));
 try{
  const mock:Plugin={name:'stream-fixtures',setup(builder){
   builder.onResolve({filter:/^@\/lib\/(records-page|source-storage|runtime-schema)$/},args=>({path:args.path,namespace:'fixture'}));
   builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.endsWith('records-page')
    ? 'export const createServerSupabase=()=>globalThis.streamFixture.db;'
    :args.path.endsWith('runtime-schema')?'export const hasUnitSchema=()=>true;'
    : `import {createHash} from 'node:crypto';
       export const SOURCE_BUCKET='cloud-documents';
       export const sha256=b=>createHash('sha256').update(b).digest('hex');
       export class ArchivedSourceUnavailableError extends Error{};
       export class SourceContentChangedError extends Error{};
       export async function readSource(){if(globalThis.streamFixture.archiveError)throw new ArchivedSourceUnavailableError('fixture integrity failure');return globalThis.streamFixture.archive;}`,
    loader:'js'}));
  }};
  const entries=['app/api/documents/[id]/open/route.ts','app/api/records/[id]/units/[unitId]/source/route.ts'];
  const outputs=entries.map((_,i)=>join(dir,`route-${i}.mjs`));
  for(let i=0;i<entries.length;i++)await build({entryPoints:[entries[i]],outfile:outputs[i],bundle:true,platform:'node',format:'esm',alias:{'@':resolve('.')},plugins:[mock],logLevel:'silent'});
  const routes=await Promise.all(outputs.map(output=>import(pathToFileURL(output).href)));
  const bytes=Buffer.alloc(5*1024*1024+17);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
  const digest=hash(bytes),path=`cases/${record}/items/${unit}/documents/${document}/${digest}.pdf`;
  let downloads=0;
  const query=(table:string)=>({select(){return this;},eq(){return this;},async maybeSingle(){return {data:table==='record_units'?{storage_path:path,storage_sha256:digest,document_id:document}:table==='source_documents'?{id:document,mime_type:'application/pdf',storage_sha256:digest}:null,error:null};}});
  fixture.streamFixture={db:{from:query,storage:{from:()=>({download:async()=>{downloads++;return {data:new Blob([bytes]),error:null};}})}},archive:{bytes,mimeType:'application/pdf',sha256:digest}};
  const cases=[
   {route:routes[0],params:{id:document}},
   {route:routes[1],params:{id:record,unitId:unit}},
  ];
  for(const current of cases){
   const response:Response=await current.route.GET(new Request('http://local.invalid'),{params:Promise.resolve(current.params)});
   assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');
   assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
   assert.equal(response.headers.get('content-length'),null);
   assert.ok(response.body);const reader=response.body.getReader();let count=0,total=0;const digestStream=createHash('sha256');
   for(;;){const part=await reader.read();if(part.done)break;count++;total+=part.value.byteLength;digestStream.update(part.value);}
   assert.ok(count>1);assert.equal(total,bytes.length);assert.equal(digestStream.digest('hex'),digest);
  }
  assert.equal(downloads,1);
  const pinned:Response=await routes[0].GET(new Request(`http://local.invalid?sha=${digest}`),{params:Promise.resolve({id:document})});
  assert.equal(pinned.status,200);
  const changed:Response=await routes[0].GET(new Request(`http://local.invalid?sha=${'f'.repeat(64)}`),{params:Promise.resolve({id:document})});
  assert.equal(changed.status,409);assert.match((await changed.json()).error,/canviat/);
  const invalid:Response=await routes[0].GET(new Request('http://local.invalid?sha=invalid'),{params:Promise.resolve({id:document})});
  assert.equal(invalid.status,400);
  fixture.streamFixture={db:{from:query,storage:{from:()=>({download:async()=>({data:new Blob([Buffer.from('corrupt')]),error:null})})}}};
  const corrupt:Response=await routes[1].GET(new Request('http://local.invalid'),{params:Promise.resolve({id:record,unitId:unit})});
  assert.equal(corrupt.status,503);assert.match((await corrupt.json()).error,/integritat/);
  for(const failure of ['download','body','returned_error','no_data'] as const){
   fixture.streamFixture={db:{from:query,storage:{from:()=>({download:async()=>{
    if(failure==='download')throw Error('private backend detail');
    if(failure==='returned_error')return {data:null,error:{message:'private backend detail'}};
    if(failure==='no_data')return {data:null,error:null};
    return {data:{arrayBuffer:async()=>{throw Error('private backend detail');}},error:null};
   }})}}};
   const failed:Response=await routes[1].GET(new Request('http://local.invalid'),{params:Promise.resolve({id:record,unitId:unit})});
   assert.equal(failed.status,503);const result=await failed.json();assert.match(result.error,/No s’ha pogut llegir/);assert.doesNotMatch(result.error,/private backend detail/);
  }
  fixture.streamFixture={db:{from:()=>({select(){return this;},eq(){return this;},async maybeSingle(){return {data:null,error:null};}}),storage:{from:()=>{throw Error('unexpected Storage request');}}}};
  const missing:Response=await routes[1].GET(new Request('http://local.invalid'),{params:Promise.resolve({id:record,unitId:unit})});
  assert.equal(missing.status,404);assert.match((await missing.json()).error,/Font arxivada no disponible/);
  fixture.streamFixture={db:{from:query},archiveError:true};
  const unavailable:Response=await routes[0].GET(new Request('http://local.invalid'),{params:Promise.resolve({id:document})});
  assert.equal(unavailable.status,503);assert.match((await unavailable.json()).error,/integrity failure/);
 }finally{delete fixture.streamFixture;await rm(dir,{recursive:true,force:true});}
});
