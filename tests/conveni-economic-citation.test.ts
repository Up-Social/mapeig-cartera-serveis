import assert from 'node:assert/strict';
import test from 'node:test';
import {checkEconomicCitation,quoteHasAmountLiteral} from '../lib/convenis/economic-citation';

// Synthetic excerpts: literal matching is a mechanical check only and cannot
// establish payment or attribution of a shared ceiling to a specific service.
const planned="Es preveuen 14.000,00 euros / catorze mil euros per al programa de prova.";
const ceiling="La gestió es limita al 20 % i fins a un màxim de 4.000,00 euros / quatre mil euros.";
const document={id:'doc',storage_sha256:'a'.repeat(64),active_extraction_id:'extract',extracted_text:`## Pàgina 7\n${planned}\n${ceiling}`};
const base={citation:{document_id:'doc',page:7,quote:planned},literal:'14.000,00',amountCents:1400000,documents:[document],documentRevisions:{doc:`${document.storage_sha256}:extract`}};

test('a synthetic amount is literal-verified only, never economic approval',()=>{
 assert.deepEqual(checkEconomicCitation(base),{status:'literal_verified_only',amountCents:1400000});
 assert.deepEqual(checkEconomicCitation({...base,citation:{...base.citation,quote:ceiling},literal:'4.000,00',amountCents:400000}),{status:'literal_verified_only',amountCents:400000});
});

test('amount, page, document identity and extraction revision must agree',()=>{
 assert.equal(checkEconomicCitation({...base,amountCents:1400001}).status,'rejected');
 assert.equal(checkEconomicCitation({...base,literal:'1.234',amountCents:123400}).status,'rejected');
 assert.equal(checkEconomicCitation({...base,amountCents:-1}).status,'rejected');
 assert.equal(checkEconomicCitation({...base,citation:{...base.citation,page:6}}).status,'rejected');
 assert.equal(checkEconomicCitation({...base,citation:{...base.citation,document_id:'other'}}).status,'rejected');
 assert.equal(checkEconomicCitation({...base,documents:[document,document]}).status,'rejected');
 assert.equal(checkEconomicCitation({...base,documentRevisions:{doc:`${document.storage_sha256}:other`}}).status,'rejected');
 assert.equal(checkEconomicCitation({...base,documents:[{...document,storage_sha256:'invalid'}]}).status,'rejected');
});

test('a token within a larger number, percentage, identifier or expression is rejected',()=>{
 const invalid=['X14000 euros','114000 euros','14000,50 euros','14000%','−14000 euros','+ 14000 euros','14 000 euros','(14000)','1 × 14000 euros','14000 / 2 euros'];
 for(const quote of invalid)assert.equal(quoteHasAmountLiteral(quote,'14000'),false,quote);
 assert.equal(quoteHasAmountLiteral('Aportació de 14000 euros','14000'),true);
 assert.equal(quoteHasAmountLiteral('1.234 euros','1.234'),false,'ambiguous thousands without decimal');
 assert.equal(quoteHasAmountLiteral('Aportació de 0 euros','0'),true);
});
