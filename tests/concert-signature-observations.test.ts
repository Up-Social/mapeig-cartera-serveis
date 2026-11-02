import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeSignatureObservations,type SignatureObservation} from '../lib/concerts/signature-observations';
const observation:SignatureObservation={document_id:'doc',document_sha256:'sha',claimed_utc:'2024-02-29T15:00:00Z',local_date:'2024-02-29',certificate_trust:'trusted',verification_method:'pdfsig-full-document-v1',observed_at:'2026-11-02T12:00:00Z'};
test('identical worker/operator retries do not create a false conflict',()=>{
 const [result]=summarizeSignatureObservations([observation,{...observation,claimed_utc:'2024-02-29T15:00:00+00:00',observed_at:'2026-11-02T13:00:00Z'}]);
 assert.equal(result.conflict,false);assert.equal(result.observation?.local_date,'2024-02-29');
});
test('contradictory claims block a preferred date in either arrival order',()=>{
 for(const change of [{claimed_utc:'2024-02-29T16:00:00Z'},{certificate_trust:'unknown'},{local_date:'2024-03-01'},{verification_method:'different'}]){
  const other={...observation,...change};
  for(const items of [[observation,other],[other,observation]]){
   const [result]=summarizeSignatureObservations(items);assert.equal(result.conflict,true);assert.equal(result.observation,null);
  }
 }
});
test('independent documents and archived revisions are not merged',()=>{
 assert.equal(summarizeSignatureObservations([observation,{...observation,document_id:'other'},{...observation,document_sha256:'other'}]).length,3);
});
test('candidate SQL preserves conflicting rows and guards every insert with an archive lock',()=>{
 const sql=readFileSync('supabase/migrations/20261102191000_concert_signature_observations.sql','utf8');
 assert.doesNotMatch(sql,/distinct on/i);
 assert.match(sql,/before insert on public\.concert_signature_observations/);
 assert.match(sql,/where id=new\.document_id for share/);
 assert.match(sql,/d\.storage_sha256 is distinct from new\.document_sha256/);
});

test('malformed or unsupported observations also block the date',()=>{
 for(const change of [{claimed_utc:'invalid'},{certificate_trust:'unsupported'},{verification_method:'other'}]){
  const [result]=summarizeSignatureObservations([{...observation,...change}]);
  assert.equal(result.conflict,true);assert.equal(result.observation,null);
 }
});
