import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyPinnedEconomicEvidence,verifyPinnedUnitCopy} from '../../lib/convenis/pinned-archive';

// This file is called only by the disposable-container harness. The endpoint
// is loopback, the token is synthetic, and no existing project is accessed.
const port=process.env.T17_STORAGE_PORT;
const db=process.env.T17_STORAGE_DB;
const secret=process.env.T17_FIXTURE_SECRET;
if(!port||!/^\d+$/.test(port)||!db||!/^mapeig-t17-[a-f0-9]{12}-db$/.test(db)||!secret?.startsWith('isolated-fixture-'))throw Error('Isolated Storage fixture required');
const root=`http://127.0.0.1:${port}`;
const encode=(v:object)=>Buffer.from(JSON.stringify(v)).toString('base64url');
const header=encode({alg:'HS256',typ:'JWT'}),payload=encode({role:'service_role',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600});
const token=`${header}.${payload}.`+createHmac('sha256',secret).update(`${header}.${payload}`).digest('base64url');
const record='00000000-0000-4000-8000-000000000001',unit='00000000-0000-4000-8000-000000000002',document='00000000-0000-4000-8000-000000000003';
const original=Buffer.from('synthetic original document'),altered=Buffer.from('synthetic replacement document');
const sha=createHash('sha256').update(original).digest('hex');
const sourcePath=`cases/${record}/documents/${document}/${sha}.pdf`;
const copyPath=`cases/${record}/items/${unit}/documents/${document}/${sha}.pdf`;
const auth={authorization:`Bearer ${token}`};

async function request(path:string,init:RequestInit={}):Promise<Response>{
 return fetch(root+path,{...init,redirect:'error',headers:{...auth,...init.headers}});
}
async function upload(path:string,body:Buffer){
 const response=await request(`/object/cloud-documents/${path}`,{method:'POST',headers:{'content-type':'application/octet-stream','x-upsert':'true'},body:Uint8Array.from(body)});
 assert.equal(response.status,200,`fixture upload failed: ${response.status}`);
}
async function remove(path:string){
 const response=await request('/object/cloud-documents',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({prefixes:[path]})});
 assert.equal(response.status,200,`fixture delete failed: ${response.status}`);
}
function receipt(path:string){
 // path derives exclusively from constants and a SHA-256 generated above.
 const sql=`select id||','||version from storage.objects where bucket_id='cloud-documents' and name='${path}' and archived_at is null`;
 const output=execFileSync('docker',['exec',db!,'psql','-U','postgres','-d','postgres','-Atc',sql],{encoding:'utf8'}).trim();
 const [object_id,version]=output.split(',');assert.ok(object_id&&version,`missing fixture metadata for ${path}`);
 return {path,sha256:sha,object_id,version};
}
// Storage is exposed directly in this fixture; production goes through a gateway.
const transport:typeof fetch=(url,options)=>{const u=new URL(String(url));if(u.origin!==root)throw Error('Non-fixture origin rejected');u.pathname=u.pathname.replace(/^\/storage\/v1/,'');return fetch(u,options);};
async function main(){
 let ready=false;
 for(let i=0;i<120;i++){
  try{await fetch(root+'/status',{redirect:'error'});ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,500));}
 }
 if(!ready)throw Error('isolated Storage did not start');
 const bucket=await request('/bucket',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'cloud-documents',name:'cloud-documents',public:false})});
 assert.equal(bucket.status,200,`fixture bucket failed: ${bucket.status}`);
 await upload(sourcePath,original);await upload(copyPath,original);
 let source=receipt(sourcePath),copy=receipt(copyPath);
 const base={storageUrl:root,serviceKey:token,recordId:record,unitId:unit,monetaryCitation:{document_id:document,page:1,quote:'Cita sintètica'},source,copy,fetcher:transport};
 const first=await verifyPinnedUnitCopy(base);
 assert.equal(first.sourceBytes,original.length);assert.equal(first.copyBytes,original.length);

 // Identity and role/period may appear in different documents. Each must
 // have its own pinned source and unit copy; the two former citations may
 // also share a document, which must not cause duplicate downloads.
 const identityDoc='00000000-0000-4000-8000-000000000004',roleDoc='00000000-0000-4000-8000-000000000005';
 const paths=(id:string)=>({source:`cases/${record}/documents/${id}/${sha}.pdf`,copy:`cases/${record}/items/${unit}/documents/${id}/${sha}.pdf`});
 const identityPaths=paths(identityDoc),rolePaths=paths(roleDoc);
 for(const path of [identityPaths.source,identityPaths.copy,rolePaths.source,rolePaths.copy])await upload(path,original);
 const multi={storageUrl:root,serviceKey:token,recordId:record,unitId:unit,monetaryCitation:base.monetaryCitation,
  identityCitation:{document_id:identityDoc,page:1,quote:'Identitat sintètica'},rolePeriodCitation:{document_id:roleDoc,page:1,quote:'Període sintètic'},
  archives:[{documentId:document,source,copy},{documentId:identityDoc,source:receipt(identityPaths.source),copy:receipt(identityPaths.copy)},
   {documentId:roleDoc,source:receipt(rolePaths.source),copy:receipt(rolePaths.copy)}],fetcher:transport};
 const all=await verifyPinnedEconomicEvidence(multi);
 assert.equal(all.documents.length,3);assert.equal(all.totalBytes,original.length*6);
 await upload(rolePaths.copy,altered);
 await assert.rejects(()=>verifyPinnedEconomicEvidence(multi));
 await assert.rejects(()=>verifyPinnedEconomicEvidence({...multi,archives:multi.archives.slice(0,2)}));

 await upload(copyPath,altered);
 const alteredCopy=receipt(copyPath);
 assert.notEqual(alteredCopy.version,copy.version);
 await assert.rejects(()=>verifyPinnedUnitCopy(base));
 await assert.rejects(()=>verifyPinnedUnitCopy({...base,copy:alteredCopy}),/integritat/);
 await upload(copyPath,original);copy=receipt(copyPath);
 await verifyPinnedUnitCopy({...base,copy});

 await remove(sourcePath);
 await assert.rejects(()=>verifyPinnedUnitCopy({...base,copy}));
 await upload(sourcePath,original);
 const recreated=receipt(sourcePath);
 assert.ok(recreated.object_id!==source.object_id||recreated.version!==source.version,'recreated object retained both identities');
 await assert.rejects(()=>verifyPinnedUnitCopy({...base,copy}));
 source=recreated;
 await verifyPinnedUnitCopy({...base,source,copy});
 await assert.rejects(()=>verifyPinnedUnitCopy({...base,source,copy,serviceKey:'invalid-fixture-key'}));

 let calls=0;
 const lostResponse:typeof fetch=async(url,options)=>{
  calls++;const response=await transport(url,options);await response.body?.cancel();throw Error('synthetic lost response');
 };
 await assert.rejects(()=>verifyPinnedUnitCopy({...base,source,copy,fetcher:lostResponse}),/synthetic lost response/);
 assert.equal(calls,1);assert.deepEqual(receipt(sourcePath),source);assert.deepEqual(receipt(copyPath),copy);
 console.log('PASS: pinned source and copy, three-document evidence set, replacement, deletion/recreation, invalid auth and lost read response on disposable Storage.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
