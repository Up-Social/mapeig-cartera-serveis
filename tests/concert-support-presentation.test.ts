import assert from 'node:assert/strict';
import {test} from 'node:test';
import {extractColumnAnnexRows} from '../lib/concerts/annex-extraction';
import {recoverPrintedSupportCandidates} from '../lib/concerts/presentation';

const header='Nom entitat'.padEnd(25)+'NIF entitat'.padEnd(16)+'Codi cartera'.padEnd(15)+'Tipologia servei'.padEnd(33)+'Suport'.padEnd(9)+'Codi S'.padEnd(9)+'Nom servei'.padEnd(25)+'Municipi'.padEnd(20)+'assignar';
const row='Entitat prova'.padEnd(25)+'G12345678'.padEnd(16)+'1.2.6.2.4.1'.padEnd(15)+'Servei ocupacional'.padEnd(33)+'STOI'.padEnd(9)+'S10844'.padEnd(9)+'Servei A'.padEnd(25)+'Torà'.padEnd(20)+'2';
const text=['## Pàgina 4',header,row,'Total general 2'].join('\n');
const source=extractColumnAnnexRows(text)[0],sha='a'.repeat(64);
const unit={id:'u',unit_key:`official-annex:${sha}:0:1`,document_id:'doc',storage_sha256:sha,page:4,provider_nif:'G12345678',reses_code:'S10844',observed_service_code:'1.2.6.2.4.1',quantity:2,amount:null,evidence_quote:source.quote};
const document={id:'doc',extracted_text:text,storage_sha256:sha,extraction_method:'pdf-text',extraction_coverage:{complete:true},mime_type:'application/pdf',extraction_partial:false,quality_flags:[]};

test('read-only support candidate is bound to the exact single documentary row',()=>{
 const before=JSON.stringify(unit), result=recoverPrintedSupportCandidates([unit],[document]);
 assert.deepEqual(result[0].printed_support_candidate,{value:'STOI',page:4});
 assert.equal(JSON.stringify(unit),before);assert.equal(result[0].observed_service_code,'1.2.6.2.4.1');
});

test('does not bind across documents, differing facts, unknown amount or duplicate units',()=>{
 for(const changed of [{document_id:'other'},{storage_sha256:'b'.repeat(64)},{page:5},{provider_nif:'G87654321'},{reses_code:'S54321'},{observed_service_code:'1.2.3'},{quantity:1},{amount:0},{amount:'bad'},{evidence_quote:'Una altra fila'},{unit_key:`official-annex:${sha}:0:2`}]){
  assert.equal(recoverPrintedSupportCandidates([{...unit,...changed}],[document])[0].printed_support_candidate,undefined);
 }
 assert.ok(recoverPrintedSupportCandidates([unit,{...unit,id:'other'}],[document]).every(item=>item.printed_support_candidate===undefined));
 assert.equal(recoverPrintedSupportCandidates([unit],[document,document])[0].printed_support_candidate,undefined);
});

test('does not bind incomplete, non-PDF, corrupt or ambiguous documentary extractions',()=>{
 for(const changed of [{extraction_partial:true},{extraction_coverage:null},{extraction_coverage:{}},{extraction_coverage:{complete:false}},{quality_flags:['corrupt_text']},{quality_flags:['incomplete_extraction']},{quality_flags:null},{mime_type:'text/html'},{storage_sha256:null},{extraction_method:null}]){
  assert.equal(recoverPrintedSupportCandidates([unit],[{...document,...changed}])[0].printed_support_candidate,undefined);
 }
 const duplicate=text+'\n'+text;
 assert.equal(recoverPrintedSupportCandidates([unit],[{...document,extracted_text:duplicate}])[0].printed_support_candidate,undefined);
});
