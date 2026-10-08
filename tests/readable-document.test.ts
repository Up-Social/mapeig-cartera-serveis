import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverPdfText,textDefects,EXTRACTION_VERSION} from '../lib/pipeline/readable-document';
import {documentQuality,isEligibleEvidence} from '../lib/evidence-eligibility';
import {selectEvidenceWindow} from '../lib/cloud/evidence-window';
const good='La resolució acredita el servei d’ajuda a domicili i les persones destinatàries, entitats prestadores i finançament. '.repeat(15);
const corrupt='KEs E/ D Z /Ed Z D/E/^dZ d/h K><> KZ /M EdZ > KE^ >> KD Z > Z’h / >^ :hEd D Ed^ > KD Z W Z\u0001 '.repeat(80);
test('long corrupt PDF cannot score 100 percent or reach matching',()=>{
 assert.ok(corrupt.length>3000);assert.deepEqual(textDefects(corrupt),['corrupt_text']);
 assert.equal(documentQuality(corrupt,'pdftotext').qualityScore,0);
 assert.equal(isEligibleEvidence({content:corrupt,textLength:corrupt.length}),false);
});
test('OCR only the corrupt page of a mixed PDF, preserving page provenance',async()=>{
 const calls:number[]=[];const result=await recoverPdfText(good+'\f'+corrupt+'\f',true,async page=>{calls.push(page);return good;},2);
 assert.deepEqual(calls,[2]);assert.equal(result.partial,false);assert.equal(result.extraction_version,EXTRACTION_VERSION);
 assert.ok(result.text.includes('## Pàgina 2'));assert.equal(result.coverage.pages[0].method,'text');assert.equal(result.coverage.pages[1].method,'ocr');
});
test('disabled or unsuccessful OCR produces incomplete extraction',async()=>{
 for(const enabled of [false,true]) assert.equal((await recoverPdfText(corrupt,enabled,async()=>corrupt)).partial,true);
});
test('OCR cap cannot silently certify a partially recovered document',async()=>{
 let calls=0;const result=await recoverPdfText(Array(26).fill(corrupt).join('\f'),true,async()=>{calls++;return good;});
 assert.equal(calls,25);assert.equal(result.partial,true);
});
test('normal Catalan, Spanish, legal tables and non-Latin names are preserved',()=>{
 for(const text of [good,'NIF | Import | Codi\n B12345678 | 10.500,50 € | 1.2.3','Марія Коваль, servei social i atenció comunitària.'])assert.deepEqual(textDefects(text),[]);
});
test('wide PDF annex columns do not turn readable entities and amounts into corrupt text',async()=>{
 const annex=[
  'Nom entitat'.padEnd(145)+'NIF entitat'.padEnd(145)+'Nombre de places'.padEnd(145)+'Import',
  ...Array.from({length:4},(_,i)=>`Residència Social ${i+1}, SL`.padEnd(145)+`B6279257${i}`.padEnd(145)+'1'.padEnd(145)+'1.361,36 €'),
 ].join('\n');
 assert.deepEqual(textDefects(annex),[]);
 const result=await recoverPdfText(annex,false,async()=>{throw Error('OCR must not run for a readable annex');},1);
 assert.equal(result.partial,false);
 assert.equal(result.coverage.pages[0].method,'text');
 assert.match(result.text,/Residència Social 1, SL/);
 assert.match(result.text,/1\.361,36 €/);
});
test('select a relevant annex beyond the former 96-fragment cutoff',()=>{
 const chunks=Array.from({length:150},(_,ordinal)=>({source_document_id:'doc',ordinal,content:ordinal===123?'Annex adjudicataris, servei 1.2.6.2.6, places concertades':good}));
 assert.ok(selectEvidenceWindow(chunks).some(c=>c.ordinal===123));
 assert.equal(selectEvidenceWindow(chunks).length,12);
});
