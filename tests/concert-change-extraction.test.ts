import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractConcertChangeRows,operativeConcertChange} from '../lib/concerts/change-extraction';
test('official Girona minoration retains two negative amounts, not the monthly tariff',()=>{
 const rows=extractConcertChangeRows(readFileSync('tests/fixtures/official/girona-minoration-2026.txt','utf8'));
 assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.amountCents),[-531167,-531167]);assert.deepEqual(rows.map(r=>r.quantityDelta),[-1,-1]);
 assert.deepEqual(rows.map(r=>r.resesCode),['S08875','S00888']);assert.ok(rows.every(r=>r.observedServiceCode==='1.2.6.2.4.1.1'&&r.page===4));
});
test('official Mercè Pla transfer retains both establishments and nets zero',()=>{
 const rows=extractConcertChangeRows(readFileSync('tests/fixtures/official/merce-pla-transfer-2024.txt','utf8'));
 assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.amountCents),[-8166528,8166528]);assert.deepEqual(rows.map(r=>r.resesCode),['S02092','S11212']);assert.equal(rows.reduce((s,r)=>s+r.amountCents,0),0);
});
test('incomplete identities and tariff-only rows are not invented as changes',()=>{
 assert.deepEqual(extractConcertChangeRows('Annex cost places\nS01150 758,81 €'),[]);
});

test('generic titles use the operative reduction, not background awards',()=>{
 assert.equal(operativeConcertChange('Antecedents: assignar places.\nRESOLC:\n1. Reduir les places del servei.\n2. Notificar.'),'modification');
 assert.equal(operativeConcertChange('Antecedents: reduir places.\nRESOLC:\n1. Assignar el servei.'),null);
});
