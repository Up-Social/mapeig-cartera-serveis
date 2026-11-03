import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CaseAtAGlance} from '../components/case-at-a-glance';
import {SourceComparison} from '../components/source-comparison';
import type {SourceRecord} from '../lib/workbench-types';

test('missing summary fields remain visible and pending for every financing type; zero is preserved',()=>{
 for(const financingType of ['concert','conveni','contractacio','subvencio']){
  const record={sourceDataset:financingType==='contractacio'?'contractacions':'synthetic',financingType,sourcePayload:{},title:'Expedient sintètic',providerName:null,mechanism:null,amount:null,sourceDocuments:[],externalEnrichment:null} as unknown as SourceRecord;
  const html=renderToStaticMarkup(createElement(CaseAtAGlance,{record}));
  assert.match(html,/Mecanisme/);assert.match(html,/Import/);assert.match(html,/No consta · pendent/);
  assert.equal((html.match(/No consta · pendent/g)??[]).length,3);
  if(financingType==='concert')assert.doesNotMatch(html,/Import global extret/);
  const zero=renderToStaticMarkup(createElement(CaseAtAGlance,{record:{...record,amount:0}}));
  assert.match(zero,/0,00/);assert.equal((zero.match(/No consta · pendent/g)??[]).length,2);
 }
});

test('case summary identifies a tender budget and does not compare it as an awarded amount',()=>{
 const record={sourceDataset:'contractacions',financingType:'contractacio',sourcePayload:{'Presupuesto de licitación':1000},
  title:'Expedient sintètic',providerName:null,mechanism:'Contractació pública',amount:1000,
  sourceDocuments:[],externalEnrichment:{amount:700}} as unknown as SourceRecord;
 const html=renderToStaticMarkup(createElement(CaseAtAGlance,{record}));
 assert.match(html,/pressupost de licitació/);
 assert.match(html,/naturalesa pendent de verificar/);
 assert.match(html,/no identifiquen l’import adjudicat/);
 assert.doesNotMatch(html,/diferència pendent de revisar/);
 const inconsistent=renderToStaticMarkup(createElement(CaseAtAGlance,{record:{...record,sourceDataset:'raisc_local',contractVerifiedAward:1000}}));
 assert.match(inconsistent,/naturalesa no acreditada/);
 assert.doesNotMatch(inconsistent,/possible pressupost de licitació/);
});

test('comparison explains a pending contract amount while other financing retains its guidance',()=>{
 const base={sourceDataset:'contractacions',financingType:'contractacio',sourcePayload:{'Presupuesto de licitación':1000},
  title:'Expedient sintètic',providerName:null,mechanism:'Contractació pública',amount:1000,sourceFile:'synthetic.xlsx',
  sourceDocuments:[],externalEnrichment:{amount:700}} as unknown as SourceRecord;
 const contract=renderToStaticMarkup(createElement(SourceComparison,{record:base}));
 assert.match(contract,/Naturalesa pendent/);assert.match(contract,/pressupost, un valor estimat/);
 assert.doesNotMatch(contract,/El document completa els camps buits/);
 const grant=renderToStaticMarkup(createElement(SourceComparison,{record:{...base,sourceDataset:'raisc_local',financingType:'subvencio'}}));
 assert.match(grant,/El document completa els camps buits/);
});

