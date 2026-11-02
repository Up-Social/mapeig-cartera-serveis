import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {archiveImportWorkbook,archiveImportedRow,archiveHistoricalRow,archiveHistoricalApiRow,SourceContentChangedError,sha256,SOURCE_BUCKET} from '../lib/source-storage';

const id='11111111-1111-4111-8111-111111111111',run='22222222-2222-4222-8222-222222222222',oldRun='33333333-3333-4333-8333-333333333333';
const bookSha='a'.repeat(64),workbook={path:`imports/${run}/${bookSha}.xlsx`,sha256:bookSha};
const row={source_dataset:'contractacions',source_record_id:'synthetic',source_file:'Book.xlsx',source_sheet:'Sheet',source_row:2,source_payload:{title:'original'},source_payload_hash:'declared'};
function fixture(options:{busy?:boolean;race?:'pointer'|'payload';previous?:{storage_path:string|null;storage_sha256:string|null};unknown?:boolean;locked?:boolean;racedUpload?:boolean;onDownload?:()=>void}={}){
 const current={...structuredClone(row),import_run_id:run,...(options.previous??{storage_path:null,storage_sha256:null})};
 const objects=new Map<string,Buffer>();let uploads=0,downloads=0,rpcs=0;
 const db={storage:{from:(bucket:string)=>{assert.equal(bucket,SOURCE_BUCKET);return {
  list:async(dir:string,{search}:{search:string})=>({data:objects.has(`${dir}/${search}`)?[{name:search}]:[],error:null}),
  upload:async(path:string,bytes:Buffer)=>{uploads++;objects.set(path,Buffer.from(bytes));return options.racedUpload?{data:null,error:Error('already exists')}:{data:{path},error:null};},
  download:async(path:string)=>{downloads++;const bytes=objects.get(path);if(options.race==='pointer'){current.storage_path='other';current.storage_sha256='b'.repeat(64);}if(options.race==='payload')current.source_payload={title:'changed'};options.onDownload?.();return bytes?{data:new Blob([Uint8Array.from(bytes)]),error:null}:{data:null,error:Error('missing')};},
 };}},from:()=>{let filterRun:unknown;const q={select:()=>q,eq:(key:string,value:unknown)=>{if(key==='import_run_id')filterRun=value;return q;},is:(key:string,value:unknown)=>{if(key==='import_run_id')filterRun=value;return q;},maybeSingle:async()=>({data:filterRun===current.import_run_id?{storage_path:current.storage_path,storage_sha256:current.storage_sha256}:null,error:null})};return q;},
 rpc:async(name:string,args:Record<string,unknown>)=>{
  assert.equal(name,'publish_import_source');rpcs++;
  if(options.unknown)throw Error('unknown transport outcome');
  if(options.locked)return {data:null,error:{code:'55P03',message:'IMPORT_SOURCE_BUSY'}};
  if(options.busy&&rpcs===1)return {data:null,error:{code:'40001',message:'T19_DEDUP_BUSY'}};
  const expected={...current};delete (expected as Partial<typeof current>).storage_path;delete (expected as Partial<typeof current>).storage_sha256;
  if(!isDeepStrictEqual(args.p_expected,expected))return {data:false,error:null};
  if(args.p_path===current.storage_path&&args.p_sha256===current.storage_sha256)return {data:true,error:null};
  if(!isDeepStrictEqual(args.p_previous,{storage_path:current.storage_path,storage_sha256:current.storage_sha256}))return {data:false,error:null};
  current.storage_path=String(args.p_path);current.storage_sha256=String(args.p_sha256);return {data:true,error:null};
 }};
 return {db,current,objects,get uploads(){return uploads;},get downloads(){return downloads;},get rpcs(){return rpcs;}};
}

test('transaction conflict retries pointer publication, never Storage upload or verification',async()=>{
 const f=fixture({busy:true});const result=await archiveImportedRow(f.db as never,id,run,row,workbook);
 assert.equal(f.uploads,1);assert.equal(f.downloads,1);assert.equal(f.rpcs,2);
 assert.equal(f.current.storage_path,result.path);assert.equal(sha256(f.objects.get(result.path)!),result.sha256);
});

test('changed pointer or payload with unchanged declared hash cannot be overwritten',async()=>{
 for(const race of ['pointer','payload'] as const){
  const f=fixture({race});await assert.rejects(archiveImportedRow(f.db as never,id,run,row,workbook),SourceContentChangedError);
  assert.equal(f.uploads,1);assert.equal(f.rpcs,1);
  if(race==='pointer')assert.equal(f.current.storage_path,'other');else assert.deepEqual(f.current.source_payload,{title:'changed'});
 }
});

test('a mutable source payload cannot make publication accept a different row than the archived bytes',async()=>{
 const supplied=structuredClone(row);
 const f=fixture({onDownload:()=>{supplied.source_payload.title='changed';f.current.source_payload={title:'changed'};}});
 await assert.rejects(archiveImportedRow(f.db as never,id,run,supplied,{...workbook}),SourceContentChangedError);
 assert.equal(f.current.storage_path,null);assert.equal(f.rpcs,1);
 const archived=[...f.objects.values()][0];assert.equal(JSON.parse(archived.toString()).source_payload.title,'original');
});

test('historical imports also bind archived bytes and publication to the same payload',async()=>{
 for(const kind of ['workbook','api'] as const){
  const supplied={...structuredClone(row),id,source_dataset:kind==='api'?'concerts':'contractacions'};
  const f=fixture({onDownload:()=>{supplied.source_payload.title='changed';f.current.source_payload={title:'changed'};}});
  f.current.import_run_id=null as never;f.current.source_dataset=supplied.source_dataset;
  const archive={path:`imports/legacy/${bookSha}.${kind==='api'?'json':'xlsx'}`,sha256:bookSha};
  await assert.rejects(kind==='api'?archiveHistoricalApiRow(f.db as never,supplied,archive):archiveHistoricalRow(f.db as never,supplied,archive),SourceContentChangedError);
  assert.equal(f.current.storage_path,null);assert.equal(f.rpcs,1);
  assert.equal(JSON.parse([...f.objects.values()][0].toString()).source_payload.title,'original');
 }
});

test('same-run different confirmed source is blocked before Storage writes',async()=>{
 const previous={storage_path:`cases/${id}/imports/${run}/${'b'.repeat(64)}.json`,storage_sha256:'b'.repeat(64)};
 const f=fixture({previous});await assert.rejects(archiveImportedRow(f.db as never,id,run,row,workbook),SourceContentChangedError);
 assert.equal(f.uploads,0);assert.equal(f.downloads,0);assert.equal(f.rpcs,0);assert.equal(f.current.storage_path,previous.storage_path);
});

test('a new run can replace only the old run pointer and preserves the old object',async()=>{
 const previous={storage_path:`cases/${id}/imports/${oldRun}/${'b'.repeat(64)}.json`,storage_sha256:'b'.repeat(64)};
 const f=fixture({previous});f.objects.set(previous.storage_path,Buffer.from('retained historical object'));
 const result=await archiveImportedRow(f.db as never,id,run,row,workbook);
 assert.equal(f.current.storage_path,result.path);assert.ok(f.objects.has(previous.storage_path));assert.equal(f.uploads,1);
});

test('an unknown publication outcome does not retry the database or Storage',async()=>{
 const f=fixture({unknown:true});await assert.rejects(archiveImportedRow(f.db as never,id,run,row,workbook),/unknown transport outcome/);
 assert.equal(f.rpcs,1);assert.equal(f.uploads,1);assert.equal(f.downloads,1);
});

test('different historical references fail closed before writing Storage',async()=>{
 for(const kind of ['workbook','api'] as const){
  const previous={storage_path:`cases/${id}/imports/legacy/${'b'.repeat(64)}.json`,storage_sha256:'b'.repeat(64)};
  const f=fixture({previous});f.current.import_run_id=null as never;
  const historical={...row,id,source_dataset:kind==='api'?'concerts':'contractacions'};
  const archive={path:`imports/legacy/${bookSha}.${kind==='api'?'json':'xlsx'}`,sha256:bookSha};
  await assert.rejects(kind==='api'?archiveHistoricalApiRow(f.db as never,historical,archive):archiveHistoricalRow(f.db as never,historical,archive),SourceContentChangedError);
  assert.equal(f.uploads,0);assert.equal(f.rpcs,0);
 }
});


function workbookFixture(initial:Record<string,unknown>={},race=false,locked=false){
 const manifest=structuredClone(initial);const objects=new Map<string,Buffer>();let uploads=0,downloads=0,rpcs=0;
 const db={storage:{from:()=>({
  list:async(dir:string,{search}:{search:string})=>({data:objects.has(`${dir}/${search}`)?[{name:search}]:[],error:null}),
  upload:async(path:string,bytes:Buffer)=>{uploads++;objects.set(path,Buffer.from(bytes));return {data:{path},error:null};},
  download:async(path:string)=>{downloads++;if(race)manifest['Book.xlsx']={bucket:SOURCE_BUCKET,path:'other',sha256:'b'.repeat(64),byte_size:1};const bytes=objects.get(path);return bytes?{data:new Blob([Uint8Array.from(bytes)]),error:null}:{data:null,error:Error('missing')};},
 })},from:()=>{const q={select:()=>q,eq:()=>q,single:async()=>({data:{storage_manifest:structuredClone(manifest)},error:null})};return q;},
 rpc:async(name:string,args:Record<string,unknown>)=>{assert.equal(name,'publish_import_workbook');rpcs++;if(locked)return {data:null,error:{code:'55P03',message:'IMPORT_WORKBOOK_BUSY'}};const key=String(args.p_file);const entry={bucket:SOURCE_BUCKET,path:args.p_path,sha256:args.p_sha256,byte_size:args.p_size};if(key in manifest)return {data:isDeepStrictEqual(manifest[key],entry),error:null};manifest[key]=entry;return {data:true,error:null};}};
 return {db,manifest,objects,get uploads(){return uploads;},get downloads(){return downloads;},get rpcs(){return rpcs;}};
}

test('workbook manifest publication preserves unrelated entries and exact replay',async()=>{
 const f=workbookFixture({'other.xlsx':{path:'unchanged'}}),bytes=Buffer.from('synthetic workbook');
 const result=await archiveImportWorkbook(f.db as never,run,'Book.xlsx',bytes);
 assert.deepEqual(f.manifest['other.xlsx'],{path:'unchanged'});assert.equal(f.manifest['Book.xlsx']&&(f.manifest['Book.xlsx'] as {path:string}).path,result.path);
 await archiveImportWorkbook(f.db as never,run,'Book.xlsx',bytes);
 assert.equal(f.uploads,1);assert.equal(f.rpcs,1);assert.equal(f.downloads,2);
});

test('the workbook archive fixes input bytes before awaiting the import manifest',async()=>{
 const f=workbookFixture(),bytes=Buffer.from('synthetic workbook'),expected=Buffer.from(bytes);
 const pending=archiveImportWorkbook(f.db as never,run,'Book.xlsx',bytes);bytes.fill(0);
 const result=await pending;
 assert.equal(result.sha256,sha256(expected));assert.deepEqual(f.objects.get(result.path),expected);
});

test('different confirmed workbook is rejected before writing Storage',async()=>{
 const f=workbookFixture({'Book.xlsx':{bucket:SOURCE_BUCKET,path:'old',sha256:'b'.repeat(64),byte_size:1}});
 await assert.rejects(archiveImportWorkbook(f.db as never,run,'Book.xlsx',Buffer.from('new')),SourceContentChangedError);
 assert.equal(f.uploads,0);assert.equal(f.rpcs,0);assert.equal((f.manifest['Book.xlsx'] as {path:string}).path,'old');
});

test('concurrent workbook manifest replacement is not overwritten after upload',async()=>{
 const f=workbookFixture({},true);await assert.rejects(archiveImportWorkbook(f.db as never,run,'Book.xlsx',Buffer.from('new')),SourceContentChangedError);
 assert.equal(f.uploads,1);assert.equal(f.rpcs,1);assert.equal((f.manifest['Book.xlsx'] as {path:string}).path,'other');
});


test('source pointer lock reports contention without repeating Storage or publication',async()=>{
 const f=fixture({locked:true});
 await assert.rejects(archiveImportedRow(f.db as never,id,run,row,workbook),/referència de la font està en modificació/);
 assert.equal(f.rpcs,1);assert.equal(f.uploads,1);assert.equal(f.downloads,1);assert.equal(f.current.storage_path,null);
});


test('workbook manifest contention reports the busy resource without retrying the upload',async()=>{
 const f=workbookFixture({},false,true);
 await assert.rejects(archiveImportWorkbook(f.db as never,run,'Book.xlsx',Buffer.from('new')),/manifest del llibre està en modificació/);
 assert.equal(f.uploads,1);assert.equal(f.downloads,1);assert.equal(f.rpcs,1);
});


test('a concurrent identical import upload is verified and reused without a second upload',async()=>{
 const f=fixture({racedUpload:true});const result=await archiveImportedRow(f.db as never,id,run,row,workbook);
 assert.equal(f.uploads,1);assert.equal(f.downloads,1);assert.equal(f.rpcs,1);assert.equal(sha256(f.objects.get(result.path)!),result.sha256);
});
