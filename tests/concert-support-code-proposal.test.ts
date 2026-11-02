import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {proposeConcertSupportCode} from '../lib/concerts/support-code-proposal';

const catalog=[
 {code:'1.2.6.2.4.1.1',name:'Servei de teràpia ocupacional (STO) per a persones amb discapacitat intel·lectual'},
 {code:'1.2.6.2.4.1.2',name:'Servei de teràpia ocupacional (STO) per a persones amb discapacitat intel·lectual, amb auxiliar'},
 {code:'1.2.6.3.4.1.1',name:'Servei de teràpia ocupacional (STO) per a persones amb discapacitat física'},
 {code:'1.2.6.3.4.1.2',name:'Servei de teràpia ocupacional (STO) per a persones amb discapacitat física, amb auxiliar'},
];

test('support proposes only the approved specific child for both STO families',()=>{
 for(const [parent,support,expected] of [
  ['1.2.6.2.4.1','STOI','1.2.6.2.4.1.1'],['1.2.6.2.4.1','STOAI','1.2.6.2.4.1.2'],
  ['1.2.6.3.4.1','STOI','1.2.6.3.4.1.1'],['1.2.6.3.4.1','STOAI','1.2.6.3.4.1.2'],
 ] as const){
  const proposal=proposeConcertSupportCode(parent,support,catalog);
  assert.equal(proposal?.code,expected);assert.equal(proposal?.support,support);assert.equal(proposal?.requiresHumanReview,true);
  assert.match(proposal!.explanation,/Proposta derivada/);
 }
});
test('unknown parents, support values, missing and duplicate catalogue entries do not produce proposals',()=>{
 for(const parent of [null,'1.2.6.2.4.1.1','1.2.6.2.4.10','1.2.6.9.4.1'])assert.equal(proposeConcertSupportCode(parent,'STOI',catalog),null);
 for(const support of [null,'SOII','STO','stoi','STOI STOAI',' STOI '])assert.equal(proposeConcertSupportCode('1.2.6.2.4.1',support,catalog),null);
 assert.equal(proposeConcertSupportCode('1.2.6.2.4.1','STOI',catalog.slice(1)),null);
 assert.equal(proposeConcertSupportCode('1.2.6.2.4.1','STOI',[...catalog,catalog[0]]),null);
});
test('catalogue labels that contradict the proposed population or auxiliary status are rejected',()=>{
 for(const name of ['','Servei de teràpia ocupacional per a persones amb discapacitat física','Servei de teràpia ocupacional per a persones amb discapacitat intel·lectual, amb auxiliar','Servei desconegut'])
  assert.equal(proposeConcertSupportCode('1.2.6.2.4.1','STOI',[{...catalog[0],name}]),null);
 assert.equal(proposeConcertSupportCode('1.2.6.2.4.1','STOAI',[{...catalog[1],name:catalog[0].name}]),null);
 assert.equal(proposeConcertSupportCode('1.2.6.2.4.1','STOAI',[{...catalog[1],name:catalog[0].name+' sense prestació amb auxiliar'}]),null);
 assert.equal(proposeConcertSupportCode('1.2.6.2.4.1','STOI',[{...catalog[0],name:catalog[0].name+', sense auxiliar'}])?.code,catalog[0].code);
});
test('the four proposals match the project local legal catalogue snapshot',()=>{
 const snapshot=JSON.parse(readFileSync('data/legal/cartera.json','utf8')) as {services:Array<{service_code:string;service_name:string;benefit_type:string}>};
 const services=snapshot.services.filter(service=>service.benefit_type==='service').map(service=>({code:service.service_code,name:service.service_name}));
 for(const [parent,support,suffix] of [['1.2.6.2.4.1','STOI','1'],['1.2.6.2.4.1','STOAI','2'],['1.2.6.3.4.1','STOI','1'],['1.2.6.3.4.1','STOAI','2']] as const)
  assert.equal(proposeConcertSupportCode(parent,support,services)?.code,`${parent}.${suffix}`);
});
