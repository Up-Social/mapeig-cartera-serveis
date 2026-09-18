import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveOfficialDocuments} from '../lib/pipeline/official-resolution';
import {isPrivateAddress} from '../lib/pipeline/document-input';
const caseId='aaaaaaaa-0000-4000-8000-000000000001';
const source=`https://contractaciopublica.cat/ca/detall-publicacio/${caseId}/20`;
test('PSCP follows official phase relation and binds the technical document to the same case',async()=>{
 const requests:string[]=[];
 const result=await resolveOfficialDocuments(source,async url=>{requests.push(url);const id=url.endsWith('/20')?20:10;return {expedientId:caseId,publicacioId:id,codiExpedient:'FIXTURE',navegacioFases:[{fase:1000040,publicacioId:10}],dades:id===10?{plecsDePrescripcionsTecniques:{docs:[{id:123,hash:'A'.repeat(32),titol:'Plec fictici.pdf'}]}}:{}};});
 assert.equal(requests.length,2);assert.equal(result[0].document_type,'technical_specifications');assert.equal(result[0].case_id,caseId);assert.match(result[0].resolved_url,/123\/A{32}$/);
});
test('mismatched cases, broken endpoints and JS-only responses never invent document URLs',async()=>{
 for(const read of [async()=>({expedientId:'other',publicacioId:20}),async()=>{throw Error('404');},async()=>({html:'<app-root/>'})]){
  const [r]=await resolveOfficialDocuments(source,read);assert.equal(r.result,'unresolved');assert.equal(r.resolved_url,source);
 }
});
test('e-Tauler retains stable document references and officially linked annexes',async()=>{
 const [doc,annex]=await resolveOfficialDocuments('https://tauler.seu-e.cat/detall?idEns=1&idEdicte=22',async()=>({id_edicte:'22',documents:[{uuidEdicte:caseId}],adjunts:[{uuid:'bbbbbbbb-0000-4000-8000-000000000001'},{url:'http://127.0.0.1/private'}]}));
 assert.match(doc.resolved_url,/\/info\?ens=1$/);assert.equal(annex.document_type,'annex');assert.equal(doc.publication_id,'22');
});
test('document safety rejects loopback, local, link-local and multicast destinations',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','::1','fe80::1','fd00::1','224.0.0.1'])assert.ok(isPrivateAddress(ip),ip);
 assert.equal(isPrivateAddress('8.8.8.8'),false);
});
