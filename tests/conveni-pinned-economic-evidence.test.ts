import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyPinnedEconomicEvidence} from '../lib/convenis/pinned-archive';
import {ARCHIVE_REQUEST_MAX_BYTES} from '../lib/convenis/archive-verification';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const bytes=Buffer.from('synthetic supporting document');
const digest=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
function archive(document:number,body:Uint8Array=bytes){
 const hash=digest(body),documentId=id(document);
 return {documentId,source:{path:`cases/${id(1)}/documents/${documentId}/${hash}.pdf`,sha256:hash,object_id:id(document+10),version:id(document+20)},
  copy:{path:`cases/${id(1)}/items/${id(2)}/documents/${documentId}/${hash}.pdf`,sha256:hash,object_id:id(document+30),version:id(document+40)}};
}
const citation=(n:number)=>({document_id:id(n),page:1,quote:'Fragment sintètic'});
const request={storageUrl:'https://fixture.invalid',serviceKey:'fixture-key',recordId:id(1),unitId:id(2),
 monetaryCitation:citation(3),identityCitation:citation(4),rolePeriodCitation:citation(5),archives:[archive(3),archive(4),archive(5)]};

test('reads pinned source and copy for each distinct citation document',async()=>{
 const urls:string[]=[];
 const fetcher:typeof fetch=async(url)=>{urls.push(String(url));return new Response(bytes);};
 const result=await verifyPinnedEconomicEvidence({...request,fetcher});
 assert.equal(urls.length,6);
 assert.equal(result.documents.length,3);
 assert.equal(result.totalBytes,bytes.length*6);
 for(const doc of request.archives){
  assert.ok(urls.some(url=>url.includes(doc.source.path)&&url.includes(`versionId=${doc.source.version}`)));
  assert.ok(urls.some(url=>url.includes(doc.copy.path)&&url.includes(`versionId=${doc.copy.version}`)));
 }
 assert.equal('approved' in result,false);
});

test('reads a document once when multiple citations use it',async()=>{
 let calls=0;
 const result=await verifyPinnedEconomicEvidence({...request,identityCitation:citation(3),rolePeriodCitation:citation(3),archives:[archive(3)],
  fetcher:async()=>{calls++;return new Response(bytes);}});
 assert.equal(calls,2);assert.equal(result.documents.length,1);
});

test('rejects missing, extra, duplicated or mismatched documents before any read',async()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;return new Response(bytes);};
 for(const archives of [[archive(3),archive(4)],[...request.archives,archive(6)],
  [archive(3),archive(3),archive(5)],[archive(3),archive(4),{...archive(5),copy:archive(4).copy}]]){
  await assert.rejects(()=>verifyPinnedEconomicEvidence({...request,archives,fetcher}));
 }
 assert.equal(calls,0);
});

test('rejects the same object identifier with different UUID capitalization',async()=>{
 let calls=0;const shared='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const first=archive(3),second=archive(4);
 first.source.object_id=shared;second.source.object_id=shared.toUpperCase();
 await assert.rejects(()=>verifyPinnedEconomicEvidence({...request,archives:[first,second,archive(5)],
  fetcher:async()=>{calls++;return new Response(bytes);}}),/duplicades/);
 assert.equal(calls,0);
});

test('fails closed if any cited document or its copy changes',async()=>{
 for(const failAt of [0,1,2,3,4,5]){
  let calls=0;
  await assert.rejects(()=>verifyPinnedEconomicEvidence({...request,fetcher:async()=>new Response(calls++===failAt?'wrong bytes':bytes)}),/integritat/);
  assert.equal(calls,failAt+1);
 }
});

test('enforces one aggregate byte budget across all cited documents and copies',async()=>{
 const large=Buffer.alloc(Math.floor(ARCHIVE_REQUEST_MAX_BYTES/5)+1,7);
 const archives=[archive(3,large),archive(4,large),archive(5,large)];let calls=0;
 await assert.rejects(()=>verifyPinnedEconomicEvidence({...request,archives,fetcher:async()=>{calls++;return new Response(large);}}),/límit de bytes/);
 assert.equal(calls,5);
});

test('does not start reads after cancellation',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(()=>verifyPinnedEconomicEvidence({...request,signal:controller.signal,fetcher:async()=>{calls++;return new Response(bytes);}}),/interrompuda/);
 assert.equal(calls,0);
});


test('verifies original and copy for an additional reviewed annex and rejects omissions',async()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;return new Response(bytes);};
 const additionalCitations=[citation(6)],archives=[...request.archives,archive(6)];
 const verified=await verifyPinnedEconomicEvidence({...request,additionalCitations,archives,fetcher});
 assert.equal(verified.documents.length,4);assert.equal(calls,8);calls=0;
 await assert.rejects(()=>verifyPinnedEconomicEvidence({...request,additionalCitations,fetcher}));
 assert.equal(calls,0);
});
