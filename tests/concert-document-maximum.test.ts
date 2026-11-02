import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentaryMaximumNotices} from '../lib/concerts/document-maximum';
import type {SourceDocument} from '../lib/workbench-types';

const sha='a'.repeat(64);
const quote='S12345 Entitat de prova 5 places 6.645,50 €';
const condition='En cas que l’assignació es resolgui després de l’1 d’agost de 2025, aquest import es reduirà proporcionalment i s’adaptarà al nou termini de prestació del servei.';
const text=`## Pàgina 1\nRESOLC: 2. Indicar un import total màxim de 19.936,50 euros exempt d’IVA, tal com s’indica a l’Annex d’aquesta resolució. ${condition}\n## Pàgina 2\n${quote}`;
const document:SourceDocument={id:'doc',url:'https://example.invalid',documentType:'publication',sourceFields:[],status:'fetched',mimeType:'application/pdf',textPreview:null,textLength:text.length,
 extractionMethod:'pdf-text-markdown-v2',extractionPartial:false,extractionCoverage:null,qualityScore:1,qualityFlags:[],chunkCount:1,revision:`${sha}:extract`,archived:true,extractedText:text};
const line={document_id:'doc',storage_sha256:sha,evidence_quote:quote};

test('a documented maximum and explicit condition are shown for the document, not allocated to its lines',()=>{
 const result=documentaryMaximumNotices([document],[line,{...line}]);
 assert.equal(result.length,1);assert.equal(result[0].amountCents,1993650);
 assert.match(result[0].quote,/màxim de 19\.936,50/);assert.equal(result[0].condition,condition);
});

test('a stale, partial, unsupported or contradictory source does not display the maximum',()=>{
 for(const bad of [
  {...document,status:'error' as const},{...document,archived:false},{...document,extractionPartial:true},
  {...document,extractionPartial:null},{...document,extractionMethod:null},{...document,extractionCoverage:{complete:false}},
  {...document,qualityFlags:['incomplete_extraction']},{...document,revision:`${'b'.repeat(64)}:extract`},
  {...document,revision:`${sha}:`},
  {...document,extractedText:text.replace(quote,'una altra línia')},
  {...document,extractedText:text+' RESOLC: import total màxim de 20.000,00 euros, tal com s’indica a l’Annex'},
 ])assert.deepEqual(documentaryMaximumNotices([bad],[line]),[]);
 assert.deepEqual(documentaryMaximumNotices([document],[{...line,observation:{pendingRevision:true}}]),[]);
 assert.deepEqual(documentaryMaximumNotices([document],[{...line,document_id:'other'}]),[]);
 assert.deepEqual(documentaryMaximumNotices([document],[line,{...line,storage_sha256:'b'.repeat(64)}]),[]);
 assert.deepEqual(documentaryMaximumNotices([document],[line,{...line,evidence_quote:'Cita d’una altra revisió'}]),[]);
});

test('a stated maximum without a reduction condition does not invent one',()=>{
 const source={...document,extractedText:text.replace(condition,'')};
 assert.equal(documentaryMaximumNotices([source],[line])[0].condition,null);
});

test('repeated maximum declarations do not attach an ambiguous condition',()=>{
 const source={...document,extractedText:text+' import total màxim de 19.936,50 euros, tal com s’indica a l’Annex.'};
 assert.equal(documentaryMaximumNotices([source],[line])[0].condition,null);
});
