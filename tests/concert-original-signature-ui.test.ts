import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {ConcertOriginalSignature} from '../components/concert-original-signature';
import type {SourceDocument} from '../lib/workbench-types';

const document:SourceDocument={id:'doc-1',revision:`${'a'.repeat(64)}:extraction`,url:'https://example.org',documentType:'resolution',sourceFields:[],status:'fetched',archived:true,currentTextConsistent:true,mimeType:'application/pdf',extractedText:'## Pàgina 3\n    Doc.original signat per: Persona\n    29/04/2025\n    Data creació còpia: 30/04/2025',textPreview:null,textLength:0,extractionMethod:'pdf-text-markdown-v2',extractionPartial:false,extractionCoverage:{complete:true},qualityScore:null,qualityFlags:[],chunkCount:1};
test('shows original and copy dates and warns of a differing extracted date',()=>{
 const html=renderToStaticMarkup(createElement(ConcertOriginalSignature,{documents:[document],awardDate:'2025-04-30'}));
 assert.match(html,/29\/04\/2025/);assert.match(html,/30\/04\/2025/);assert.match(html,/no coincideix/);assert.match(html,/sha=a{64}#page=3/);
});
test('does not display evidence for an incomplete or changed document',()=>{
 assert.equal(renderToStaticMarkup(createElement(ConcertOriginalSignature,{documents:[{...document,currentTextConsistent:false}],awardDate:null})), '');
 assert.equal(renderToStaticMarkup(createElement(ConcertOriginalSignature,{documents:[{...document,extractionCoverage:{complete:false}}],awardDate:null})), '');
});
