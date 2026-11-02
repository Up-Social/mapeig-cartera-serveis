import test from 'node:test';
import assert from 'node:assert/strict';
import {hasMixedConcertFinancialActs} from '../lib/concerts/no-award';
import {prepareConcertObservations} from '../lib/cloud/concerts';
import {CloudFailure} from '../lib/cloud/errors';

test('award combined with an amendment, transfer, validation or appeal requires line-level review',()=>{
 for(const act of [
  'Esmenar el codi de la Fundació A', 'Rectificar el nom de la Fundació A', 'Corregir les dades de l’annex anterior',
  'Cedir el servei de la Fundació A a la Fundació B', 'Traspassar el servei a la Fundació B',
  'Convalidar l’acte de la Fundació A', 'Estimar el recurs de la Fundació A',
  'Desestimar parcialment el recurs de la Fundació A', 'Resoldre el recurs de la Fundació A',
 ]){
  assert.equal(hasMixedConcertFinancialActs(`Antecedents d’un procediment.\nRESOLC:\n1. ${act}.\n2. Assignar places noves a la Fundació C.`),true,act);
  assert.equal(hasMixedConcertFinancialActs(`RESOLC: 1. Adjudicar les places de l’entitat C. 2. ${act}.`),true,act);
 }
});
test('background, annex material, denied or merely proposed acts do not create a mixed operative act',()=>{
 for(const text of [
  'Antecedents: 1. Esmenar les dades de l’expedient antic. RESOLC: 1. Assignar places a la Fundació C.',
  'RESOLC: 1. Assignar places a la Fundació C.\n## Annex 1\n2. Cedir les places que s’esmenten com a exemple.',
  'RESOLC: 1. No cedir el servei a la Fundació B. 2. Assignar places a la Fundació C.',
  'RESOLC: 1. Proposar rectificar una dada. 2. Assignar places a la Fundació C.',
  'RESOLC: 1. Assignar places a la Fundació C. 2. Notificar i informar del recurs de reposició.',
  'RESOLC: 1. Rectificar l’acord anterior. 2. Notificar a la persona interessada.',
 ])assert.equal(hasMixedConcertFinancialActs(text),false,text);
});
test('a mixed correction and award remains pending across resumptions without staging a unit',async()=>{
 const text='RESOLC: 1. Esmenar el codi de la Fundació A. 2. Assignar places noves a la Fundació C.';
 const document={id:'doc',mime_type:'application/pdf',status:'fetched',extraction_partial:false,storage_sha256:'a'.repeat(64),extracted_text:text};
 let writes=0;
 const db={rpc:async()=>{writes++;throw Error('No writes expected');},from(table:string){
  const query={select(){return query;},eq(){return query;},neq(){return query;},order(){return query;},
   range(){return Promise.resolve({data:table==='source_documents'?[document]:[],error:null});},
   single(){return Promise.resolve({data:{id:'record',title:'Resolució d’esmena del concert social',source_record_id:'source',source_payload:{},financing_type:'concert'},error:null});},
   maybeSingle(){return Promise.resolve({data:null,error:null});}};
  return query;
 }};
 const context={db:db as never,task:'task',owner:'owner',generation:1};
 for(let i=0;i<2;i++)await assert.rejects(prepareConcertObservations(context,{id:'job',source_record_id:'record'}),
  (error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='CONCERT_MIXED_ACT_REVIEW'&&error.diagnostic.message?.includes('revisar els efectes'));
 assert.equal(writes,0);
});
