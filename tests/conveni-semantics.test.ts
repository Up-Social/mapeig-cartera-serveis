import test from 'node:test';
import assert from 'node:assert/strict';
import {conveniCitationDiagnostics,conveniUnitCollisions,conveniFundingDiagnostics,validateConveni,type ConveniAnalysis,type ConveniUnit} from '../lib/convenis/contract';
import {ConveniValidationError} from '../lib/convenis/diagnostics';
import {resolveConveniServices,serviceReference} from '../lib/convenis/semantics';
import {resolveConveniCitations,indexConveniCitations} from '../lib/convenis/citations';
const evidence={document_id:'doc',page:2,quote:'El projecte es dura a terme amb coordinació amb els Serveis Socials Bàsics.'};
const docs=[{id:'doc',storage_sha256:'hash',extracted_text:`## Pàgina 2\n${evidence.quote}`}];
const unit:ConveniUnit={key:'',recipient:'Entitat sintètica',recipient_nif:'G12345678',recipient_nature:'private',period:'2025',year:2025,amount_cents:10000,amount_state:'planned',joint:false,mixed:false,financiers:['Ajuntament'],territory:'Vic',classification:'in_portfolio',service_code:'1.1.1',population:'Persones en risc social',description:'Atenció social',explanation:'Proposta pendent de revisió',reason:null,evidence:[evidence],blockers:[],social_assessment:{status:'social',explanation:'Prestació social documentada',evidence:[evidence]}};
const bundle=(units=[unit]):ConveniAnalysis=>({actors:[{name:unit.recipient,nif:unit.recipient_nif,nature:'private',roles:['recipient'],evidence:[evidence]}],units,instrument_grant:true,coverage_complete:true,unallocated_cents:0,summary:'Fixture de comprovació'});
const services=[{service_code:'1.1.1',service_name:"Servei bàsic d'atenció social"},{service_code:'1.2.1.1',service_name:'Servei de tutela per a infants i adolescents en desemparament'}];
const validate=(a:ConveniAnalysis)=>validateConveni(a,{'Total aportacions previstes Generalitat':100,'Total aportacions previstes ens locals':0},docs,new Set(services.map(s=>s.service_code)),{requireSemanticAssessment:true});
test('outside requires an explicit positive social assessment; text fields alone do not suffice',()=>{
 for(const status of ['non_social','uncertain'] as const){
  const a=bundle([{...unit,classification:'out_of_portfolio',service_code:null,social_assessment:{...unit.social_assessment!,status}}]);
  assert.throws(()=>validate(a),(e:unknown)=>e instanceof ConveniValidationError&&e.diagnostic.code==='CONVENI_SOCIAL_CLASSIFICATION_CONFLICT');
  assert.equal(a.units[0].classification,'out_of_portfolio'); // Never silently reclassify.
 }
 assert.throws(()=>validate(bundle([{...unit,social_assessment:undefined}])),(e:unknown)=>e instanceof ConveniValidationError&&e.diagnostic.code==='CONVENI_SOCIAL_ASSESSMENT_MISSING');
 assert.deepEqual(validate(bundle()).units[0].blockers,[]);
});
test('service selection binds official code and name and rejects a mixed or missing reference',()=>{
 const response=bundle([{...unit,service_ref:serviceReference(services[0])} as ConveniUnit]);
 const resolved=resolveConveniServices(response,services).units[0];
 assert.equal(resolved.service_code,'1.1.1');assert.equal(resolved.service_name,services[0].service_name);
 for(const service_ref of [undefined,'1.1.1',`1.2.1.1 · ${services[0].service_name}`])assert.throws(()=>resolveConveniServices(bundle([{...unit,service_ref} as ConveniUnit]),services),ConveniValidationError);
 assert.equal(response.units[0].service_name,undefined);
});
test('same recipient and period with different concepts is an unresolved collision, not a proven duplicate',()=>{
 const units=[{...unit,amount_cents:10500000,mixed:true},{...unit,amount_cents:1400000}];
 const issues=conveniUnitCollisions(units);assert.equal(issues.length,1);assert.equal(issues[0].code,'CONVENI_RECIPIENT_PERIOD_COLLISION');
 assert.deepEqual(issues[0].units?.map(u=>u.amount_cents),[10500000,1400000]);
 assert.throws(()=>validate(bundle(units)),ConveniValidationError);assert.equal(units.length,2);
});
test('quote diagnostics identify field and page without treating an OCR accent difference as a literal quote',()=>{
 const quote=evidence.quote.replace('dura','durà');
 const a=bundle([{...unit,evidence:[{...evidence,quote}]}]);const issues=conveniCitationDiagnostics(a,docs);
 assert.equal(issues.length,1);assert.equal(issues[0].field,'units[0].evidence[0]');assert.equal(issues[0].page,2);assert.equal(issues[0].quote,quote);
 assert.equal(issues[0].code,'CONVENI_CITATION_DIACRITIC_VARIANT');assert.equal(issues[0].requiresVisualReview,true);
 assert.throws(()=>validate(a),ConveniValidationError);
});
test('social-assessment evidence is resolved and validated against literal source spans too',()=>{
 const {spans}=indexConveniCitations(docs);
 const a=bundle();a.actors[0].evidence=['Q1'] as never;a.units[0]={...unit,evidence:['Q1'] as never,social_assessment:{...unit.social_assessment!,evidence:['Q1'] as never}};
 const resolved=resolveConveniCitations(a,spans);assert.deepEqual(resolved.units[0].social_assessment?.evidence,[evidence]);
 a.units[0].social_assessment!.evidence=['Q999'] as never;assert.throws(()=>resolveConveniCitations(a,spans));
});
test('identity collisions do not hide an independently missing financial row',()=>{
 const a=bundle([{...unit,amount_cents:10500000},{...unit,amount_cents:1400000},{...unit,recipient:'Altres receptors',amount_cents:45126400}]);
 const payload={'Total aportacions previstes Generalitat':578000,'Total aportacions previstes ens locals':0};
 const [gap]=conveniFundingDiagnostics(a,payload);assert.equal(gap.difference_cents,773600);assert.equal(gap.allocated_cents,57026400);
 assert.throws(()=>validateConveni(a,payload,docs,new Set(['1.1.1'])),(e:unknown)=>e instanceof ConveniValidationError&&e.diagnostics.some(d=>d.code==='CONVENI_RECIPIENT_PERIOD_COLLISION')&&e.diagnostics.some(d=>d.difference_cents===773600));
 assert.equal(a.unallocated_cents,0); // Never invent a residual to make it balance.
});
test('financial totals cannot exceed exact integer cents through aggregate overflow',()=>{
 const a=bundle([{...unit,amount_cents:Number.MAX_SAFE_INTEGER},{...unit,recipient:'Altra entitat',amount_cents:Number.MAX_SAFE_INTEGER}]);
 assert.equal(conveniFundingDiagnostics(a,{'Total aportacions previstes Generalitat':100,'Total aportacions previstes ens locals':0})[0].code,'CONVENI_AMOUNT_OVERFLOW');
});
test('documented recipient aliases can share NIF, but NIF alone or contradictory actors cannot establish private nature',()=>{
 const a=bundle();a.actors[0].name='Una altra grafia de la mateixa entitat';a.actors[0].nif='G-12345678';
 assert.deepEqual(validate(a).units[0].blockers,[]);
 for(const nature of ['public','unknown'] as const){const b=structuredClone(a);b.actors[0].nature=nature;assert.ok(validate(b).units[0].blockers.includes('unknown_recipient'));}
 const conflicting=structuredClone(a);conflicting.actors.push({...a.actors[0],nature:'public'});assert.ok(validate(conflicting).units[0].blockers.includes('unknown_recipient'));
 const different=bundle();different.actors[0].nif='G87654321';assert.ok(validate(different).units[0].blockers.includes('unknown_recipient'));
 const signerOnly=structuredClone(a);signerOnly.actors[0].roles=['signatory'];assert.ok(validate(signerOnly).units[0].blockers.includes('unknown_recipient'));
});
