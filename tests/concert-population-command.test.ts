import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePopulationCommand} from '../lib/concerts/population-command';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ConcertPopulationObservation} from '../components/concert-population-observation';

const id='a0000000-0000-4000-8000-000000000001';
const hash='a'.repeat(64);
const base={jobId:id,eventId:id,previousId:null,documentId:id,revision:`${hash}:`,documentHash:hash,unitHash:hash,
 decision:'unknown',value:null,page:null,quote:null,reason:'Població no identificada',reviewer:'Revisor'};
test('pending and documented population use distinct, explicit shapes',()=>{
 assert.equal(parsePopulationCommand(base).decision,'unknown');
 assert.equal(parsePopulationCommand({...base,decision:'confirmed',value:'Persones grans',page:1,quote:'Persones grans destinatàries'}).decision,'confirmed');
 for(const value of [{...base,value:'Persones'}, {...base,quote:'Cita que no correspon'},
  {...base,decision:'confirmed',value:'Persones',page:0,quote:'Cita prou extensa'},
  {...base,decision:'confirmed',value:' Persones ',page:1,quote:'Cita prou extensa'},
  {...base,decision:'confirmed',value:'Persones',page:1,quote:'Cita\namb línies'},
  {...base,documentHash:'not-a-hash'}, {...base,jobId:'not-an-id'}, {...base,reason:'curt'}])assert.throws(()=>parsePopulationCommand(value));
});
test('the population observation makes its limits clear before any data is loaded',()=>{
 const html=renderToStaticMarkup(createElement(ConcertPopulationObservation,{recordId:id,unitId:id,jobId:id,page:1,editable:true}));
 assert.match(html,/No aprova la línia ni afegeix finançament/);
 assert.match(html,/població general de l’expedient no acredita/);
 assert.match(html,/Carregant la revisió/);
 assert.doesNotMatch(html,/Desa l’observació de població/);
});
