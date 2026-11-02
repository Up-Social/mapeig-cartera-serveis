import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {provisionalServiceHeadings,provisionalServiceAmounts} from '../lib/concerts/provisional-headings';
import {currentDocumentTextConsistent} from '../lib/concerts/document-text-integrity';
import {provisionalDocumentReport} from '../lib/concerts/provisional-report';
import type {SourceRecord} from '../lib/workbench-types';

const title='Acord proposta per a la provisió de serveis socials de prova en una ciutat fictícia';
const source=`## Pàgina 1
${title}
PROPOSA
Assignar els serveis de prova.
## Pàgina 2
ANNEX 1. SERVEIS ASSIGNATS
1.- Servei fictici Alfa en règim de concert social
2.- Servei fictici Beta en règim de gestió delegada
## Pàgina 3
ANNEX 2. ALTRES DADES`;

test('reads only literal headings in a bounded, ordered provisional annex',()=>{
 const rows=provisionalServiceHeadings(title,source);
 assert.deepEqual(rows,[
  {heading:'Servei fictici Alfa en règim de concert social',page:2},
  {heading:'Servei fictici Beta en règim de gestió delegada',page:2},
 ]);
 assert.deepEqual(provisionalServiceHeadings(title,source.replace('PROPOSA','ANTECEDENTS')+'\nPROPOSA\n'),[]);
 assert.deepEqual(provisionalServiceHeadings(title,source.replace('ANNEX 2. ALTRES DADES','SENSE LÍMIT')),[]);
 assert.deepEqual(provisionalServiceHeadings(title,source+'\nANNEX 1. SERVEIS ASSIGNATS\n'),[]);
 assert.deepEqual(provisionalServiceHeadings(title,'PROPOSA\n'+source),[]);
 assert.deepEqual(provisionalServiceHeadings('Resolució definitiva de serveis ficticis',source),[]);
 assert.deepEqual(provisionalServiceHeadings(title,source.replace('## Pàgina 3','3.- Servei amb format no reconegut\n## Pàgina 3')),[]);
 assert.deepEqual(provisionalServiceHeadings(title,source.replace('## Pàgina 3','3) Servei amb format no reconegut\n## Pàgina 3')),[]);
 assert.deepEqual(provisionalServiceHeadings(title,source.replace('## Pàgina 3','100.- Servei amb format no reconegut\n## Pàgina 3')),[]);
});

test('source text hash must match current extraction metadata',()=>{
 const metadata={status:'fetched',storage_path:'synthetic/doc.pdf',storage_sha256:'a'.repeat(64),active_extraction_id:'00000000-0000-4000-8000-000000000001',extracted_text:source,extracted_text_hash:createHash('sha256').update(source).digest('hex')};
 assert.equal(currentDocumentTextConsistent(metadata),true);
 assert.equal(currentDocumentTextConsistent({...metadata,extracted_text:source+' alterat'}),false);
 assert.equal(currentDocumentTextConsistent({...metadata,extracted_text_hash:'b'.repeat(64)}),false);
 assert.equal(currentDocumentTextConsistent({...metadata,active_extraction_id:null}),false);
 assert.equal(currentDocumentTextConsistent({...metadata,storage_sha256:null}),false);
});

test('proposal amounts come from each labelled total with VAT, never from a component or general model total',()=>{
 const document=source.replace('2.- Servei fictici Beta',`Import calculat sense IVA    Import calculat amb IVA (10%)\nImport total   179.869,02 euros    197.855,92 euros\n2.- Servei fictici Beta`).replace('## Pàgina 3',`Import calculat sense IVA    Import calculat amb IVA (10%)\nImport total   107.392,11 euros    118.131,32 euros\n## Pàgina 3`);
 const amounts=provisionalServiceAmounts(title,document);
 assert.deepEqual(amounts?.map(row=>row.grossCents),[19785592,11813132]);
 assert.equal(amounts!.reduce((sum,row)=>sum+row.grossCents,0),31598724);
 for(const changed of [document.replace('amb IVA (10%)','amb IVA'),document.replace('197.855,92 euros','197.855,93 euros'),document.replace('179.869,02 euros','1798.69,02 euros'),document.replace('Import total   107.392,11','Import parcial   107.392,11'),document.replace('## Pàgina 3','3.- Servei no reconegut\n## Pàgina 3')])
  assert.equal(provisionalServiceAmounts(title,changed),null);
});

test('a proposal subtotal is visible only for one current, complete official document',()=>{
 const text=source.replace('2.- Servei fictici Beta',`Import calculat sense IVA    Import calculat amb IVA (10%)\nImport total   179.869,02 euros    197.855,92 euros\n2.- Servei fictici Beta`).replace('## Pàgina 3',`Import calculat sense IVA    Import calculat amb IVA (10%)\nImport total   107.392,11 euros    118.131,32 euros\n## Pàgina 3`);
 const doc={id:'doc',status:'fetched',mimeType:'application/pdf',archived:true,currentTextConsistent:true,extractedText:text,extractionPartial:false,extractionMethod:'pdf-text-markdown-v2',extractionCoverage:{complete:true},qualityFlags:[]};
 const record={title,financingType:'concert',isHistorical:false,sourceDocuments:[doc]} as unknown as SourceRecord;
 assert.equal(provisionalDocumentReport(record)?.totalCents,31598724);
 assert.equal(provisionalDocumentReport({...record,isHistorical:true}),null);
 assert.equal(provisionalDocumentReport({...record,sourceDocuments:[{...record.sourceDocuments[0],currentTextConsistent:false}]}),null);
 assert.equal(provisionalDocumentReport({...record,sourceDocuments:[...record.sourceDocuments,...record.sourceDocuments]}),null);
});
