import {test} from 'node:test';
import assert from 'node:assert/strict';
import {concertEvolution,isConcertCutoff,euroCents,allocateByWeights,type ConcertEvolutionData,type EconomicUnit,type EconomicReview,type EconomicLink} from '../lib/concerts/evolution';
import {projectConcertBalances,type ConcertFinancialLine} from '../lib/concerts/financial-ledger';
import {proposeUnitLinks,type ConcertUnitForLink} from '../lib/concerts/unit-linking';
const unit=(id:string,act='award'):EconomicUnit=>({id,source_record_id:`record-${id}`,unit_key:`line-${id}`,act_type:act,status:'approved',source_fingerprint:`fp-${id}`,provider_name:'Entitat original',observed_provider_name:null,provider_nif:'G12345678',reses_code:'S01150',service_code:'1.2.3',observed_service_code:'1.2.3',territory:'Barcelona',period:'2024',amount:1000,effective_start:null,effective_end:null,horizon_state:'in_scope',document_id:`doc-${id}`,page:1,storage_path:`cases/${id}`,storage_sha256:`hash-${id}`,evidence_quote:`Passatge oficial de la línia ${id}`});
const review=(id:string,operation:EconomicReview['operation']='award',amount=100000):EconomicReview=>({unit_id:id,version:1,status:'approved',source_fingerprint:`fp-${id}`,expected_job_id:`job-${id}`,operation,amount_cents:amount,amount_kind:'exact',period_start:'2024-01-01',period_end:'2024-12-31',effective_at:'2024-01-01',funder:'Drets Socials',corrects_unit_id:null,evidence_quote:'Passatge literal oficial del PDF',review_note:'Contrast documental realitzat'});
const link=(later:string,earlier:string,status='confirmed'):EconomicLink=>({id:`${later}-${earlier}`,later_unit_id:later,earlier_unit_id:earlier,root_unit_id:'a',status,version:1,evidence:'Resolució original citada al document',relation_kind:'modification',review_note:'Contrast del document realitzat'});
const data=(units=[unit('a')],reviews=[review('a')],links:EconomicLink[]=[]):ConcertEvolutionData=>({units,reviews,links,publications:units.map(u=>({id:u.source_record_id,title:`Resolució ${u.id}`,job_id:`job-${u.id}`,job_status:'approved',official_url:null}))});
const projection=(d:ConcertEvolutionData)=>concertEvolution(d,'2026-10-14');
test('original, enlargement and reduction calculate a single explained balance',()=>{
 const d=data([unit('a'),unit('b','modification'),unit('c','termination')],[review('a'),{...review('b','delta',20000),effective_at:'2024-02-01'},{...review('c','delta',-7000),effective_at:'2024-03-01'}],[link('b','a'),link('c','b')]);
 const p=projection(d);assert.equal(p.balances[0].amountCents,113000);assert.equal(p.movements[2].beforeCents,120000);assert.equal(p.movements[2].afterCents,113000);
});
test('replacement means new total rather than adding that total',()=>{
 const p=projection(data([unit('a'),unit('b','modification')],[review('a'),{...review('b','replacement',70000),effective_at:'2024-02-01'}],[link('b','a')]));
 assert.equal(p.balances[0].amountCents,70000);
});
test('same-day predecessor order cannot depend on alphabetical UUID order',()=>{
 const p=projection(data([unit('z'),unit('a','modification')],[review('z'),review('a','delta',20000)],[link('a','z')]));assert.equal(p.balances[0].amountCents,120000);
});
test('renewal finances a new period without touching the prior year',()=>{
 const p=projection(data([unit('a'),unit('b','renewal')],[review('a'),{...review('b','renewal',130000),period_start:'2025-01-01',period_end:'2025-12-31',effective_at:'2025-01-01'}],[link('b','a')]));assert.deepEqual(p.balances.map(b=>b.amountCents),[100000,130000]);
});
test('overlapping renewal blocks a definitive balance',()=>{
 const p=projection(data([unit('a'),unit('b','renewal')],[review('a'),{...review('b','renewal',130000),period_start:'2024-07-01',period_end:'2025-06-30',effective_at:'2024-07-01'}],[link('b','a')]));assert.equal(p.balances[0].amountCents,null);assert.match(p.movements[1].issues.join(' '),/solapats/);
});
test('correction of an initial amount replays later increases',()=>{
 const p=projection(data([unit('a'),unit('b','modification'),unit('c','amendment')],[review('a'),{...review('b','delta',20000),effective_at:'2024-02-01'},{...review('c','correction',90000),corrects_unit_id:'a',effective_at:'2024-03-01'}],[link('b','a'),link('c','b')]));assert.equal(p.balances[0].amountCents,110000);
});
test('unrelated correction is blocked rather than applied to another concert',()=>{
 const p=projection(data([unit('a'),unit('x'),unit('c','amendment')],[review('a'),review('x'),{...review('c','correction',90000),corrects_unit_id:'x'}],[link('c','a')]));assert.equal(p.balances.find(b=>b.rootId==='a')?.amountCents,null);
});
test('cession preserves money and history while the current picture shows the new holder',()=>{
 const p=projection(data([unit('a'),{...unit('b','cession'),provider_name:'Entitat nova',provider_nif:'G87654321'}],[review('a'),{...review('b','nonfinancial'),amount_cents:null,effective_at:'2024-02-01'}],[link('b','a')]));assert.equal(p.balances[0].amountCents,100000);assert.equal(p.balances[0].provider,'Entitat nova');assert.equal(p.movements[0].provider,'Entitat original');assert.equal(p.movements[1].provider,'Entitat nova');
});
test('no false zero for absent amount and no final balance for candidate child',()=>{
 const d=data([unit('a'),unit('b','modification')],[review('a'),{...review('b','delta'),status:'draft',amount_cents:null}],[link('b','a','candidate')]);const p=projection(d);assert.equal(p.balances[0].amountCents,null);assert.equal(p.movements[1].amountCents,null);
});
test('pre-2024 orphan stays excluded without creating a base',()=>{
 const p=projection(data([{...unit('b','renewal'),horizon_state:'pre_2024_origin_unavailable'}],[review('b','renewal')]));assert.equal(p.excluded,1);assert.equal(p.balances.length,0);
});
test('source or latest analysis changes invalidate the economic review',()=>{
 for(const variant of ['source','job']){const d=data();if(variant==='source')d.units[0].source_fingerprint='new';else d.publications[0].job_id='rerun';assert.equal(projection(d).pending,1);assert.equal(projection(d).balances.length,0);}
});
test('cycles, multiple mothers and missing mothers never give a balance',()=>{
 const d=data([unit('a','modification'),unit('b','modification')],[review('a','delta'),review('b','delta')],[link('a','b'),link('b','a')]);assert.equal(projection(d).balances.length,0);assert.match(projection(d).movements[0].issues.join(' '),/Cicle/);
 d.links=[];assert.match(projection(d).movements[0].issues.join(' '),/original/);
});
test('cutoff excludes later effects and refuses invalid dates',()=>{
 const d=data([unit('a'),unit('b','modification')],[review('a'),{...review('b','delta',20000),effective_at:'2024-02-01'}],[link('b','a')]);assert.equal(concertEvolution(d,'2024-01-31').balances[0].amountCents,100000);assert.throws(()=>concertEvolution(d,'2024-02-31'));
 for(const date of ['','2024-02-31','not-a-date','2024-1-01'])assert.equal(isConcertCutoff(date),false);
 assert.equal(isConcertCutoff('2024-02-29'),true);
});
test('duplicate archived line across publications is counted once',()=>{
 const a=unit('a'),b={...unit('b'),storage_sha256:a.storage_sha256,unit_key:a.unit_key,evidence_quote:a.evidence_quote};const p=projection(data([a,b],[review('a'),review('b')]));assert.equal(p.balances.length,1);assert.equal(p.balances[0].amountCents,100000);
});
test('repeated execution of projection is idempotent and does not mutate evidence',()=>{
 const d=data(),copy=structuredClone(d);assert.deepEqual(projection(d),projection(d));assert.deepEqual(d,copy);
});
test('cents are exact and proportional allocation preserves every cent',()=>{
 assert.equal(euroCents('442343.16'),44234316);assert.equal(euroCents('-75,39'),-7539);assert.equal(euroCents('1.234'),null);assert.equal(euroCents(''),null);assert.equal(euroCents('9007199254740992'),null);
 assert.deepEqual(allocateByWeights(100,[1,1,1]),[34,33,33]);assert.equal(allocateByWeights(10268709,[712260,7707033,1849416]).reduce((a,b)=>a+b,0),10268709);assert.throws(()=>allocateByWeights(100,[0,0]));
});
test('ledger rejects overflow, negative net and unknown kind, resets a replaced maximum',()=>{
 const a:ConcertFinancialLine={id:'a',agreementKey:'a',transactionKey:'a',serviceCode:'s',period:'2024',territory:'B',funder:'D',documentHash:'a',lineReference:'a',effectiveAt:'2024-01-01',operation:'award',amountCents:100,status:'approved',amountKind:'maximum'};
 const b={...a,id:'b',documentHash:'b',effectiveAt:'2024-02-01',operation:'delta' as const,amountCents:-101};assert.equal(projectConcertBalances([a,b])[0].amountCents,null);
 assert.equal(projectConcertBalances([{...a,amountCents:Number.MAX_SAFE_INTEGER},{...b,amountCents:1}])[0].amountCents,null);
 assert.equal(projectConcertBalances([{...a,amountKind:'unknown'}])[0].amountCents,null);
 assert.equal(projectConcertBalances([a,{...b,operation:'replacement',amountCents:50,amountKind:'exact'}])[0].maximum,false);
});
const lu=(id:string,patch:Partial<ConcertUnitForLink>={}):ConcertUnitForLink=>({id,recordId:id,recordTitle:'Resolució DSI/100/2024',recordExternalId:'etauler:1:'+id,publishedAt:'2024-01-01',actType:'award',resesCode:'S01150',providerNif:'G12345678',serviceCode:'1.2.3',territory:'Barcelona',originReference:null,period:'2024',...patch});
test('references embedded in a passage take priority over other RESES/NIF candidates',()=>{
 const links=proposeUnitLinks([lu('a'),lu('b',{recordTitle:'Resolució DSI/200/2024'}),lu('c',{actType:'modification',publishedAt:'2024-03-01',originReference:'Es modifica la Resolució DSI/100/2024 de gener'})]);assert.deepEqual(links.map(l=>l.earlierUnitId),['a']);
});
test('same RESES and both documented parties can propose a cession despite the changed NIF',()=>{
 const links=proposeUnitLinks([lu('a'),lu('b',{actType:'cession',publishedAt:'2024-02-01',providerNif:'G87654321',referenceText:'Cessió de G12345678 a G87654321 del servei S01150'})]);assert.equal(links.length,1);assert.match(links[0].evidence,/NIF anterior/);
});
test('publication identifier alone never links different entities',()=>{
 assert.deepEqual(proposeUnitLinks([lu('a'),lu('b',{actType:'cession',publishedAt:'2024-02-01',providerNif:'G87654321',originReference:'etauler:1:a'})]),[]);
});
test('a printed group code keeps all RESES/NIF alternatives for review without equating leaf services',()=>{
 const originals=[lu('a',{serviceCode:'1.2.6.2.4.1'}),lu('b',{serviceCode:'1.2.6.2.4.1'})];
 const change=lu('c',{actType:'modification',publishedAt:'2024-03-01',serviceCode:'1.2.6.2.4.1.1'});
 const candidates=proposeUnitLinks([...originals,change]);
 assert.deepEqual(candidates.map(c=>c.earlierUnitId),['a','b']);
 assert.ok(candidates.every(c=>c.method==='reses_nif'&&c.evidence.includes('no acredita equivalència')));
 assert.deepEqual(proposeUnitLinks([lu('a',{serviceCode:'1.2.6.2.4.1.2'}),change]),[]);
 assert.deepEqual(proposeUnitLinks([lu('a',{serviceCode:'1.2.6.2.4.10'}),change]),[]);
 assert.deepEqual(proposeUnitLinks([...originals,{...change,resesCode:null}]),[]);
 assert.deepEqual(proposeUnitLinks([...originals,{...change,providerNif:null}]),[]);
});
test('SIE annualities are explicit rather than multiplying an annual price by four',()=>{
 const d=data();d.reviews[0]={...review('a'),period_start:'2025-10-01',period_end:'2029-09-30',effective_at:'2025-10-01',amount_cents:176937264,annualities:[
 {start:'2025-10-01',end:'2025-12-31',amountCents:11058579},{start:'2026-01-01',end:'2026-12-31',amountCents:44234316},
 {start:'2027-01-01',end:'2027-12-31',amountCents:44234316},{start:'2028-01-01',end:'2028-12-31',amountCents:44234316},{start:'2029-01-01',end:'2029-09-30',amountCents:33175737}]};
 const p=projection(d);assert.equal(p.balances.length,5);assert.equal(p.balances.reduce((s,b)=>s+(b.amountCents??0),0),176937264);
 d.reviews[0].amount_cents=44234316;assert.equal(projection(d).pending,1);assert.equal(projection(d).balances.length,0);
});
test('a partial-period delta reduces its containing annual base without annualizing',()=>{
 const d=data([unit('a'),unit('b','termination')],[review('a'),{...review('b','delta',-10000),period_start:'2024-07-01',effective_at:'2024-07-01'}],[link('b','a')]);assert.equal(projection(d).balances[0].amountCents,90000);
});
test('a publication with missing change lines blocks the original final balance',()=>{
 const d=data();d.missingLines=[{earlier_record_id:'record-a',later_record_id:'record-b',evidence:'Referència explícita'}];assert.equal(projection(d).balances[0].amountCents,null);
});
test('an unlinked related publication cannot create a second definitive root',()=>{
 const d=data([unit('a'),unit('b')],[review('a'),review('b')]);
 d.missingLines=[{earlier_record_id:'record-a',later_record_id:'record-b',evidence:'Possible esmena'}];
 const balances=projection(d).individualBalances;
 assert.equal(balances.length,2);
 assert.ok(balances.every(balance=>balance.amountCents===null));
});
test('simultaneous sibling replacements cannot be ordered by arbitrary IDs',()=>{
 const p=projection(data([unit('a'),unit('b','modification'),unit('c','modification')],[review('a'),{...review('b','replacement',120000),effective_at:'2024-02-01'},{...review('c','replacement',130000),effective_at:'2024-02-01'}],[link('b','a'),link('c','a')]));assert.equal(p.balances[0].amountCents,null);assert.match(p.movements[1].issues.join(' '),/simultanis/);
});
test('a maximum reduction cannot be labelled as an exact or maximum resulting balance',()=>{
 const d=data([unit('a'),unit('b','termination')],[review('a'),{...review('b','delta',-10000),amount_kind:'maximum',effective_at:'2024-07-01'}],[link('b','a')]);assert.equal(projection(d).balances[0].amountCents,null);
});

test('pending human validation is distinguished from a superseded analysis',()=>{
 const d=data();d.reviews[0].status='draft';d.publications[0].job_status='needs_review';
 let p=projection(d);assert.equal(p.balances.length,0);assert.match(p.movements[0].issues.join(' '),/pendent de validació humana/);assert.doesNotMatch(p.movements[0].issues.join(' '),/no coincideix/);
 d.publications[0].job_id='new-job';p=projection(d);assert.match(p.movements[0].issues.join(' '),/no coincideix/);
});
test('documented maxima remain marked in pending movements without inventing a balance',()=>{
 const d=data([unit('a','modification')],[{...review('a','delta',-8166528),status:'draft',amount_kind:'maximum',effective_at:null}]);
 const p=projection(d);assert.equal(p.balances.length,0);assert.equal(p.movements[0].amountKind,'maximum');assert.equal(p.movements[0].amountCents,-8166528);assert.match(p.movements[0].issues.join(' '),/Data d’efectes no acreditada/);assert.doesNotMatch(p.movements[0].issues.join(' '),/Finançador no acreditat|Període des de 2024 no acreditat/);
 const missing=projection(data([unit('a')],[]));assert.equal(missing.movements[0].amountKind,'unknown');assert.equal(missing.movements[0].amountCents,null);
});

test('the current picture consolidates NIF service territory while retaining distinct funders and periods',()=>{
 const a=unit('a'),b=unit('b'),c=unit('c');
 const d=data([a,b,c],[review('a'),review('b'),{...review('c'),funder:'Ajuntament'}]);
 const p=projection(d);assert.equal(p.balances.length,2);assert.equal(p.balances.find(b=>b.funder==='Drets Socials')?.amountCents,200000);assert.deepEqual(p.balances.find(b=>b.funder==='Drets Socials')?.rootIds,['a','b']);
});
test('competing cessions block attribution and later cessions do not change an earlier cutoff',()=>{
 const d=data([unit('a'),{...unit('b','cession'),provider_name:'Nova B',provider_nif:'G87654321'},{...unit('c','cession'),provider_name:'Nova C',provider_nif:'G87654322'}],[review('a'),{...review('b','nonfinancial'),amount_cents:null,effective_at:'2024-02-01'},{...review('c','nonfinancial'),amount_cents:null,effective_at:'2024-03-01'}],[link('b','a'),link('c','a')]);
 assert.equal(projection(d).balances[0].amountCents,null);assert.match(projection(d).balances[0].issues.join(' '),/Cessions concurrents/);
 assert.equal(concertEvolution(d,'2024-01-31').balances[0].provider,'Entitat original');
});

test('a malformed service code cannot match a documented code by punctuation normalization',()=>{
 const original=lu('a',{serviceCode:'1.2.3'});
 const change=lu('b',{actType:'modification',publishedAt:'2024-02-01',serviceCode:'1-2-3'});
 assert.deepEqual(proposeUnitLinks([original,change]),[]);
 assert.deepEqual(proposeUnitLinks([{...original,serviceCode:'1-2-3'},change]),[]);
 assert.equal(proposeUnitLinks([original,{...change,serviceCode:'1.2.3'}]).length,1);
});

test('simultaneous independent replacement and delta cannot acquire an invented ordering',()=>{
 const d=data([unit('a'),unit('b','modification'),unit('c','modification')],[review('a'),{...review('b','replacement',120000),effective_at:'2024-02-01'},{...review('c','delta',20000),effective_at:'2024-02-01'}],[link('b','a'),link('c','a')]);
 const result=projection(d);assert.equal(result.balances[0].amountCents,null);assert.ok(result.movements.some(m=>m.issues.some(issue=>/simultanis/.test(issue))));
 const ordered=data(d.units,d.reviews,[link('b','a'),link('c','b')]);
 assert.equal(projection(ordered).balances[0].amountCents,140000);
 const partial=structuredClone(d);partial.reviews[1].effective_at='2024-07-01';partial.reviews[2].effective_at='2024-07-01';partial.reviews[2].period_start='2024-07-01';
 assert.equal(projection(partial).balances[0].amountCents,null);
});

test('a pending sibling in the same document blocks the consolidated picture but preserves the individual balance',()=>{
 const source=unit('a'),out={...unit('out','modification'),source_record_id:'transfer',document_id:'transfer-doc'},incoming={...unit('in','modification'),source_record_id:'transfer',document_id:'transfer-doc',reses_code:'S12345'};
 const reviews=[review('a'),{...review('out','delta',-30000),expected_job_id:'job-transfer',effective_at:'2024-02-01'},
  {...review('in','delta',30000),expected_job_id:'job-transfer',effective_at:'2024-02-01'}];
 const d=data([source,out,incoming],reviews,[link('out','a')]);
 d.publications=[{id:source.source_record_id,title:'Adjudicació',job_id:'job-a',job_status:'approved',official_url:null},{id:'transfer',title:'Modificació',job_id:'job-transfer',job_status:'approved',official_url:null}];
 const p=projection(d);
 assert.equal(p.movements.find(m=>m.unitId==='in')?.status,'pending');
 assert.equal(p.movements.find(m=>m.unitId==='out')?.afterCents,70000);
 assert.equal(p.individualBalances.find(b=>b.rootId==='a')?.amountCents,70000);
 assert.equal(p.balances[0].amountCents,null);assert.match(p.balances[0].issues.join(' '),/línia pendent del mateix document/);
 assert.doesNotMatch(p.balances[0].issues.join(' '),/trasllat/i);
});
test('two independently linked and reviewed changes preserve the consolidated sum without inventing a pair',()=>{
 const a=unit('a'),b={...unit('b'),reses_code:'S12345'},out={...unit('out','modification'),source_record_id:'transfer',document_id:'transfer-doc'},incoming={...unit('in','modification'),source_record_id:'transfer',document_id:'transfer-doc',reses_code:'S12345'};
 const reviews=[review('a'),{...review('b','award',50000)},{...review('out','delta',-30000),expected_job_id:'job-transfer',effective_at:'2024-02-01'},
  {...review('in','delta',30000),expected_job_id:'job-transfer',effective_at:'2024-02-01'}];
 const d=data([a,b,out,incoming],reviews,[link('out','a'),link('in','b')]);
 d.publications=[{id:a.source_record_id,title:'Original A',job_id:'job-a',job_status:'approved',official_url:null},{id:b.source_record_id,title:'Original B',job_id:'job-b',job_status:'approved',official_url:null},{id:'transfer',title:'Modificació',job_id:'job-transfer',job_status:'approved',official_url:null}];
 const p=projection(d);assert.equal(p.pending,0);assert.equal(p.balances.length,1);assert.equal(p.balances[0].amountCents,150000);
 assert.deepEqual(p.individualBalances.map(b=>b.amountCents).sort((x,y)=>(x??0)-(y??0)),[70000,80000]);
});
test('a pending line in a different document does not block, but a different entity in the same act remains uncertain',()=>{
 const a=unit('a'),out={...unit('out','modification'),source_record_id:'transfer',document_id:'doc-1'},other={...unit('in','modification'),source_record_id:'transfer',document_id:'doc-2'};
 const reviews=[review('a'),{...review('out','delta',-30000),expected_job_id:'job-transfer',effective_at:'2024-02-01'},{...review('in','delta',30000),expected_job_id:'job-transfer',effective_at:'2024-02-01'}];
 const d=data([a,out,other],reviews,[link('out','a')]);d.publications=[{id:a.source_record_id,title:'Original',job_id:'job-a',job_status:'approved',official_url:null},{id:'transfer',title:'Modificació',job_id:'job-transfer',job_status:'approved',official_url:null}];
 assert.equal(projection(d).balances[0].amountCents,70000);
 other.document_id='doc-1';other.provider_nif='G87654321';other.service_code='1.2.4';
 assert.equal(projection(d).balances[0].amountCents,null,'a different approved identity or service cannot rule out a transfer within the act');
 assert.equal(projection(d).individualBalances[0].amountCents,70000);
});

test('a pending line in a 2024 act does not block a separately evidenced 2025 annual balance',()=>{
 const a=unit('a'),out={...unit('out','modification'),source_record_id:'transfer',document_id:'transfer-doc'},pending={...unit('in','modification'),source_record_id:'transfer',document_id:'transfer-doc'};
 const award={...review('a','award',200000),period_end:'2025-12-31',annualities:[{start:'2024-01-01',end:'2024-12-31',amountCents:100000},{start:'2025-01-01',end:'2025-12-31',amountCents:100000}]};
 const d=data([a,out,pending],[award,{...review('out','delta',-30000),expected_job_id:'job-transfer',effective_at:'2024-02-01'},
  {...review('in','delta',30000),expected_job_id:'job-transfer',effective_at:'2024-02-01'}],[link('out','a')]);
 d.publications=[{id:a.source_record_id,title:'Original',job_id:'job-a',job_status:'approved',official_url:null},{id:'transfer',title:'Modificació',job_id:'job-transfer',job_status:'approved',official_url:null}];
 const p=projection(d);assert.equal(p.balances.find(b=>b.period.startsWith('2024'))?.amountCents,null);
 assert.equal(p.balances.find(b=>b.period.startsWith('2025'))?.amountCents,100000);
 d.reviews[2].period_start=null;d.reviews[2].period_end=null;
 assert.equal(projection(d).balances.find(b=>b.period.startsWith('2024'))?.amountCents,null,'unknown pending period must remain conservative');
});
test('a rejected or out-of-horizon sibling does not create a simultaneous economic conflict',()=>{
 for(const patch of [{status:'rejected'},{horizon_state:'out_of_scope'}]){
  const d=data([unit('a'),unit('b','modification'),{...unit('c','modification'),...patch}],
   [review('a'),{...review('b','replacement',120000),effective_at:'2024-02-01'}, {...review('c','delta',20000),effective_at:'2024-02-01'}],
   [link('b','a'),link('c','a')]);
  const p=projection(d);assert.equal(p.balances[0].amountCents,120000);assert.ok(!p.balances[0].issues.some(issue=>/simultanis/.test(issue)));
 }
});
test('an excluded correction does not create an artificial concurrent correction',()=>{
 const a=unit('a'),b=unit('b','amendment'),c={...unit('c','amendment'),status:'rejected'};
 const d=data([a,b,c],[review('a'),{...review('b','correction',90000),corrects_unit_id:'a',effective_at:'2024-02-01'},
  {...review('c','correction',80000),corrects_unit_id:'a',effective_at:'2024-02-01'}],[link('b','a'),link('c','a')]);
 assert.equal(projection(d).balances[0].amountCents,90000);
});
test('a pending line without document identity cannot be ruled out of the same act',()=>{
 const a=unit('a'),out={...unit('out','modification'),source_record_id:'transfer',document_id:'transfer-doc'},other={...unit('in','modification'),source_record_id:'transfer',document_id:null};
 const d=data([a,out,other],[review('a'),{...review('out','delta',-30000),expected_job_id:'job-transfer',effective_at:'2024-02-01'},
  {...review('in','delta',30000),expected_job_id:'job-transfer',effective_at:'2024-02-01'}],[link('out','a')]);
 d.publications=[{id:a.source_record_id,title:'Original',job_id:'job-a',job_status:'approved',official_url:null},{id:'transfer',title:'Modificació',job_id:'job-transfer',job_status:'approved',official_url:null}];
 const p=projection(d);assert.equal(p.balances[0].amountCents,null);assert.equal(p.individualBalances[0].amountCents,70000);
 assert.match(p.balances[0].issues.join(' '),/document no identificat/);
});
test('a reviewed change does not block a separate funder in the same root and period',()=>{
 const a=unit('a'),renewal=unit('renewal','renewal'),out={...unit('out','modification'),source_record_id:'transfer',document_id:'transfer-doc'},pending={...unit('in','modification'),source_record_id:'transfer',document_id:'transfer-doc'};
 const d=data([a,renewal,out,pending],[review('a'),{...review('renewal','renewal',50000),funder:'Ajuntament',effective_at:'2024-01-01'},
  {...review('out','delta',-30000),expected_job_id:'job-transfer',effective_at:'2024-02-01'},
  {...review('in','delta',30000),expected_job_id:'job-transfer',effective_at:'2024-02-01'}],[link('renewal','a'),link('out','a')]);
 d.publications=[{id:a.source_record_id,title:'Original',job_id:'job-a',job_status:'approved',official_url:null},
  {id:renewal.source_record_id,title:'Pròrroga',job_id:'job-renewal',job_status:'approved',official_url:null},
  {id:'transfer',title:'Modificació',job_id:'job-transfer',job_status:'approved',official_url:null}];
 const p=projection(d);assert.equal(p.balances.find(b=>b.funder==='Drets Socials')?.amountCents,null);
 assert.equal(p.balances.find(b=>b.funder==='Ajuntament')?.amountCents,50000);
});
test('a pending sibling with another evidenced funder or territory does not block this scoped balance',()=>{
 const a=unit('a'),out={...unit('out','modification'),source_record_id:'transfer',document_id:'transfer-doc'},incoming={...unit('in','modification'),source_record_id:'transfer',document_id:'transfer-doc'};
 const d=data([a,out,incoming],[review('a'),{...review('out','delta',-30000),expected_job_id:'job-transfer',effective_at:'2024-02-01'},
  {...review('in','delta',30000),funder:'Ajuntament',expected_job_id:'job-transfer',effective_at:'2024-02-01'}],[link('out','a')]);
 d.publications=[{id:a.source_record_id,title:'Original',job_id:'job-a',job_status:'approved',official_url:null},{id:'transfer',title:'Modificació',job_id:'job-transfer',job_status:'approved',official_url:null}];
 assert.equal(projection(d).balances[0].amountCents,70000);
 d.reviews[2].status='draft';assert.equal(projection(d).balances[0].amountCents,null,'an unreviewed funding value cannot rule out impact');
 d.reviews[2].status='approved';d.reviews[2].funder='Drets Socials';incoming.territory='Girona';assert.equal(projection(d).balances[0].amountCents,70000);
 incoming.status='draft';assert.equal(projection(d).balances[0].amountCents,null,'an unreviewed territory cannot rule out impact');
});


test('a pending sibling with evidenced funder B blocks B even if the reviewed endpoint affects A',()=>{
 const a=unit('a'),renewal=unit('renewal','renewal'),out={...unit('out','modification'),source_record_id:'transfer',document_id:'transfer-doc'},pending={...unit('in','modification'),source_record_id:'transfer',document_id:'transfer-doc'};
 const d=data([a,renewal,out,pending],[review('a'),{...review('renewal','renewal',50000),funder:'Ajuntament'},
  {...review('out','delta',-30000),expected_job_id:'job-transfer',effective_at:'2024-02-01'},
  {...review('in','delta',30000),funder:'Ajuntament',expected_job_id:'job-transfer',effective_at:'2024-02-01'}],[link('renewal','a'),link('out','a')]);
 d.publications=[{id:a.source_record_id,title:'Original',job_id:'job-a',job_status:'approved',official_url:null},{id:renewal.source_record_id,title:'Pròrroga',job_id:'job-renewal',job_status:'approved',official_url:null},{id:'transfer',title:'Modificació',job_id:'job-transfer',job_status:'approved',official_url:null}];
 const p=projection(d);assert.equal(p.balances.find(b=>b.funder==='Drets Socials')?.amountCents,70000);assert.equal(p.balances.find(b=>b.funder==='Ajuntament')?.amountCents,null);
 d.reviews[3].status='draft';const unknown=projection(d);assert.equal(unknown.balances.find(b=>b.funder==='Drets Socials')?.amountCents,null);assert.equal(unknown.balances.find(b=>b.funder==='Ajuntament')?.amountCents,null);
});
test('duplicate documentary roots preserve pending changes and cessions attached to either root',()=>{
 const a=unit('a'),b={...unit('b'),storage_sha256:a.storage_sha256,unit_key:a.unit_key,evidence_quote:a.evidence_quote},change=unit('c','modification');
 const d=data([a,b,change],[review('a'),review('b'),{...review('c','delta',30000),status:'draft'}],[link('c','b')]);
 let p=projection(d);assert.equal(p.balances.length,1);assert.equal(p.balances[0].amountCents,null);assert.deepEqual(p.balances[0].rootIds,['a','b']);assert.match(p.balances[0].issues.join(' '),/pendent de revisió/);
 const cession={...unit('d','cession'),provider_name:'Nova entitat',provider_nif:'G87654321'};
 const d2=data([a,b,cession],[review('a'),review('b'),{...review('d','nonfinancial'),amount_cents:null,effective_at:'2024-02-01'}],[link('d','b')]);
 p=projection(d2);assert.equal(p.balances[0].providerNif,'G87654321');assert.equal(p.balances[0].amountCents,100000);
 const other={...unit('e','cession'),provider_nif:'G87654322'};d2.units.push(other);d2.reviews.push({...review('e','nonfinancial'),amount_cents:null,effective_at:'2024-03-01'});d2.links.push(link('e','a'));d2.publications.push({id:other.source_record_id,title:'Cessió',job_id:'job-e',job_status:'approved',official_url:null});
 p=projection(d2);assert.equal(p.balances[0].amountCents,null);assert.match(p.balances[0].issues.join(' '),/Cessions concurrents/);
});
test('individual award stays pending in evolution when its documentary decision is stale',()=>{
 const stale={...unit('a'),line_award_state:'stale' as const};
 const result=projection(data([stale],[review('a')]));
 assert.equal(result.movements[0].status,'pending');assert.match(result.movements[0].issues.join(' '),/adjudicació ha quedat obsoleta/);
 assert.ok(result.balances.every(balance=>balance.amountCents===null));
});
test('a current individual award still needs a separate economic interpretation and period',()=>{
 const current={...unit('a'),line_award_state:'current' as const};const result=projection(data([current],[]));
 assert.equal(result.movements[0].status,'pending');assert.match(result.movements[0].issues.join(' '),/Interpretació econòmica pendent/);
});
