import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractDocument} from '../lib/cloud/documents';
import type {Context} from '../lib/cloud/context';
import {sha256,sourcePath,ArchivedSourceUnavailableError,SOURCE_BUCKET} from '../lib/source-storage';

const bytes=Buffer.from('<html><body>Document sintètic arxivat amb prou contingut per verificar la recuperació íntegra de la font original.</body></html>');
const digest=sha256(bytes);
const legacyDigest=sha256(Buffer.from(bytes.toString('base64')));
const canonicalPath=sourcePath('record','doc',digest,'text/html',bytes);

function fixture(original:{path:string;mime:string;hash:string},canonical:boolean,storedBytes=bytes){
 const journal=new Map<string,unknown>([['original:doc',original]]);
 const source={id:'doc',source_record_id:'record',url:'https://unused.invalid/source',content_hash:canonical?digest:legacyDigest,storage_path:canonical?canonicalPath:null,storage_sha256:canonical?digest:null,mime_type:'text/html',extracted_text:null};
 const objects=new Map<string,Buffer>([[original.path,storedBytes]]);
 const downloads:string[]=[];
 const uploads:string[]=[];
 const db={
  storage:{from:(bucket:string)=>{
   assert.equal(bucket,SOURCE_BUCKET);
   return {
    list:async(directory:string,{search}:{search:string})=>({data:objects.has(`${directory}/${search}`)?[{name:search}]:[],error:null}),
    download:async(path:string)=>{
     downloads.push(path);
     const value=objects.get(path);
     return value?{data:new Blob([Uint8Array.from(value)]),error:null}:{data:null,error:Error('not found')};
    },
    upload:async(path:string,value:Buffer,{upsert}:{upsert:boolean})=>{
     assert.equal(upsert,false);
     uploads.push(path);objects.set(path,Buffer.from(value));
     return {data:{path},error:null};
    },
   };
  }},
  rpc:async(name:string,args:Record<string,unknown>)=>{
   if(name==='cloud_checkpoint')journal.set(String(args.p_key),args.p_value);
   return {data:true,error:null};
  },
  from:(table:string)=>{
   let key='';
   const q={
    select:()=>q,
    eq:(column:string,value:string)=>{if(column==='item_key')key=value;return q;},
    update:(value:Record<string,unknown>)=>{Object.assign(source,value);return q;},
    single:async()=>({data:table==='source_documents'?source:null,error:null}),
    maybeSingle:async()=>({data:journal.has(key)?{value:journal.get(key)}:null,error:null}),
   };
   return q;
  },
 };
 return {context:{db,task:'task',owner:'owner',generation:1} as unknown as Context,downloads,uploads,journal,objects};
}

test('document continuation downloads a canonical checkpoint source only once',async()=>{
 const f=fixture({path:canonicalPath,mime:'text/html',hash:digest},true);
 const result=await extractDocument(f.context,'job','doc','https://unused.invalid/source',false);
 assert.equal(result.method,'html-basic');
 assert.match(result.text,/recuperació íntegra/);
 assert.deepEqual(f.downloads,[canonicalPath]);
 assert.deepEqual(f.uploads,[]);
});

test('legacy base64-hash checkpoints recover identical bytes into canonical storage',async()=>{
 const legacyPath=`task/doc/${legacyDigest}`;
 const f=fixture({path:legacyPath,mime:'text/html',hash:legacyDigest},false);
 const result=await extractDocument(f.context,'job','doc','https://unused.invalid/source',false);
 assert.equal(result.method,'html-basic');
 assert.deepEqual(f.downloads,[legacyPath,canonicalPath]);
 assert.deepEqual(f.uploads,[canonicalPath]);
 assert.deepEqual(f.objects.get(legacyPath),bytes);
 assert.deepEqual(f.objects.get(canonicalPath),bytes);
});

test('corrupt legacy checkpoint bytes are rejected before archiving or extraction',async()=>{
 const legacyPath=`task/doc/${legacyDigest}`;
 const f=fixture({path:legacyPath,mime:'text/html',hash:legacyDigest},false,Buffer.from('corrupt source'));
 await assert.rejects(extractDocument(f.context,'job','doc','https://unused.invalid/source',false),ArchivedSourceUnavailableError);
 assert.deepEqual(f.downloads,[legacyPath]);
 assert.deepEqual(f.uploads,[]);
 assert.equal(f.journal.size,1);
});
