import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allocatePlurianual,projectConcertBalances,type ConcertFinancialLine} from '../lib/concerts/financial-ledger';

const base:ConcertFinancialLine={id:'a',agreementKey:'EXP-25',transactionKey:'NIF:RESES:service:2026',serviceCode:'1.2.3',period:'2026',territory:'Barcelona',funder:'Drets Socials',documentHash:'pdf-a',lineReference:'annex-1',effectiveAt:'2026-01-01',operation:'award',amountCents:100000,status:'approved'};
const line=(overrides:Partial<ConcertFinancialLine>):ConcertFinancialLine=>({...base,...overrides});

test('delta and replacement produce the current net, never total plus replacement',()=>{
 const balances=projectConcertBalances([base,line({id:'b',documentHash:'pdf-b',lineReference:'annex-2',effectiveAt:'2026-03-01',operation:'delta',amountCents:20000}),line({id:'c',documentHash:'pdf-c',lineReference:'annex-3',effectiveAt:'2026-04-01',operation:'replacement',amountCents:110000})]);
 assert.equal(balances[0].amountCents,110000);
});
test('a partial cessation reduces only its accredited amount',()=>{
 assert.equal(projectConcertBalances([base,line({id:'b',documentHash:'pdf-b',lineReference:'cessament',effectiveAt:'2026-02-01',operation:'delta',amountCents:-7000})])[0].amountCents,93000);
});
test('the same PDF and annex line under two publication IDs counts once',()=>{
 assert.equal(projectConcertBalances([base,line({id:'different-etauler-id'})])[0].amountCents,100000);
});
test('shared expediente in distinct territories remains two balances',()=>{
 const rows=projectConcertBalances([base,line({id:'lleida',documentHash:'pdf-lleida',territory:'Lleida',transactionKey:'NIF:RESES:Lleida:2026',amountCents:30000})]);
 assert.equal(rows.length,2);assert.equal(rows.reduce((sum,row)=>sum+(row.amountCents??0),0),130000);
});
test('two annex transactions for one service sum without multiplying a shared document line',()=>{
 const rows=projectConcertBalances([base,line({id:'b',transactionKey:'NIF:RESES:second-line',lineReference:'annex-2',amountCents:25000})]);
 assert.equal(rows[0].transactionCount,2);assert.equal(rows[0].amountCents,125000);
});
test('an unaccredited amount stays unknown, never zero',()=>{
 const rows=projectConcertBalances([line({amountCents:null,amountKind:'unknown'})]);
 assert.equal(rows[0].amountCents,null);assert.match(rows[0].issues.join(' '),/Import no acreditat/);
});
test('a delta without its base is incomplete',()=>{
 const rows=projectConcertBalances([line({operation:'delta',amountCents:1000})]);
 assert.equal(rows[0].amountCents,null);assert.match(rows[0].issues.join(' '),/base/);
});
test('a new period cannot change the previous year',()=>{
 const rows=projectConcertBalances([base,line({id:'renewal',documentHash:'pdf-next',lineReference:'2027',period:'2027',effectiveAt:'2027-01-01',operation:'renewal',amountCents:105000})]);
 assert.deepEqual(rows.map(row=>[row.period,row.amountCents]),[['2026',100000],['2027',105000]]);
});
test('a nonfinancial transfer or convalidation has no financial row',()=>{
 assert.deepEqual(projectConcertBalances([line({operation:'nonfinancial',amountCents:null})]),[]);
});
test('an emergency maximum remains explicitly marked',()=>{
 const rows=projectConcertBalances([line({amountKind:'maximum'})]);
 assert.equal(rows[0].amountCents,100000);assert.equal(rows[0].maximum,true);
});
test('different financing bodies retain separate balances',()=>{
 const rows=projectConcertBalances([base,line({id:'other',documentHash:'pdf-other',lineReference:'other',transactionKey:'other-funder',funder:'Consorci de Serveis Socials de Barcelona'})]);
 assert.equal(rows.length,2);
});
test('incompatible interpretations of the same documentary line block the result',()=>{
 const rows=projectConcertBalances([base,line({id:'conflict',amountCents:120000})]);
 assert.equal(rows[0].amountCents,null);assert.match(rows[0].issues.join(' '),/incompatibles/);
});
test('draft and rejected rows cannot affect the approved balance',()=>{
 const rows=projectConcertBalances([base,line({id:'draft',documentHash:'pdf-draft',lineReference:'draft',status:'draft',operation:'delta',amountCents:500000}),line({id:'rejected',documentHash:'pdf-rejected',lineReference:'rejected',status:'rejected',operation:'delta',amountCents:500000})]);
 assert.equal(rows[0].amountCents,100000);
});
test('annualities replace the displayed total, with exact-cent reconciliation',()=>{
 const result=allocatePlurianual(300000,[{year:2025,amountCents:100000},{year:2026,amountCents:200000}]);
 assert.deepEqual(result.rows,[{period:'2025',amountCents:100000},{period:'2026',amountCents:200000}]);assert.deepEqual(result.issues,[]);
 assert.match(allocatePlurianual(300001,[{year:2025,amountCents:100000},{year:2026,amountCents:200000}]).issues.join(' '),/no coincideix/);
});
