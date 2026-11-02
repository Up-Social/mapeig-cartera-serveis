import test from 'node:test';
import assert from 'node:assert/strict';
import {extractDiagnosticAnnex} from '../lib/concerts/diagnostic-annex';

const text=`## Pàgina 1
RESOLC: 1. Assignar els serveis. 2. Assenyalar el període comprès entre l’1 de juliol de 2025 i el 31 de desembre de 2025.
## Pàgina 7
ANNEX 1 Serveis assignats
Entitat NIF RESES cartera sense IVA amb IVA
G12345678 S12345 D/251000200/318B/0000 1.2.1.15 1,10€ 100,00 euros 110,00 euros
Import total 100,00 euros 110,00 euros
## Pàgina 8
Entitat NIF RESES cartera sense IVA amb IVA
Equip Tècnic de Centre
G12345678 S54321 D/227000700/318B/0000 1.2.1.3 1,10€ 80,00 euros 88,00 euros
15h/setmanals Llicenciat Grup
G12345678 II titulat en Medicina S54321 D/227000700/318B/0000 1.2.1.3 1,10€ 20,00 euros 22,00 euros
especialitat en Pediatria
Import total 100,00 euros 110,00 euros
## Pàgina 9
ANNEX 2. ALTRES DADES`;
test('reconciles independent tables and groups only documented paediatric component',()=>{
 const rows=extractDiagnosticAnnex(text);assert.equal(rows.length,2);
 assert.deepEqual(rows.map(({resesCode,amountCents,quantity,effectiveStart,effectiveEnd})=>({resesCode,amountCents,quantity,effectiveStart,effectiveEnd})),[
  {resesCode:'S12345',amountCents:11000,quantity:null,effectiveStart:'2025-07-01',effectiveEnd:'2025-12-31'},
  {resesCode:'S54321',amountCents:11000,quantity:null,effectiveStart:'2025-07-01',effectiveEnd:'2025-12-31'},
 ]);
 for(const row of rows)assert.ok(text.replace(/\s+/g,' ').includes(row.quote));
});
test('incomplete, ambiguous or unreconciled tables yield no drafts',()=>{
 for(const change of [
  text.replace('22,00 euros','22,01 euros'),text.replace('Import total 100,00 euros 110,00 euros','Import total 100,00 euros 111,00 euros'),
  text.replace('especialitat en Pediatria','especialitat en Medicina'),text.replace('S54321 D/227000700','S99999 D/227000700'),
  text.replace('G12345678 II titulat','NOIDENTIFICAT II titulat'),text.replace('S54321 D/227000700','NOIDENTIFICAT D/227000700'),
  text.replace('ANNEX 2. ALTRES DADES','SENSE FINAL'),text+'\nANNEX 1 Serveis assignats\n',
 ])assert.deepEqual(extractDiagnosticAnnex(change),[]);
});

test('documentary totals require one complete current archived award document',async()=>{
 const {diagnosticAwardReport}=await import('../lib/concerts/diagnostic-report');
 const doc={id:'doc',status:'fetched',mimeType:'application/pdf',archived:true,currentTextConsistent:true,extractedText:text,extractionPartial:false,extractionMethod:'pdf-text-markdown-v2',extractionCoverage:{complete:true},qualityFlags:[]};
 const record={financingType:'concert',isHistorical:false,title:'Resolució de provisió de serveis',sourceDocuments:[doc]} as unknown as Parameters<typeof diagnosticAwardReport>[0];
 assert.equal(diagnosticAwardReport(record)?.totalCents,22000);
 assert.equal(diagnosticAwardReport({...record,sourceDocuments:[{...record.sourceDocuments[0],currentTextConsistent:false}]}),null);
 assert.equal(diagnosticAwardReport({...record,sourceDocuments:[...record.sourceDocuments,...record.sourceDocuments]}),null);
 assert.equal(diagnosticAwardReport({...record,title:'Acord proposta de provisió'}),null);
});
