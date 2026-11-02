import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Concept,Unit} from '../components/conveni-study';
import type {ConveniUnit} from '../lib/convenis/contract';
import {conceptAmountInProposedCitations} from '../lib/convenis/concept-amount-citation';

test('grouped concept amounts are explicitly unverified AI proposals',()=>{
 const concept:ConveniUnit={key:'entitat|2025',recipient:'Entitat sintètica',recipient_nif:null,recipient_nature:'unknown',joint:false,period:'2025',year:2025,amount_cents:1800000,amount_state:'planned',mixed:true,financiers:[],territory:null,classification:'insufficient_evidence',service_code:null,population:'Persones',description:'Activitat sintètica',explanation:'Pendent de revisar',reason:null,evidence:[],blockers:['mixed']};
 const html=renderToStaticMarkup(createElement(Concept,{concept,history:[],services:[],disabled:true,save:async()=>{}}));
 assert.match(html,/Import proposat per la IA/);assert.match(html,/18\.000/);assert.match(html,/pot incloure imports compartits/);assert.match(html,/contrasta’l amb la font/);
});

test('finds supported euro literals only in proposed quotes without affirming attribution',()=>{
 for(const amount of ['18000','18.000','18000,00','18.000,00','18000.00'])
  assert.equal(conceptAmountInProposedCitations(1800000,[`La previsió és ${amount} euros.`]),'found',amount);
 assert.equal(conceptAmountInProposedCitations(1800000,['Previsió de 14.000 euros i gestió fins a 4.000 euros.']),'not_located');
 for(const quote of ['118.000 euros','18.000,50 euros','-18.000 euros','18.000%'])
  assert.equal(conceptAmountInProposedCitations(1800000,[quote]),'not_located',quote);
 assert.equal(conceptAmountInProposedCitations(null,['18.000 euros']),'not_checked');
 assert.equal(conceptAmountInProposedCitations(1800000,[]),'not_checked');
 assert.equal(conceptAmountInProposedCitations(120005,['Import: 1.200,05 euros']),'found');
});

test('a concept warns when the amount is not located in its proposed quotes, without claiming the full source lacks it',()=>{
 const concept:ConveniUnit={key:'synthetic',recipient:'Entitat',recipient_nif:null,recipient_nature:'unknown',joint:false,period:'2025',year:2025,amount_cents:1800000,amount_state:'planned',mixed:true,financiers:[],territory:null,classification:'insufficient_evidence',service_code:null,population:'Persones',description:'Activitat',explanation:'Pendent',reason:null,evidence:[{document_id:'doc',page:1,quote:'La previsió és de 14.000,00 euros.'}],blockers:['mixed']};
 const render=(u:ConveniUnit)=>renderToStaticMarkup(createElement(Concept,{concept:u,history:[],services:[],disabled:true,save:async()=>{}}));
 const html=render(concept);
 assert.match(html,/No s’ha localitzat l’import proposat en les cites/);assert.match(html,/una altra part del document/);
 assert.match(html,/18\.000/);assert.doesNotMatch(html,/No consta al document/);
 assert.doesNotMatch(render({...concept,evidence:[{document_id:'doc',page:1,quote:'Previsió de 18.000 euros.'}]}),/No s’ha localitzat l’import proposat/);
});

test('an individual unit exposes an unlocated proposed amount without deciding or discarding it',()=>{
 const unit:ConveniUnit={key:'synthetic',recipient:'Entitat',recipient_nif:null,recipient_nature:'unknown',joint:false,period:'2025',year:2025,amount_cents:271400,amount_state:'planned',mixed:false,financiers:[],territory:null,classification:'insufficient_evidence',service_code:null,population:'Persones',description:'Activitat',explanation:'Pendent',reason:null,evidence:[{document_id:'doc',page:1,quote:'L’entitat desenvolupa el servei social.'}],blockers:[]};
 const render=(data:ConveniUnit)=>renderToStaticMarkup(createElement(Unit,{row:{unit_id:'u',job_id:'j',review_id:null,outcome:null,reviewed_job:null,reviewed_code:null,review_note:null,data},concepts:[],preparationAvailable:false,documents:[],conceptHistory:[],services:[],disabled:true,save:async()=>{}}));
 const html=render(unit);
 assert.match(html,/Import proposat per la IA/);assert.match(html,/2\.714/);assert.match(html,/cites proposades per a aquesta unitat/);
 assert.match(html,/una altra part del document/);assert.doesNotMatch(html,/No consta al document/);
 assert.doesNotMatch(render({...unit,evidence:[{document_id:'doc',page:1,quote:'L’aportació prevista és de 2.714 euros.'}]}),/cites proposades per a aquesta unitat/);
 assert.doesNotMatch(render({...unit,evidence:[]}),/cites proposades per a aquesta unitat/);
 assert.doesNotMatch(render({...unit,amount_cents:null}),/cites proposades per a aquesta unitat/);
});
