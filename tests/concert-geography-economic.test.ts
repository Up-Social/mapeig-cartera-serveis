import {test} from 'node:test';
import assert from 'node:assert/strict';
import {concertEvolution,type EconomicUnit,type EconomicReview,type ConcertEvolutionData,type EconomicLink} from '../lib/concerts/evolution';
import {geographyEconomicContext,type ReviewedConcertGeography} from '../lib/concerts/supplemental-geography-projection';
const geography=(unit_id:string,patch:Partial<ReviewedConcertGeography>={}):ReviewedConcertGeography=>({economic_review_context:['2024-01-01','2024-12-31','2024-01-01'],id:1,unit_id,municipality:'Barcelona',county:'Barcelonès',province:'Barcelona',source_url:'https://example.org/capture',source_sha256:'a'.repeat(64),source_captured_at:'2025-01-01T00:00:00Z',review_id:'review',decision:'confirmed',reviewer:'Revisor declarat',rationale:'Contrast del servei i del període de la font.',reviewed_at:'2025-01-02T00:00:00Z',review_valid:true,review_fingerprint:'b'.repeat(32),conflict:false,...patch});
const unit=(id:string,act='award'):EconomicUnit=>({id,source_record_id:`record-${id}`,unit_key:`line-${id}`,act_type:act,status:'approved',source_fingerprint:`fp-${id}`,provider_name:'Entitat',observed_provider_name:null,provider_nif:'G12345678',reses_code:'S01150',service_code:'1.2.3',observed_service_code:'1.2.3',territory:null,period:'2024',amount:1000,effective_start:null,effective_end:null,horizon_state:'in_scope',document_id:`doc-${id}`,page:1,storage_path:`cases/${id}`,storage_sha256:`hash-${id}`,evidence_quote:`Línia ${id}`,supplemental_geography:geography(id)});
const review=(id:string,operation:EconomicReview['operation']='award',amount=100000):EconomicReview=>({unit_id:id,version:1,status:'approved',source_fingerprint:`fp-${id}`,expected_job_id:`job-${id}`,operation,amount_cents:amount,amount_kind:'exact',period_start:'2024-01-01',period_end:'2024-12-31',effective_at:'2024-01-01',funder:'Administració acreditada',corrects_unit_id:null,evidence_quote:'Import revisat',review_note:'Revisió econòmica independent'});
const data=(units=[unit('a')],reviews=[review('a')],links:EconomicLink[]=[]):ConcertEvolutionData=>({units,reviews,links,publications:units.map(u=>({id:u.source_record_id,title:'Resolució',job_id:`job-${u.id}`,job_status:'approved',official_url:null}))});
const project=(d:ConcertEvolutionData)=>concertEvolution(d,'2025-12-31');
const link=(later:string,earlier:string):EconomicLink=>({id:`link-${later}`,later_unit_id:later,earlier_unit_id:earlier,root_unit_id:earlier,status:'confirmed',version:1,evidence:'Relació explícita',relation_kind:'modification',review_note:'Revisat'});
test('confirmed geography fills the projection territory without changing evidence fingerprints, unit state or source data',()=>{
 const d=data(),original=structuredClone(d),p=project(d);assert.equal(p.balances[0].territory,'Barcelona');assert.equal(p.balances[0].amountCents,100000);assert.equal(p.movements[0].supplementalGeography?.review_id,'review');assert.deepEqual(d,original);assert.equal(d.units[0].territory,null);assert.equal(d.units[0].source_fingerprint,'fp-a');
});
test('pending, rejected, revoked, obsolete and conflicting geography never authorizes a missing territory',()=>{
 for(const patch of [{decision:null},{decision:'rejected'},{decision:'revoked'},{review_valid:false},{conflict:true},{review_id:null}]){
  const p=project(data([{...unit('a'),supplemental_geography:geography('a',patch)}]));assert.equal(p.pending,1);assert.equal(p.balances.length,0);assert.match(p.movements[0].issues.join(' '),/Territori pendent/);
 }
});
test('geography cannot supply missing funder or promote source drafts or economic reviews',()=>{
 for(const d of [data([unit('a')],[{...review('a'),funder:null}]),data([{...unit('a'),status:'draft'}]),data([unit('a')],[{...review('a'),status:'draft'}]),data([unit('a')],[{...review('a'),source_fingerprint:'outdated'}])]){
  const p=project(d);assert.equal(p.pending,1);assert.equal(p.balances.length,0);
 }
 assert.match(project(data([unit('a')],[{...review('a'),funder:null}])).movements[0].issues.join(' '),/Finançador no acreditat/);
});
test('reviewed supplement does not overwrite conflicting original territory',()=>{
 const d=data([{...unit('a'),territory:'Girona'}]),p=project(d);assert.equal(p.balances.length,0);assert.match(p.movements[0].issues.join(' '),/conflicte/);assert.equal(d.units[0].territory,'Girona');
});
test('linked changes need their own geography and cannot move the reviewed chain implicitly',()=>{
 for(const change of [{...unit('b','modification'),supplemental_geography:null},{...unit('b','modification'),supplemental_geography:geography('b',{municipality:'Girona',county:'Gironès',province:'Girona'})}]){
  const p=project(data([unit('a'),change],[review('a'),review('b','delta',20000)],[link('b','a')]));assert.equal(p.balances[0].amountCents,null);assert.equal(p.movements.find(m=>m.unitId==='b')?.status,'pending');
 }
 const p=project(data([unit('a'),unit('b','modification')],[review('a'),review('b','delta',20000)],[link('b','a')]));assert.equal(p.balances[0].amountCents,120000);
});
test('duplicate publications retain deduplication and reject conflicting supplementary scopes',()=>{
 const a=unit('a'),b={...unit('b'),storage_sha256:a.storage_sha256,unit_key:a.unit_key,evidence_quote:a.evidence_quote};
 const same=project(data([a,b],[review('a'),review('b')]));assert.equal(same.balances.length,1);assert.equal(same.balances[0].amountCents,100000);
 const conflict=project(data([a,{...b,supplemental_geography:geography('b',{municipality:'Girona'})}],[review('a'),review('b')]));assert.equal(conflict.balances.length,0);assert.equal(conflict.pending,2);assert.ok(conflict.movements.every(m=>m.issues.some(i=>i.includes('Territoris incompatibles'))));
});

test('economically excluded and future duplicate publications cannot block the current territorial scope',()=>{
 const a=unit('a'),b={...unit('b'),storage_sha256:a.storage_sha256,unit_key:a.unit_key,evidence_quote:a.evidence_quote,supplemental_geography:geography('b',{municipality:'Girona'})};
 for(const ignoredReview of [{...review('b'),status:'excluded' as const},{...review('b'),effective_at:'2026-01-01'}]){
  const p=project(data([a,b],[review('a'),ignoredReview]));assert.equal(p.balances.length,1);assert.equal(p.balances[0].amountCents,100000);assert.equal(p.balances[0].territory,'Barcelona');assert.ok(!p.movements.find(m=>m.unitId==='a')?.issues.some(i=>i.includes('Territoris incompatibles')));
 }
});

test('geography bound to a different effective economic period must be reviewed again',()=>{
 for(const changed of [{...review('a'),period_start:'2024-02-01'},{...review('a'),period_end:'2025-12-31'},{...review('a'),effective_at:'2024-02-01'}]){
  const p=project(data([unit('a')],[changed]));assert.equal(p.balances.length,0);assert.match(p.movements[0].issues.join(' '),/revisió geogràfica no correspon/);
 }
 const noReview=unit('a');noReview.supplemental_geography=geography('a',{economic_review_context:null});
 assert.equal(project(data([noReview],[])).pending,1);
 assert.match(project(data([noReview],[review('a')])).movements[0].issues.join(' '),/revisió geogràfica no correspon/);
 const fromDraft=unit('a');fromDraft.supplemental_geography=geography('a',{economic_review_context:geographyEconomicContext({...review('a'),status:'draft'})});
 assert.equal(project(data([fromDraft],[review('a')])).balances[0].amountCents,100000);
 assert.equal(project(data([fromDraft],[{...review('a'),status:'draft'}])).pending,1);
 const renewed=unit('a');renewed.supplemental_geography=geography('a',{economic_review_context:geographyEconomicContext({...review('a'),version:2})});
 assert.equal(project(data([renewed],[{...review('a'),version:2}])).balances[0].amountCents,100000);
});
