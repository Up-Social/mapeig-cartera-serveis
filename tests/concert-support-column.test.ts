import assert from 'node:assert/strict';
import {test} from 'node:test';
import {extractColumnAnnexRows,extractColumnSupportObservations} from '../lib/concerts/annex-extraction';

const header='Nom entitat'.padEnd(25)+'NIF entitat'.padEnd(16)+'Codi cartera'.padEnd(15)+'Tipologia servei'.padEnd(33)+'Suport'.padEnd(9)+'Codi S'.padEnd(9)+'Nom servei'.padEnd(25)+'Municipi'.padEnd(20)+'assignar';
const line=(support:string,reses='S10844')=>'Entitat prova'.padEnd(25)+'G12345678'.padEnd(16)+'1.2.6.2.4.1'.padEnd(15)+'Servei ocupacional'.padEnd(33)+support.padEnd(9)+reses.padEnd(9)+'Servei A'.padEnd(25)+'Torà'.padEnd(20)+'2';
const doc=(h:string,...rows:string[])=>['## Pàgina 4',h,...rows,'Total general 4'].join('\n');

test('support observations retain page and original row without changing the normal extraction',()=>{
 const text=doc(header,line('STOI'),line('SOII','S10845'));
 const rows=extractColumnAnnexRows(text);
 assert.equal(rows.length,2);assert.equal(rows[0].observedServiceCode,'1.2.6.2.4.1');
 assert.equal(Object.hasOwn(rows[0],'observedSupport'),false);
 assert.deepEqual(extractColumnSupportObservations(text),[{page:4,row:1,resesCode:'S10844',value:'STOI'},{page:4,row:2,resesCode:'S10845',value:'SOII'}]);
});

test('support observations never borrow from a preceding row or unknown column',()=>{
 const text=doc(header,line('STOI'),line('','S10845'));
 assert.deepEqual(extractColumnSupportObservations(text),[{page:4,row:1,resesCode:'S10844',value:'STOI'}]);
 assert.deepEqual(extractColumnSupportObservations(doc(header.replace('Suport','      '),line('STOI'))),[]);
 assert.deepEqual(extractColumnSupportObservations(doc(header.replace('Tipologia servei','Tipologia Suport'),line('STOI'))),[]);
});

test('support observations retain final row identity when an incomplete code is moved after known rows',()=>{
 const missing=line('STOI').replace('1.2.6.2.4.1','           ');
 const text=doc(header,missing,line('SOII','S10845'));
 assert.deepEqual(extractColumnSupportObservations(text),[{page:4,row:2,resesCode:'S10844',value:'STOI'},{page:4,row:1,resesCode:'S10845',value:'SOII'}]);
});

test('shifted, merged, multi-token and multiple-registry rows yield no observation',()=>{
 const baseline=line('STOI'),start=baseline.indexOf('STOI');
 const merged=baseline.slice(0,start-1)+'X'+baseline.slice(start);
 const variants=[line('STOI',' S10844'),line('STOI XXX'),merged,line('STOI').replace('Servei A','S54321  ')];
 for(const [index,item] of variants.entries()){
  const text=doc(header,item);
  assert.equal(extractColumnAnnexRows(text).length,1,`variant ${index}`);
  assert.deepEqual(extractColumnSupportObservations(text),[]);
 }
});
