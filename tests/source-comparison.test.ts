import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareImportedAmount,compareSourceField,contractAmountSource,sourceComparison,extractedFieldDisplay} from '../lib/source-comparison';
import type {SourceRecord} from '../lib/workbench-types';

test('equivalent source amounts take precedence over extracted amounts, including zero',()=>{
 assert.equal(compareSourceField('Import',100,125).effective,100);
 assert.equal(compareSourceField('Import',0,125).effective,0);
 assert.equal(compareSourceField('Import',null,125).effective,125);
 assert.equal(compareSourceField('Import',null,null).effective,null);
 const unlocated=compareSourceField('NIF','A12345678',null);
 assert.equal(unlocated.status,'No disponible al resultat documental');assert.equal(unlocated.effective,'A12345678');assert.equal(unlocated.origin,'Excel');
 assert.match(extractedFieldDisplay('concert','NIF',null),/nivell global.*línies/);
 assert.match(extractedFieldDisplay('subvencio','NIF',null),/No identificat.*pendent/);
 assert.match(extractedFieldDisplay('conveni','Import',0),/0,00/);
});

test('invalid preferred numbers remain pending instead of leaking into exports or silently falling back',()=>{
 for(const invalid of [NaN,Infinity,-Infinity]){
  const original=compareSourceField('Import',invalid,125);
  assert.equal(original.status,'Valor no vàlid');assert.equal(original.effective,null);assert.equal(original.origin,'Pendent');
  const document=compareSourceField('Import',null,invalid);
  assert.equal(document.status,'Valor no vàlid');assert.equal(document.effective,null);assert.equal(document.origin,'Pendent');
  const source=compareSourceField('Import',0,invalid);
  assert.equal(source.status,'Valor no vàlid');assert.equal(source.effective,0);assert.equal(source.origin,'Excel');
 }
});

test('empty strings do not become effective values',()=>{
 const result=compareSourceField('Entitat','  ','');
 assert.equal(result.status,'Sense dades');assert.equal(result.effective,null);assert.equal(result.origin,'Pendent');
});

test('contract source amount is attributed to the first imported field only when its value is verified',()=>{
 assert.equal(contractAmountSource(0,{'Importe de adjudicación':0,'Presupuesto de licitación':300}),'award');
 assert.equal(contractAmountSource(12.5,{'Importe de adjudicación':'12,50'}),'award');
 assert.equal(contractAmountSource(300,{'Importe de adjudicación':null,'Presupuesto de licitación':300}),'tender');
 assert.equal(contractAmountSource(400,{'Presupuesto de licitación':'','Valor estimado del contrato':400}),'estimate');
 assert.equal(contractAmountSource(300,{'Importe de adjudicación':200,'Presupuesto de licitación':300}),'unknown');
 assert.equal(contractAmountSource(300,null),'unknown');
 assert.equal(contractAmountSource(null,{'Importe de adjudicación':300}),'none');
});

test('ambiguous or unsafe first numeric values never inherit the identity of a later field',()=>{
 for(const value of ['1e3','0x3e8','0'.repeat(40)+'1000','\u00a01000\u00a0','\t1000\n']){
  assert.equal(contractAmountSource(1000,{'Importe de adjudicación':value,'Presupuesto de licitación':1000}),'unknown');
 }
 assert.equal(contractAmountSource(1000,{'Importe de adjudicación':'1.000,00','Presupuesto de licitación':1000}),'tender');
 assert.equal(contractAmountSource(1000,{'Importe de adjudicación':'', 'Presupuesto de licitación':1000}),'tender');
 assert.equal(contractAmountSource(1000,{'Importe de adjudicación':' 1000 '}),'award');
 assert.equal(contractAmountSource(Number.MAX_SAFE_INTEGER,{'Importe de adjudicación':Number.MAX_SAFE_INTEGER}),'unknown');
 assert.equal(contractAmountSource(Infinity,{'Importe de adjudicación':Infinity}),'unknown');
});

test('a tender, estimate, untyped document amount or legacy record does not establish an award',()=>{
 for(const [source,document] of [
  [1000,700],
  [null,700],
 ] as const){
  const compared=compareImportedAmount('contractacions',source,document,null,'contractacio');
  assert.equal(compared.effective,null);assert.equal(compared.origin,'Pendent');assert.equal(compared.status,'Naturalesa pendent');
 }
 const award=compareImportedAmount('contractacions',0,700,0,'contractacio');
 assert.equal(award.effective,0);assert.equal(award.origin,'Excel');assert.equal(award.status,'Naturalesa pendent');
 const invalid=compareImportedAmount('contractacions',1000,NaN,null,'contractacio');
 assert.equal(invalid.effective,null);assert.equal(invalid.status,'Valor no vàlid');
 assert.equal(compareImportedAmount('contractacions',null,null,null,'contractacio').status,'Sense dades');
 assert.equal(compareImportedAmount('raisc_local',1000,700,null).effective,1000);
 assert.equal(compareImportedAmount('contractacions',700,900,701,'contractacio').effective,null);
 assert.equal(compareImportedAmount('contractacions',1,900,undefined,'contractacio').effective,null);
 assert.equal(compareImportedAmount('contractacions',700,900,700,'subvencio').effective,null);
 assert.equal(compareImportedAmount('raisc_local',700,900,700,'contractacio').effective,null);
});

test('record comparison keeps the source amount visible while leaving a tender unassigned',()=>{
 const record={sourceDataset:'contractacions',financingType:'contractacio',sourcePayload:{'Presupuesto de licitación':1000},title:'Expedient sintètic',providerName:null,mechanism:'Contractació pública',amount:1000,externalEnrichment:{amount:700}} as unknown as SourceRecord;
 const result=sourceComparison(record).find(value=>value.label==='Import');
 assert.equal(result?.original,1000);assert.equal(result?.document,700);assert.equal(result?.effective,null);assert.equal(result?.status,'Naturalesa pendent');
});
