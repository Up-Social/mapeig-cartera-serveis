import {test} from 'node:test';
import assert from 'node:assert/strict';
import {refreshConcertSource} from '../lib/cloud/refresh-source';
import {sha256,SourceContentChangedError} from '../lib/source-storage';
import type {Context} from '../lib/cloud/context';

function fixture(options:{missingObject?:boolean;unarchived?:boolean}={}){
 const bytes=Buffer.from('Document original conservat');const digest=sha256(bytes),name=`${digest}.txt`;
 const path=`cases/record/documents/doc/${name}`;
 const source={id:'doc',source_record_id:'record',url:'https://example.invalid/document',storage_path:options.unarchived?null:path,storage_sha256:options.unarchived?null:digest,mime_type:'text/plain'};
 const journal=new Map<string,unknown>();let fetches=0;
 const objects=new Map<string,Buffer>(options.missingObject||options.unarchived?[]:[[path,bytes]]);
 const writes:Array<Record<string,unknown>>=[];
 const db={storage:{from:()=>({list:async()=>({data:objects.has(path)?[{name}]:[],error:null}),download:async(key:string)=>({data:objects.has(key)?new Blob([Uint8Array.from(objects.get(key)!)]):null,error:null}),upload:async(key:string,contents:Buffer)=>{objects.set(key,Buffer.from(contents));return {data:{path:key},error:null};}})},
  from:()=>{let key='';const q={select:()=>q,eq:(field:string,value:string)=>{if(field==='item_key')key=value;return q;},is:()=>q,update:(values:Record<string,unknown>)=>{writes.push(values);return q;},single:async()=>({data:{id:source.id},error:null}),maybeSingle:async()=>({data:journal.has(key)?{value:journal.get(key)}:null,error:null})};return q;},
  rpc:async(_name:string,args:Record<string,unknown>)=>{journal.set(String(args.p_key),args.p_value);return {data:true,error:null};}};
 const c={db,task:'task',owner:'owner',generation:1} as unknown as Context;
 const fetcher=async()=>{fetches++;return {bytes,mimeType:'text/plain',finalUrl:source.url,status:200};};
 return {source,c,journal,fetcher,fetches:()=>fetches,objects,writes,path,digest};
}
test('full refresh downloads once despite an existing archive, then resumes the same task identity',async()=>{
 const f=fixture();assert.equal((await refreshConcertSource(f.c,f.source,f.fetcher)).sha256,f.source.storage_sha256);
 await refreshConcertSource(f.c,f.source,f.fetcher);assert.equal(f.fetches(),1);
 await assert.rejects(refreshConcertSource(f.c,{...f.source,storage_sha256:'b'.repeat(64)},f.fetcher),/validation/);
 assert.equal(f.fetches(),1);
});
test('changed public bytes do not overwrite the previous archive or checkpoint success',async()=>{
 const f=fixture();await assert.rejects(refreshConcertSource(f.c,f.source,async()=>({bytes:Buffer.from('Document canviat'),mimeType:'text/plain',finalUrl:f.source.url,status:200})),SourceContentChangedError);
 assert.equal(f.journal.size,0);
});
test('unavailable fresh source is reported, never silently reused as a completed refresh',async()=>{
 const f=fixture();await assert.rejects(refreshConcertSource(f.c,f.source,async()=>{throw Error('network');}),/document/);
 assert.equal(f.journal.size,0);
});
test('a missing archived object is restored only with the original byte identity',async()=>{
 const f=fixture({missingObject:true});
 const result=await refreshConcertSource(f.c,f.source,f.fetcher);
 assert.equal(result.path,f.path);assert.equal(result.sha256,f.digest);
 assert.equal(sha256(f.objects.get(f.path)!),f.digest);
 assert.equal(f.fetches(),1);assert.equal(f.writes.length,1);
 const changed=fixture({missingObject:true});
 await assert.rejects(refreshConcertSource(changed.c,changed.source,async()=>({bytes:Buffer.from('Changed'),mimeType:'text/plain',finalUrl:changed.source.url,status:200})),SourceContentChangedError);
 assert.equal(changed.objects.size,0);assert.equal(changed.writes.length,0);assert.equal(changed.journal.size,0);
});
test('a newly discovered source receives a canonical copy before its refresh is checkpointed',async()=>{
 const f=fixture({unarchived:true});
 const result=await refreshConcertSource(f.c,f.source,f.fetcher);
 assert.deepEqual(result,{url:f.source.url,sha256:f.digest,path:f.path});
 assert.equal(f.writes[0]?.storage_path,f.path);assert.equal(f.writes[0]?.storage_sha256,f.digest);
 await refreshConcertSource(f.c,{...f.source,storage_path:f.path,storage_sha256:f.digest},f.fetcher);
 assert.equal(f.fetches(),1);assert.equal(f.writes.length,1);
});
