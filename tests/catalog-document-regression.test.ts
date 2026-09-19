import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../data/legal/cartera.json';
import {applyPositiveAudit,positiveAuditInput} from '../lib/cloud/positive-audit';
import type {OfficialService} from '../lib/official-catalog';
import type {AnalysisOutput} from '../lib/analysis-contract';
test('1.2.7.3 residential care cannot replace 1.2.7.5 pre-employment on a literal code alone',()=>{
 const all=catalog.services as OfficialService[];
 const chunks=[{content:'Servei prelaboral per a persones de 18 a 50 anys amb malaltia mental: capacitació i preparació per a la inserció laboral, sense allotjament residencial.'}];
 const result:AnalysisOutput={classification:'in_portfolio',reasons:[],explanation:'Proposta automàtica fictícia pendent de contrast.',service_description:'Preparació prelaboral',target_population:'Persones de 18 a 50 anys',population_verified:true,social_service_verified:true,evidence_ordinals:[1],candidates:['1.2.7.3','1.2.7.5'].map((code,i)=>({code,score:.9-i/10,rationale:'Fixture',evidence_explanation:'Fixture',evidence_ordinals:[1],population_compatible:true,legal_reference:all.find(s=>s.service_code===code)!.legal_reference}))};
 const checks=result.candidates.map(c=>({code:c.code,service_name:all.find(s=>s.service_code===c.code)!.service_name,compatible:c.code==='1.2.7.5',explanation:c.code==='1.2.7.5'?'La preparació laboral i els destinataris coincideixen amb el servei prelaboral.':'El document no acredita allotjament ni atenció residencial assistida.',evidence_ordinal:1,quote:c.code==='1.2.7.5'?chunks[0].content:''}));
 assert.deepEqual(applyPositiveAudit(result,{checks},all,chunks).candidates.map(c=>c.code),['1.2.7.5']);
 assert.throws(()=>applyPositiveAudit(result,{checks:checks.map(c=>({...c,quote:c.compatible?'1.2.7.5':''}))},all,[{content:'1.2.7.5'}]));
 const input=JSON.parse(positiveAuditInput(result,all,'General',chunks));assert.ok(input.services.every((s:{description:string;target_population:string})=>s.description&&s.target_population));
});
