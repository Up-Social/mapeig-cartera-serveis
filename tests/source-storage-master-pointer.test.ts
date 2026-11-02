import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {archiveHistoricalMasterRow,SourceContentChangedError,sha256} from '../lib/source-storage';

const id='11111111-1111-4111-8111-111111111111',bookBytes=Buffer.from('synthetic workbook'),bookSha=sha256(bookBytes);
const row={id,source_file:'Master.xlsx',source_sheet:'Services',source_row:4,source_payload:{name:'Original'},source_payload_hash:'original-hash'};
const book={path:`imports/legacy/${bookSha}.xlsx`,sha256:bookSha};
function fixture(options:{race?:boolean;missing?:boolean;lost?:boolean}={}){
 const current={...structuredClone(row),storage_path:null as string|null,storage_sha256:null as string|null};
 const objects=new Map<string,Buffer>([[book.path,bookBytes]]);let uploads=0,rpcs=0;
 const db={
  from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:options.missing?null:{storage_path:current.storage_path,storage_sha256:current.storage_sha256},error:null})};return q;},
  storage:{from:()=>({
   list:async(dir:string,{search}:{search:string})=>({data:objects.has(`${dir}/${search}`)?[{name:search}]:[],error:null}),
   upload:async(path:string,bytes:Buffer)=>{uploads++;objects.set(path,Buffer.from(bytes));return options.lost?{data:null,error:Error('response lost')}:{data:{path},error:null};},
   download:async(path:string)=>{const bytes=objects.get(path);if(options.race&&path!==book.path)current.source_payload.name='Changed';return bytes?{data:new Blob([Uint8Array.from(bytes)]),error:null}:{data:null,error:Error('missing')};},
  })},
  rpc:async(name:string,args:Record<string,unknown>)=>{
   assert.equal(name,'publish_historical_master_source');rpcs++;
   const expected={source_file:current.source_file,source_sheet:current.source_sheet,source_row:current.source_row,source_payload:current.source_payload,source_payload_hash:current.source_payload_hash};
   if(!isDeepStrictEqual(args.p_expected,expected))return {data:false,error:null};
   if(args.p_path===current.storage_path&&args.p_sha256===current.storage_sha256)return {data:true,error:null};
   if(!isDeepStrictEqual(args.p_previous,{storage_path:current.storage_path,storage_sha256:current.storage_sha256})||current.storage_path!==null||current.storage_sha256!==null)return {data:false,error:null};
   current.storage_path=String(args.p_path);current.storage_sha256=String(args.p_sha256);return {data:true,error:null};
  },
 };
 return {db,current,objects,get uploads(){return uploads;},get rpcs(){return rpcs;}};
}

test('historical Master pointer is verified and exact replay retains one object',async()=>{
 const f=fixture({lost:true});const result=await archiveHistoricalMasterRow(f.db as never,row,book);
 assert.equal(sha256(f.objects.get(result.path)!),result.sha256);assert.equal(f.current.storage_path,result.path);
 await archiveHistoricalMasterRow(f.db as never,row,book);assert.equal(f.uploads,1);assert.equal(f.rpcs,2);
});
test('a changed source payload or an absent Master row never publishes a pointer',async()=>{
 const changed=fixture({race:true});await assert.rejects(archiveHistoricalMasterRow(changed.db as never,row,book),SourceContentChangedError);
 assert.equal(changed.current.storage_path,null);assert.equal(changed.rpcs,1);
 const missing=fixture({missing:true});await assert.rejects(archiveHistoricalMasterRow(missing.db as never,row,book),SourceContentChangedError);
 assert.equal(missing.uploads,0);assert.equal(missing.rpcs,0);
});
test('a prior different historical Master archive is never replaced',async()=>{
 const f=fixture();f.current.storage_path='references/master/items/old/source/archive.json';f.current.storage_sha256='b'.repeat(64);
 await assert.rejects(archiveHistoricalMasterRow(f.db as never,row,book),SourceContentChangedError);
 assert.equal(f.uploads,0);assert.equal(f.rpcs,0);
});
test('a missing or corrupted historical workbook cannot establish row provenance',async()=>{
 for(const missing of [true,false]){
  const f=fixture();if(missing)f.objects.delete(book.path);else f.objects.set(book.path,Buffer.from('different workbook'));
  await assert.rejects(archiveHistoricalMasterRow(f.db as never,row,book));
  assert.equal(f.uploads,0);assert.equal(f.rpcs,0);assert.equal(f.current.storage_path,null);
 }
});
