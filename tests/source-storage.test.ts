import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {archiveSource,archiveUnitSource,createUnitSourceVerificationCache,readSource,sha256,sourcePath,itemSourcePath,SOURCE_BUCKET,ArchivedSourceUnavailableError,SourceContentChangedError} from '../lib/source-storage';

const bytes=Buffer.from('%PDF-synthetic immutable source');
const mimeType='application/pdf';
const digest=sha256(bytes);
const path=sourcePath('record','document',digest,mimeType,bytes);
const document={id:'document',source_record_id:'record',url:'https://unused.invalid/document',storage_path:path,storage_sha256:digest,mime_type:mimeType};

function fixture(initial:Record<string,Buffer>={},corruptUpload=false,failFirstUpdate?:string,emptyFirstUpdate?:string,movedDocument=false,movedSource=false,existingUnit?:{storage_path:string;storage_sha256:string},movedUrl=false,movedContent=false,sourceChangedDuringCopy=false,copyFailure?:'created'|'corrupt'|'missing'){
 const objects=new Map(Object.entries(initial));
 const downloads:string[]=[];
 const uploads:{path:string;upsert:boolean}[]=[];
 const updates:{table:string;value:Record<string,unknown>}[]=[];
 const updateFilters:Record<string,unknown>[]=[];
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
   if(copyFailure){if(copyFailure!=='missing')objects.set(to,copyFailure==='created'?Buffer.from(value):Buffer.from('corrupt unit'));return {data:null,error:Error('copy response failed')};}
   objects.set(to,Buffer.from(value));
   return {data:{path:to},error:null};
  },
 };
 const db={
  rpc:async(name:string,args:Record<string,unknown>)=>{
   assert.equal(name,'publish_unit_source');
   updates.push({table:'record_units',value:{storage_path:args.p_new_path,storage_sha256:args.p_new_sha256}});
   if(failFirstUpdate==='record_units'){failFirstUpdate=undefined;return {data:null,error:Error('pointer update interrupted')};}
   if(emptyFirstUpdate==='record_units'){emptyFirstUpdate=undefined;return {data:null,error:null};}
   if(movedDocument)return {data:null,error:null};
   if(sourceChangedDuringCopy)return {data:null,error:Error('SOURCE_REVISION_CHANGED')};
   return {data:'unit',error:null};
  },
  storage:{from:(bucket:string)=>{assert.equal(bucket,SOURCE_BUCKET);return storage;}},
  from:(table:string)=>{
   let update=false;const filters:Record<string,unknown>={};
   const result=()=>{
    if(update&&failFirstUpdate===table){failFirstUpdate=undefined;return {data:null,error:Error('pointer update interrupted')};}
    if(update&&emptyFirstUpdate===table){emptyFirstUpdate=undefined;return {data:null,error:null};}
    if(update&&table==='record_units'&&movedDocument&&filters.document_id==='document')return {data:null,error:null};
    if(update&&table==='source_documents'&&movedSource&&filters.storage_path===null)return {data:null,error:null};
    if(update&&table==='source_documents'&&movedUrl&&filters.url===document.url)return {data:null,error:null};
    if(update&&table==='source_documents'&&movedContent&&filters.content_hash===null)return {data:null,error:null};
    return {data:table==='record_units'?{id:'unit',source_record_id:'record',document_id:'document',...existingUnit}:document,error:null};
   };
   const q={
    update:(value:Record<string,unknown>)=>{update=true;updates.push({table,value});return q;},
    eq:(field:string,value:unknown)=>{filters[field]=value;return q;},is:(field:string,value:unknown)=>{filters[field]=value;return q;},select:()=>q,
    single:async()=>{if(update)updateFilters.push({...filters});return result();},
    then:(resolve:(value:ReturnType<typeof result>)=>unknown)=>Promise.resolve(result()).then(resolve),
   };
   return q;
  },
 } as unknown as SupabaseClient;
 return {db,objects,downloads,uploads,updates,copies,updateFilters};
}

test('serving an archived source uses one verified download and no writes',async()=>{
 const f=fixture({[path]:bytes});
 const result=await readSource(f.db,document);
 assert.deepEqual(result,{path,sha256:digest,mimeType,bytes});
 assert.deepEqual(f.downloads,[path]);
 assert.deepEqual(f.uploads,[]);
 assert.deepEqual(f.updates,[]);
});
test('a caller without pointer metadata reloads the current archive before writing',async()=>{
 const f=fixture({[path]:bytes});
 const bare={id:document.id,source_record_id:document.source_record_id,url:document.url};
 await assert.rejects(readSource(f.db,bare,{bytes:Buffer.from('%PDF-other'),mimeType}),SourceContentChangedError);
 const result=await readSource(f.db,bare,{bytes,mimeType});
 assert.equal(result.path,path);assert.deepEqual(result.bytes,bytes);
 assert.deepEqual(f.uploads,[]);assert.deepEqual(f.updates,[]);
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

test('archiving snapshots the caller bytes and MIME before asynchronous storage operations',async()=>{
 const f=fixture();
 const supplied={bytes:Buffer.from(bytes),mimeType};
 const storage=f.db.storage.from(SOURCE_BUCKET);
 const list=storage.list.bind(storage);
 storage.list=async (...args:Parameters<typeof storage.list>)=>{
  supplied.bytes.fill(0);supplied.mimeType='text/plain';
  return list(...args);
 };
 const result=await readSource(f.db,{...document,storage_path:null,storage_sha256:null},supplied);
 assert.equal(result.path,path);assert.equal(result.sha256,digest);assert.equal(result.mimeType,mimeType);
 assert.deepEqual(result.bytes,bytes);assert.deepEqual(f.objects.get(path),bytes);
 assert.equal(f.updates[0].value.mime_type,mimeType);
});

test('archiving binds its compare-and-swap to the source identity supplied at entry',async()=>{
 const f=fixture();
 const supplied={...document,storage_path:null,storage_sha256:null};
 const storage=f.db.storage.from(SOURCE_BUCKET);
 const list=storage.list.bind(storage);
 storage.list=async (...args:Parameters<typeof storage.list>)=>{
  supplied.url='https://different.invalid/document';
  return list(...args);
 };
 await readSource(f.db,supplied,{bytes,mimeType});
 assert.equal(f.updateFilters[0].url,document.url);
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

test('ambiguous existing pointers cannot be replaced, even with matching historical content',async()=>{
 const legacy=sha256(Buffer.from(bytes.toString('base64')));
 const cases=[
  {storage_path:'legacy/source.pdf',storage_sha256:digest,content_hash:null},
  {storage_path:'legacy/source.pdf',storage_sha256:digest,content_hash:digest},
  {storage_path:path,storage_sha256:null,content_hash:legacy},
  {storage_path:null,storage_sha256:digest,content_hash:digest},
  {storage_path:path,storage_sha256:'invalid',content_hash:null},
  {storage_path:'',storage_sha256:'',content_hash:null},
 ];
 for(const pointer of cases){
  const f=fixture();
  await assert.rejects(readSource(f.db,{...document,...pointer},{bytes,mimeType}),ArchivedSourceUnavailableError);
  assert.deepEqual(f.downloads,[]);assert.deepEqual(f.uploads,[]);assert.deepEqual(f.updates,[]);
 }
});

test('historic sources without a pointer can still be captured against their byte or base64 content hash',async()=>{
 for(const contentHash of [digest,sha256(Buffer.from(bytes.toString('base64')))]){
  const f=fixture();
  const result=await readSource(f.db,{...document,storage_path:null,storage_sha256:null,content_hash:contentHash},{bytes,mimeType});
  assert.equal(result.sha256,digest);assert.deepEqual(f.uploads,[{path,upsert:false}]);assert.equal(f.updates.length,1);
 }
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

test('a copy conflict or lost response reuses the target only after verifying its bytes',async()=>{
 const f=fixture({[path]:bytes},false,undefined,undefined,false,false,undefined,false,false,false,'created');
 const unitPath=itemSourcePath('record','unit','document',path);
 const result=await archiveUnitSource(f.db,'record','unit');
 assert.equal(result.path,unitPath);assert.deepEqual(f.downloads,[path,unitPath]);assert.equal(f.updates.length,1);
});
test('a failed copy never publishes an absent or corrupted concurrent target',async()=>{
 for(const state of ['missing','corrupt'] as const){
  const f=fixture({[path]:bytes},false,undefined,undefined,false,false,undefined,false,false,false,state);
  await assert.rejects(archiveUnitSource(f.db,'record','unit'));
  assert.equal(f.updates.length,0);
 }
});
test('a verified concurrent copy cannot bypass source revision checks',async()=>{
 const f=fixture({[path]:bytes},false,undefined,undefined,false,false,undefined,false,false,true,'created');
 await assert.rejects(archiveUnitSource(f.db,'record','unit'),/SOURCE_REVISION_CHANGED/);
 assert.deepEqual(f.objects.get(itemSourcePath('record','unit','document',path)),bytes);
});

test('a bounded pass verifies the original once but verifies each unit copy on every attempt',async()=>{
 const f=fixture({[path]:bytes});const cache=createUnitSourceVerificationCache();
 const unitPath=itemSourcePath('record','unit','document',path);
 await archiveUnitSource(f.db,'record','unit',cache);
 await archiveUnitSource(f.db,'record','unit',cache);
 assert.deepEqual(f.downloads,[path,unitPath,unitPath]);
 f.objects.set(unitPath,Buffer.from('corrupt unit'));
 await assert.rejects(archiveUnitSource(f.db,'record','unit',cache),ArchivedSourceUnavailableError);
 assert.equal(f.updates.length,2);
 // A resumed pass does not inherit verification from the earlier pass.
 f.objects.set(path,Buffer.from('corrupt original'));
 await assert.rejects(archiveUnitSource(f.db,'record','unit',createUnitSourceVerificationCache()),ArchivedSourceUnavailableError);
});

test('retry after an uploaded source loses its database pointer does not upload a second object',async()=>{
 const f=fixture({},false,'source_documents');
 const unarchived={...document,storage_path:null,storage_sha256:null};
 await assert.rejects(readSource(f.db,unarchived,{bytes,mimeType}),/pointer update interrupted/);
 assert.deepEqual(f.objects.get(path),bytes);
 assert.equal((await readSource(f.db,unarchived,{bytes,mimeType})).path,path);
 assert.deepEqual(f.uploads,[{path,upsert:false}]);
 assert.equal(f.updates.length,2);
});
test('a source pointer update affecting no document does not report success or duplicate upload',async()=>{
 const f=fixture({},false,undefined,'source_documents');
 const unarchived={...document,storage_path:null,storage_sha256:null};
 await assert.rejects(readSource(f.db,unarchived,{bytes,mimeType}),/No s’ha pogut vincular/);
 assert.equal((await readSource(f.db,unarchived,{bytes,mimeType})).path,path);
 assert.deepEqual(f.uploads,[{path,upsert:false}]);
});
test('a changed source pointer cannot be overwritten by an earlier concurrent archive',async()=>{
 const f=fixture({},false,undefined,undefined,false,true);
 await assert.rejects(readSource(f.db,{...document,storage_path:null,storage_sha256:null},{bytes,mimeType}),/No s’ha pogut vincular/);
 assert.deepEqual(f.objects.get(path),bytes);
 assert.deepEqual(f.uploads,[{path,upsert:false}]);
});
test('a source URL changed during capture cannot receive bytes from the old URL',async()=>{
 const f=fixture({},false,undefined,undefined,false,false,undefined,true);
 await assert.rejects(readSource(f.db,{...document,storage_path:null,storage_sha256:null},{bytes,mimeType}),/No s’ha pogut vincular/);
 assert.deepEqual(f.objects.get(path),bytes);
});
test('a content identity changed during capture cannot receive an obsolete pointer',async()=>{
 const f=fixture({},false,undefined,undefined,false,false,undefined,false,true);
 await assert.rejects(readSource(f.db,{...document,content_hash:null,storage_path:null,storage_sha256:null},{bytes,mimeType}),/No s’ha pogut vincular/);
 assert.deepEqual(f.objects.get(path),bytes);
});

test('retry after a copied unit loses its database pointer reuses and verifies the same object',async()=>{
 const f=fixture({[path]:bytes},false,'record_units');
 const unitPath=itemSourcePath('record','unit','document',path);
 await assert.rejects(archiveUnitSource(f.db,'record','unit'),/pointer update interrupted/);
 assert.deepEqual(f.objects.get(unitPath),bytes);
 assert.equal((await archiveUnitSource(f.db,'record','unit')).path,unitPath);
 assert.deepEqual(f.copies,[{from:path,to:unitPath}]);
 assert.equal(f.updates.filter(update=>update.table==='record_units').length,2);
});
test('a pointer update affecting no unit is not treated as an archived unit',async()=>{
 const f=fixture({[path]:bytes},false,undefined,'record_units');
 const unitPath=itemSourcePath('record','unit','document',path);
 await assert.rejects(archiveUnitSource(f.db,'record','unit'),/No s’ha pogut vincular/);
 assert.deepEqual(f.objects.get(unitPath),bytes);
 assert.equal((await archiveUnitSource(f.db,'record','unit')).path,unitPath);
 assert.deepEqual(f.copies,[{from:path,to:unitPath}]);
});
test('a unit moved to a different document during the copy cannot receive a stale pointer',async()=>{
 const f=fixture({[path]:bytes},false,undefined,undefined,true);
 await assert.rejects(archiveUnitSource(f.db,'record','unit'),/No s’ha pogut vincular/);
 assert.deepEqual(f.objects.get(itemSourcePath('record','unit','document',path)),bytes);
});
test('a previously archived unit is not silently repointed to a different source',async()=>{
 const f=fixture({[path]:bytes},false,undefined,undefined,false,false,{storage_path:'cases/record/items/unit/documents/document/'+('a'.repeat(64))+'.pdf',storage_sha256:'a'.repeat(64)});
 await assert.rejects(archiveUnitSource(f.db,'record','unit'),SourceContentChangedError);
 assert.deepEqual(f.copies,[]);assert.equal(f.updates.length,0);
});

test('existing archive rejects fresh bytes or a content hash from a different revision',async()=>{
 const f=fixture({[path]:bytes});const changed=Buffer.from('%PDF-new-revision');
 await assert.rejects(archiveSource(f.db,document,{bytes:changed,mimeType}),SourceContentChangedError);
 await assert.rejects(readSource(f.db,{...document,content_hash:sha256(changed)}),SourceContentChangedError);
 const historic=sha256(Buffer.from(bytes.toString('base64')));
 assert.equal((await readSource(f.db,{...document,content_hash:historic})).sha256,digest);
 assert.deepEqual(f.uploads,[]);assert.deepEqual(f.updates,[]);
});

test('a source revision changed during the copy cannot be published as current',async()=>{
 const f=fixture({[path]:bytes},false,undefined,undefined,false,false,undefined,false,false,true);
 await assert.rejects(archiveUnitSource(f.db,'record','unit'),/SOURCE_REVISION_CHANGED/);
 assert.deepEqual(f.objects.get(itemSourcePath('record','unit','document',path)),bytes);
});
