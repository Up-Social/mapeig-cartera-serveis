import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conveniConceptFormKey,conveniUnitFormKey,initialConveniReviewOutcome,initialConveniServiceCode,missingConveniFieldMessages} from '../lib/convenis/review-presentation';
import {REVIEW_LABELS} from '../lib/review-contract';
import type {ConveniUnit} from '../lib/convenis/contract';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Concept,Unit,ConveniMissingNifWarning,hasIndependentConveniHistory} from '../components/conveni-study';

test('missing NIF in multiple units explains potential duplicate identity without proposing a discard',()=>{
 const warning=renderToStaticMarkup(createElement(ConveniMissingNifWarning,{units:[{recipient_nif:'G12345678'},{recipient_nif:null}]}));
 assert.match(warning,/No s’ha trobat el NIF/);
 assert.match(warning,/no es pot confirmar automàticament amb el NIF si les unitats corresponen a la mateixa entitat/);
 assert.match(warning,/pendents de contrast amb altres evidències/);
 assert.match(warning,/la manca de NIF no és motiu de descart/);
 assert.equal(renderToStaticMarkup(createElement(ConveniMissingNifWarning,{units:[{recipient_nif:null}]})),'');
 assert.equal(renderToStaticMarkup(createElement(ConveniMissingNifWarning,{units:[{recipient_nif:'G12345678'},{recipient_nif:'G87654321'}]})),'');
});

test('an AI discard or a decision from another job never preselects rejection',()=>{
 assert.equal(initialConveniReviewOutcome('discarded',null,null,'new'),'insufficient');
 assert.equal(initialConveniReviewOutcome('discarded','reject','old','new'),'insufficient');
 assert.equal(initialConveniReviewOutcome('insufficient_evidence','reject','old','new'),'insufficient');
 assert.equal(initialConveniReviewOutcome('in_portfolio','reject','old','new'),'select');
 assert.ok(REVIEW_LABELS.reject);
});

test('an explicit decision in the current job stays selected, including rejection',()=>{
 for(const outcome of ['select','outside','reject','insufficient'] as const){
  assert.equal(initialConveniReviewOutcome('discarded',outcome,'current','current'),outcome);
 }
});

test('a service selected in an older job is not preselected for the current proposal',()=>{
 assert.equal(initialConveniServiceCode('new-service','old-service','old','new'),'new-service');
 assert.equal(initialConveniServiceCode(null,'old-service','old','new'),'');
 assert.equal(initialConveniServiceCode('new-service','reviewed-service','new','new'),'reviewed-service');
});

test('form identity changes on a new job and on relevant concept versions',()=>{
 const old=conveniUnitFormKey('unit','old-job',null,null);
 assert.notEqual(old,conveniUnitFormKey('unit','new-job',null,null));
 assert.notEqual(old,conveniUnitFormKey('unit','old-job','decision','old-job'));
 assert.equal(old,conveniUnitFormKey('unit','old-job',null,null));
 const concept=conveniConceptFormKey(0,'concept-v1','source-v1',null,null,true);
 assert.notEqual(concept,conveniConceptFormKey(0,'concept-v2','source-v1',null,null,true));
 assert.notEqual(concept,conveniConceptFormKey(0,'concept-v1','source-v2',null,null,true));
 assert.notEqual(concept,conveniConceptFormKey(0,'concept-v1','source-v1',null,null,false));
});

test('missing fields are reported per unit and per grouped concept without changing the proposals',()=>{
 const parent={recipient:'Associació',period:'2025',population:'Gent gran',description:'Atenció',concepts:[
  {recipient:'Associació',period:'2025',population:'',description:'Atenció'},
  {recipient:'Associació',period:'2025',population:'Gent gran',description:''},
 ]} as ConveniUnit;
 const before=JSON.stringify(parent);
 assert.deepEqual(missingConveniFieldMessages(parent),[]);
 assert.match(missingConveniFieldMessages(parent.concepts![0])[0],/població destinatària/);
 assert.match(missingConveniFieldMessages(parent.concepts![1])[0],/descripció del servei/);
 assert.equal(JSON.stringify(parent),before);
});

test('missing recipient and period are marked as unidentified by the proposal',()=>{
 const messages=missingConveniFieldMessages({recipient:'',period:'',population:'',description:''} as ConveniUnit);
 assert.equal(messages.length,4);
 assert.ok(messages.every(message=>message.includes('a la proposta')&&message.includes('pendent')));
});

test('a grouped concept presents the model discard and missing population separately',()=>{
 const concept:ConveniUnit={key:'fixture',recipient:'Associació',recipient_nif:null,recipient_nature:'unknown',joint:false,period:'2025',year:2025,
  population:'',description:'Suport',classification:'discarded',reason:'missing_population',explanation:'Proposta pendent.',
  amount_cents:null,amount_state:'planned',mixed:false,financiers:[],territory:null,service_code:null,evidence:[],blockers:[]};
 const html=renderToStaticMarkup(createElement(Concept,{concept,history:[],services:[],disabled:true,save:async()=>{}}));
 assert.match(html,/Proposta de la IA:.*Descart/);
 assert.match(html,/Motiu proposat del descart/);
 assert.match(html,/població destinatària a la proposta/);
 assert.match(html,/La manca d’un camp no és per si sola un motiu de descart/);
 assert.match(html,/Proposta pendent/);
});

test('same-job decision is displayed without claiming that the documents are current',()=>{
 const data:ConveniUnit={key:'fixture',recipient:'Associació',recipient_nif:null,recipient_nature:'unknown',joint:false,period:'2025',year:2025,
  population:'',description:'Suport',classification:'insufficient_evidence',reason:null,explanation:'Pendent.',
  amount_cents:null,amount_state:'planned',mixed:false,financiers:[],territory:null,service_code:null,evidence:[],blockers:[]};
 const props={row:{unit_id:'unit',job_id:'job',data,review_id:'review',outcome:'reject' as const,reviewed_job:'job',reviewed_code:null,review_note:null},
  concepts:[],preparationAvailable:false,documents:[],conceptHistory:[],services:[],disabled:true,save:async()=>{}};
 const html=renderToStaticMarkup(createElement(Unit,props));
 assert.match(html,/Decisió registrada per a aquesta anàlisi; vigència documental pendent de contrast/);
 assert.doesNotMatch(html,/Decisió vigent/);
 const prior=renderToStaticMarkup(createElement(Unit,{...props,row:{...props.row,reviewed_job:'previous'}}));
 assert.match(prior,/Decisió anterior; nova proposta pendent/);
});

test('independent history blocks the legacy decision form for the whole record, including siblings',()=>{
 const base={id:'older',job_id:'old-job',unit_id:'first-unit',outcome:'select',reason:'Història',created_at:'2026-01-01',actor:'fixture'};
 assert.equal(hasIndependentConveniHistory([{...base,snapshot:{origin:'private-versioned-conveni-v1'}}]),true);
 assert.equal(hasIndependentConveniHistory([{...base,snapshot:{}}]),false);
 const unit:ConveniUnit={key:'sibling',recipient:'Entitat',recipient_nif:null,recipient_nature:'unknown',joint:false,period:'2025',year:2025,population:'',description:'',classification:'insufficient_evidence',reason:null,explanation:'Pendent',amount_cents:null,amount_state:'planned',mixed:false,financiers:[],territory:null,service_code:null,evidence:[],blockers:[]};
 const props={row:{unit_id:'sibling-unit',job_id:'new-job',data:unit,review_id:null,outcome:null,reviewed_job:null,reviewed_code:null,review_note:null},concepts:[],preparationAvailable:false,documents:[],conceptHistory:[],services:[],disabled:false,save:async()=>{}};
 const legacy=renderToStaticMarkup(createElement(Unit,props));
 assert.match(legacy,/Desa la decisió d’aquesta unitat/);
 const blocked=renderToStaticMarkup(createElement(Unit,{...props,legacyReviewBlocked:true}));
 assert.match(blocked,/La decisió d’aquesta unitat no està disponible/);
 assert.doesNotMatch(blocked,/Desa la decisió d’aquesta unitat/);
 assert.match(blocked,/Import proposat per la IA:/);
});

test('a blocked legacy review also hides concept decisions but retains evidence and proposals',()=>{
 const concept:ConveniUnit={key:'concept',recipient:'Entitat',recipient_nif:null,recipient_nature:'unknown',joint:false,period:'2025',year:2025,population:'',description:'Suport',classification:'insufficient_evidence',reason:null,explanation:'Pendent',amount_cents:null,amount_state:'planned',mixed:false,financiers:[],territory:null,service_code:null,evidence:[],blockers:[]};
 const row={unit_id:'unit',job_id:'job',data:{...concept,concepts:[concept]},review_id:null,outcome:null,reviewed_job:null,reviewed_code:null,review_note:null};
 const review={unit_id:'unit',job_id:'job',concept_index:0,concept_hash:'hash',source_hash:'source',document_revisions:{},parent_review_id:null,review_id:null,review_sequence:null,review_is_current:true,outcome:null,reviewed_code:null,review_note:null,concept};
 const props={row,concepts:[review],preparationAvailable:false,documents:[],conceptHistory:[],services:[],disabled:false,save:async()=>{}};
 const available=renderToStaticMarkup(createElement(Unit,props));
 assert.match(available,/Desa la revisió individual/);
 const blocked=renderToStaticMarkup(createElement(Unit,{...props,legacyReviewBlocked:true}));
 assert.doesNotMatch(blocked,/Desa la revisió individual|Desa la decisió d’aquesta unitat/);
 assert.match(blocked,/Cites originals del concepte/);
 assert.match(blocked,/Suport/);
});

test('a group of concepts shows each concept proposal instead of insufficient evidence',async()=>{
 const {conveniProposalLabel}=await import('../lib/convenis/review-presentation');
 const concept=(classification:ConveniUnit['classification'],service_code:string|null,amount_cents:number|null,mixed=false)=>({classification,service_code,amount_cents,mixed}) as ConveniUnit;
 const label=conveniProposalLabel({classification:'insufficient_evidence',service_code:null,concepts:[concept('in_portfolio','1.1.7',1400000),concept('out_of_portfolio',null,200000),concept('out_of_portfolio',null,null,true)]});
 assert.match(label,/^3 conceptes amb proposta pròpia, pendents de revisió individual: /);
 assert.match(label,/Servei de cartera 1\.1\.7 \(14\.000,00\s€\)/);
 assert.match(label,/Servei social fora de cartera \(2\.000,00\s€\)/);
 assert.match(label,/Servei social fora de cartera \(import mixt\)/);
 assert.doesNotMatch(label,/Evidència insuficient/);
 assert.equal(conveniProposalLabel({classification:'insufficient_evidence',service_code:null}),'Evidència insuficient');
});
