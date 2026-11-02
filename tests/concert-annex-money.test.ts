import test from 'node:test';
import assert from 'node:assert/strict';
import {declaredEconomicAnnexTotal,declaredGeneralAnnexTotal,safeAnnexSum} from '../lib/concerts/annex-extraction';

const maximum=(amount:string)=>`RESOLC: import total màxim de ${amount} euros tal com s’indica a l’annex.`;
const economic=(amount:string)=>`${amount} euros, IVA inclòs, detallat a l’Annex 6.`;
test('declared amounts preserve integer cents at the safe precision boundary',()=>{
 assert.equal(declaredGeneralAnnexTotal(maximum('90.071.992.547.409,91'))?.amountCents,Number.MAX_SAFE_INTEGER);
 assert.equal(declaredGeneralAnnexTotal(maximum('90.071.992.547.409,92')),null);
 assert.equal(declaredEconomicAnnexTotal(economic('90.071.992.547.409,91'),6),Number.MAX_SAFE_INTEGER);
});
test('conflicting or unsafe declared totals do not become a reconciliation target',()=>{
 assert.equal(declaredEconomicAnnexTotal(`${economic('1.000,00')} ${economic('2.000,00')}`,6),null);
 assert.equal(declaredEconomicAnnexTotal(economic('12.34,99'),6),null);
 assert.equal(declaredEconomicAnnexTotal(`${economic('1.000,00')} ${economic('90.071.992.547.409,92')}`,6),null);
 assert.equal(declaredGeneralAnnexTotal(`${maximum('1.000,00')} ${maximum('90.071.992.547.409,92')}`),null);
});
test('annex subtotal never overflows or accepts invalid amounts',()=>{
 assert.equal(safeAnnexSum([100,200,null]),300);
 assert.equal(safeAnnexSum([Number.MAX_SAFE_INTEGER,1]),null);
 assert.equal(safeAnnexSum([-1]),null);
 assert.equal(safeAnnexSum([0.5]),null);
});

test('program totals use exact cents and refuse unsafe aggregate amounts',async()=>{
 const {programDeclaredTotal}=await import('../lib/concerts/program-annex');
 const row={page:1,row:1,nif:'G12345678',resesCode:'S12345',dispositionNumber:'123',position:'1',quote:'literal',observedProviderName:null,observedServiceName:null,municipality:null,quantity:1,amountCents:Number.MAX_SAFE_INTEGER,annualCostCents:null,dispositionCents:null,amountBasis:'direct' as const,modality:null};
 assert.equal(programDeclaredTotal('Total 90.071.992.547.409,91 €',[row]),Number.MAX_SAFE_INTEGER);
 assert.equal(programDeclaredTotal('Total 90.071.992.547.409,92 €',[row]),null);
 assert.equal(programDeclaredTotal('Total 90.071.992.547.409,91 €',[row,{...row,row:2,amountCents:1}]),null);
});

test('stored numeric values are compared as exact cents, not rounded into a match',async()=>{
 const {storedAmountCents}=await import('../lib/concerts/annex-extraction');
 assert.equal(storedAmountCents('1234.56'),123456);
 assert.equal(storedAmountCents(0),0);
 assert.equal(storedAmountCents('90071992547409.91'),Number.MAX_SAFE_INTEGER);
 assert.equal(storedAmountCents('90071992547409.92'),null);
 assert.equal(storedAmountCents(2**45),null);
 assert.equal(storedAmountCents('1.005'),null);
 assert.equal(storedAmountCents(null),null);
 assert.equal(storedAmountCents('-75.39',true),-7539);
 assert.equal(storedAmountCents('-75.39'),null);
});
