import assert from 'node:assert/strict';
import test from 'node:test';
import {conveniDiscardReason} from '../lib/convenis/discard-reason';
import {validateConveni,type ConveniAnalysis,type ConveniUnit} from '../lib/convenis/contract';
import {missingDiscardDiagnostic} from '../lib/convenis/missing-discard';
import {CloudFailure,failureMessage} from '../lib/cloud/errors';
import {isConveniMissingFieldMessage} from '../lib/convenis/missing-field-messages';

test('a historical proposed reason is visible and its conflict requires review',()=>{
 // An inconsistent reason must remain visible; the display must not invent
 // an interadministrative exclusion to repair it.
 const historical={classification:'discarded',reason:'service_not_in_catalog',recipient_nature:'public'};
 const result=conveniDiscardReason(historical.reason);
 assert.equal(result.label,'Servei no identificat a la cartera');
 assert.match(result.explanation??'',/no justifica per si sola un descart/);
 assert.equal(historical.reason,'service_not_in_catalog');
 assert.doesNotMatch(result.label,/interadministratiu/i);
});

test('known scope reasons are presented as proposals; missing and unknown reasons are preserved',()=>{
 assert.equal(conveniDiscardReason('interadministrative_agreement').label,'Conveni interadministratiu');
 assert.equal(conveniDiscardReason('excluded_amendment').label,'Addenda, pròrroga o modificació fora de l’abast');
 assert.match(conveniDiscardReason(null).explanation??'',/Cal contrastar/);
 assert.equal(conveniDiscardReason('Altres motius documentats').label,'Altres motius documentats');
});

test('a historical structured missing-field reason remains visible with a specific review warning',()=>{
 const historical={classification:'discarded',reason:'missing_nif'};
 const result=conveniDiscardReason(historical.reason);
 assert.equal(result.label,'missing_nif');assert.match(result.explanation??'',/NIF/);assert.match(result.explanation??'',/No és motiu de descart/);
 assert.match(result.explanation??'',/proposta històrica/);assert.equal(historical.classification,'discarded');assert.equal(historical.reason,'missing_nif');
});

test('structured missing reasons require review rather than becoming discard decisions',()=>{
 const quote='L’entitat sintètica presta un servei social per a persones adultes durant 2025.';
 const doc={id:'fixture',storage_sha256:'synthetic',extracted_text:`## Pàgina 1\n${quote}`};
 const evidence=[{document_id:doc.id,page:1,quote}];
 const unit:ConveniUnit={key:'',recipient:'Entitat de prova',recipient_nif:null,recipient_nature:'unknown',joint:false,period:'2025',year:2025,amount_cents:null,amount_state:'planned',mixed:false,financiers:[],territory:null,classification:'discarded',service_code:null,population:'',description:'',explanation:'Proposta pendent',reason:null,evidence,blockers:[]};
 const input:ConveniAnalysis={actors:[],units:[unit],instrument_grant:false,coverage_complete:true,unallocated_cents:null,summary:'Proposta'};
 for(const [reason,code,field] of [
  ['missing_nif','CONVENI_DISCARD_MISSING_NIF','NIF'],['MISSING_AMOUNT','CONVENI_DISCARD_MISSING_AMOUNT','import'],
  ['missing_period','CONVENI_DISCARD_MISSING_PERIOD','període'],['missing_population','CONVENI_DISCARD_MISSING_POPULATION','població'],
  ['unknown_service','CONVENI_DISCARD_MISSING_SERVICE','servei'],['unknown_recipient','CONVENI_DISCARD_MISSING_IDENTITY','receptor'],
  ['missing_other_field','CONVENI_DISCARD_MISSING_FIELD','camp'],['incomplete','CONVENI_DISCARD_MISSING_FIELD','camp'],
 ] as const){
  const proposal={...input,units:[{...unit,reason:`\u00a0${reason}\u00a0`}]};
  // The proposal is kept for review, never as a discard decision.
  const kept=validateConveni(proposal,{},[doc],new Set());
  assert.equal(kept.units[0].classification,'insufficient_evidence');assert.equal(kept.units[0].original_classification,'discarded');
  assert.ok(kept.diagnostics?.some(d=>d.code===code&&d.field==='reason'),code);
  const safe=failureMessage(new CloudFailure('validation',5,{operation:'conveni_analysis',code,message:'SENSITIVE PROVIDER CONTENT'}));
  assert.equal(isConveniMissingFieldMessage(safe),true);
  assert.ok(safe.toLocaleLowerCase('ca').includes(field.toLocaleLowerCase('ca')));assert.match(safe,/pendent/);assert.doesNotMatch(safe,/SENSITIVE/);
 }
 // An independent documented reason is never inferred from the absence of a
 // NIF or amount; this change does not recategorise its proposal.
 const independent=validateConveni({...input,units:[{...unit,reason:'excluded_amendment'}]}, {},[doc],new Set());
 assert.equal(independent.units[0].classification,'discarded');assert.equal(independent.units[0].reason,'excluded_amendment');
 assert.equal(missingDiscardDiagnostic('No s’ha trobat el NIF'),null,'free text cannot be reliably classified by this narrow guard');
 assert.equal(input.units[0].classification,'discarded');assert.equal(input.units[0].reason,null);
});

test('a synthetic proposal cannot discard solely for not matching the catalog',()=>{
 // Synthetic names and document; signatures do not establish economic roles.
 const quote="CONVENI DE PROVA ENTRE EL CONSELL COMARCAL FICTICI I\nL'AJUNTAMENT DE PROVA PER A UN PROGRAMA SOCIAL ADREÇAT A LA INFÀNCIA";
 const doc={id:'synthetic-agreement',storage_sha256:'synthetic',extracted_text:`## Pàgina 1\n${quote}`};
 const evidence=[{document_id:doc.id,page:1,quote}];
 const unit:ConveniUnit={key:'',recipient:'Ajuntament de prova',recipient_nif:null,recipient_nature:'public',joint:false,period:'2025',year:2025,amount_cents:271400,amount_state:'planned',mixed:false,financiers:['Diputació de prova'],territory:null,classification:'discarded',service_code:null,population:'Infància i adolescència',description:'Programa social sintètic',explanation:'Revisió documental pendent',reason:'service_not_in_catalog',evidence,blockers:[]};
 const input:ConveniAnalysis={actors:[{name:unit.recipient,nif:null,nature:'public',roles:['signatory'],evidence}],units:[unit],instrument_grant:false,coverage_complete:true,unallocated_cents:0,summary:'Proposta pendent'};
 const payload={'Total aportacions previstes Generalitat':0,'Total aportacions previstes ens locals':2714};
 // Without an explicit social assessment the unit stays as a pending proposal.
 for(const reason of ['service_not_in_catalog','\u00a0SERVICE_NOT_IN_CATALOG\u00a0']){
  const kept=validateConveni({...input,units:[{...unit,reason}]},payload,[doc],new Set());
  assert.equal(kept.units[0].classification,'insufficient_evidence');assert.equal(kept.units[0].original_classification,'discarded');assert.equal(kept.units[0].reason,null);
  assert.ok(kept.diagnostics?.some(d=>d.code==='CONVENI_DISCARD_REASON_CONFLICT'&&d.field==='reason'));
 }
 // With a documented social service and population it becomes an outside proposal.
 const outside=validateConveni({...input,units:[{...unit,social_assessment:{status:'social',explanation:'Programa social documentat.',evidence}}]},payload,[doc],new Set());
 assert.equal(outside.units[0].classification,'out_of_portfolio');assert.equal(outside.units[0].original_classification,'discarded');
 assert.equal(unit.classification,'discarded');assert.equal(unit.reason,'service_not_in_catalog');
 const excluded=validateConveni({...input,units:[{...unit,reason:'interadministrative_agreement'}]},payload,[doc],new Set());
 assert.equal(excluded.units[0].reason,'interadministrative_agreement');
 assert.ok(excluded.units[0].blockers.includes('public_recipient'));
});
