import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {archiveSource,archiveUnitSource,readSource,sha256,sourcePath,itemSourcePath,SOURCE_BUCKET,ArchivedSourceUnavailableError,SourceContentChangedError} from '../lib/source-storage';

const bytes=Buffer.from('%PDF-synthetic immutable source');
const mimeType='application/pdf';
const digest=sha256(bytes);
const path=sourcePath('record','document',digest,mimeType,bytes);
const document={id:'document',source_record_id:'record',url:'https://unused.invalid/document',storage_path:path,storage_sha256:digest,mime_type:mimeType};

function fixture(initial:Record<string,Buffer>={},corruptUpload=false){
 const objects=new Map(Object.entries(initial));
 const downloads:string[]=[];
 const uploads:{path:string;upsert:boolean}[]=[];
 const updates:{table:string;value:Record<string,unknown>}[]=[];
 const copies:{from:string;to:string}[]=[];
 const storage={
  list:async(directory:string,{search}:{search:string})=>({data:[...objects.keys()].filter(key=>key===`${directory}/${search}`).map(key=>({name:key.slice(directory.length+1)})),error:null}),
  download:async(key:string)=>{
   downloads.push(key);
   const value=objects.get(key);
   return value?{data:new Blob([Uint8Array.from(value)]),error:null}:{data:null,error:Error('not found')};
  },
  upload:async(key:string,value:Buffer,{upsert}:{upsert:boolean})=>{
   uploads.push({path:key,upsert});
   if(objects.has(key))return {data:null,error:Error('already exists')};
   objects.set(key,corruptUpload?Buffer.from('corrupt upload'):Buffer.from(value));
   return {data:{path:key},error:null};
  },
  copy:async(from:string,to:string)=>{
   copies.push({from,to});
   const value=objects.get(from);
   if(!value)return {data:null,error:Error('missing source')};
   objects.set(to,Buffer.from(value));
   return {data:{path:to},error:null};
  },
 };
 const db={
  storage:{from:(bucket:string)=>{assert.equal(bucket,SOURCE_BUCKET);return storage;}},
  from:(table:string)=>{
   const q={
    update:(value:Record<string,unknown>)=>{updates.push({table,value});return q;},
    eq:()=>q,select:()=>q,
    single:async()=>({data:table==='record_units'?{id:'unit',source_record_id:'record',document_id:'document'}:document,error:null}),
   };
   return q;
  },
 } as unknown as SupabaseClient;
 return {db,objects,downloads,uploads,updates,copies};
}

test('serving an archived source uses one verified download and no writes',async()=>{
 const f=fixture({[path]:bytes});
 const result=await readSource(f.db,document);
 assert.deepEqual(result,{path,sha256:digest,mimeType,bytes});
 assert.deepEqual(f.downloads,[path]);
 assert.deepEqual(f.uploads,[]);
 assert.deepEqual(f.updates,[]);
});

test('archiveSource preserves its metadata-only contract',async()=>{
 const f=fixture({[path]:bytes});
 assert.deepEqual(await archiveSource(f.db,document),{path,sha256:digest,mimeType});
 assert.deepEqual(f.downloads,[path]);
});

test('new source is read back once after immutable upload before publishing its pointer',async()=>{
 const f=fixture();
 const result=await readSource(f.db,{...document,storage_path:null,storage_sha256:null},{bytes,mimeType});
 assert.deepEqual(result.bytes,bytes);
 assert.deepEqual(f.uploads,[{path,upsert:false}]);
 assert.deepEqual(f.downloads,[path]);
 assert.equal(f.updates.length,1);
 assert.equal(f.updates[0].value.storage_sha256,digest);
 assert.equal(f.updates[0].value.storage_path,path);
});

test('a corrupted stored source is rejected without overwrite or metadata changes',async()=>{
 const f=fixture({[path]:Buffer.from('corrupt object')});
 await assert.rejects(readSource(f.db,document),ArchivedSourceUnavailableError);
 assert.deepEqual(f.downloads,[path]);
 assert.deepEqual(f.uploads,[]);
 assert.deepEqual(f.updates,[]);
});

test('post-upload corruption is rejected before the DB pointer is updated',async()=>{
 const f=fixture({},true);
 await assert.rejects(readSource(f.db,{...document,storage_path:null,storage_sha256:null},{bytes,mimeType}),ArchivedSourceUnavailableError);
 assert.deepEqual(f.downloads,[path]);
 assert.deepEqual(f.updates,[]);
});

test('a missing archived object is recovered with identical bytes and read-back verification',async()=>{
 const f=fixture();
 const result=await readSource(f.db,document,{bytes,mimeType});
 assert.deepEqual(result.bytes,bytes);
 assert.equal(result.path,path);
 assert.deepEqual(f.uploads,[{path,upsert:false}]);
 assert.deepEqual(f.downloads,[path]);
});

test('recovery cannot silently replace the hash of a missing archived object',async()=>{
 const f=fixture();
 await assert.rejects(readSource(f.db,document,{bytes:Buffer.from('%PDF-changed'),mimeType}),SourceContentChangedError);
 assert.deepEqual(f.uploads,[]);
 assert.deepEqual(f.updates,[]);
});

test('historical content hashes still reject changed sources before storage writes',async()=>{
 const f=fixture();
 await assert.rejects(readSource(f.db,{...document,storage_path:null,storage_sha256:null,content_hash:digest},{bytes:Buffer.from('%PDF-changed'),mimeType}),SourceContentChangedError);
 assert.deepEqual(f.uploads,[]);
 assert.deepEqual(f.updates,[]);
});

test('per-unit immutable copies are retained and verified independently',async()=>{
 const f=fixture({[path]:bytes});
 const unitPath=itemSourcePath('record','unit','document',path);
 const result=await archiveUnitSource(f.db,'record','unit');
 assert.deepEqual(f.copies,[{from:path,to:unitPath}]);
 assert.deepEqual(f.downloads,[path,unitPath]);
 assert.deepEqual(f.objects.get(unitPath),bytes);
 assert.deepEqual(result,{path:unitPath,sha256:digest,documentId:'document'});
 assert.equal(f.updates[0].table,'record_units');
});
