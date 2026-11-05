import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conveniGrantMark,resolveRelatedConvenis} from '../lib/convenis/marks';
import {BLOCKER_LABELS} from '../lib/convenis/contract';

test('a grant instrumented by the agreement is read from the title or object and combined with the model',()=>{
 assert.deepEqual(conveniGrantMark({'Títol conveni':'Conveni regulador de la subvenció nominativa a l’Associació Prova'},false),{value:true,sources:['excel'],field:'Títol conveni'});
 assert.deepEqual(conveniGrantMark({'Títol conveni':'Conveni de col·laboració','Objecte':'Regular l’atorgament d’una subvenció per concessió directa a l’entitat'},true),{value:true,sources:['excel','ia'],field:'Objecte'});
 assert.deepEqual(conveniGrantMark({'Títol conveni':'Conveni','Objecte':'Canalitzar la subvenció establerta per a necessitats bàsiques'},null).sources,['excel']);
 assert.deepEqual(conveniGrantMark({'Títol conveni':'Conveni de col·laboració per a un programa social'},true),{value:true,sources:['ia'],field:null});
 // A mention of grants that does not grant one is not a mark.
 assert.equal(conveniGrantMark({'Títol conveni':'Conveni per a la gestió de les subvencions municipals'},false).value,false);
});

test('related agreements resolve by definitive number and only report the signature order',()=>{
 const payload={'Convenis relacionats':'2024/11/1; 2022/11/9','Data signatura':'2025-03-01T00:00:00.000Z'};
 const rows=[{id:'r1',source_record_id:'2024/11/1',title:'Conveni anterior',source_payload:{'Número conveni definitiu':'2024/11/1','Data signatura':'2024-03-01T00:00:00.000Z'}}];
 assert.deepEqual(resolveRelatedConvenis(payload,rows),[
  {number:'2024/11/1',id:'r1',title:'Conveni anterior',signed:'2024-03-01T00:00:00.000Z',relation:'earlier'},
  {number:'2022/11/9',id:null,title:null,signed:null,relation:'unknown'},
 ]);
 assert.equal(resolveRelatedConvenis({...payload,'Data signatura':'2023-01-01'},rows)[0].relation,'later');
 assert.deepEqual(resolveRelatedConvenis({},rows),[]);
});

test('a missing NIF is labelled as not found in the document, never as a reason to discard',()=>{
 assert.equal(BLOCKER_LABELS.missing_nif,'NIF no localitzat al document (pot estar anonimitzat)');
});
