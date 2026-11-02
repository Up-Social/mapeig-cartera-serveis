import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {provisionalServiceHeadings} from '../lib/concerts/provisional-headings';
import {currentDocumentTextConsistent} from '../lib/concerts/document-text-integrity';

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
