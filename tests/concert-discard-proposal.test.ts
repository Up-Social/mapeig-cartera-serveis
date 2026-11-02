import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {concertVacantAmendmentProposal} from '../lib/concerts/discard-proposal';
import {HumanDecisionReason} from '../components/human-decision-reason';
import type {SourceRecord} from '../lib/workbench-types';

const text=readFileSync('tests/fixtures/official/concert-s1-3-amendment.txt','utf8');
const record={title:'ESMENA DE LA RESOLUCIÓ DE PLACES DESERTES DE SERVEIS SOCIALS',financingType:'concert',isHistorical:false,reviewDecision:null,analysis:{classification:'insufficient_evidence'},sourceDocuments:[{id:'doc',status:'fetched',mimeType:'application/pdf',archived:true,currentTextConsistent:true,revision:'hash:revision',extractedText:text,extractionPartial:false,extractionMethod:'pdf-text-markdown-v2',extractionCoverage:{complete:true},qualityFlags:[]}]} as unknown as SourceRecord;
test('S1-3 presents a proposal grounded in the operative denial, not a human decision',()=>{
 assert.deepEqual(concertVacantAmendmentProposal(record),{documentId:'doc',page:2,places:20});
 assert.equal(record.reviewDecision,null);assert.equal(record.analysis?.classification,'insufficient_evidence');
});
test('stale, ambiguous, partially read or mixed-award documents do not produce a discard proposal',()=>{
 const doc=record.sourceDocuments[0];
 for(const changed of [{...doc,currentTextConsistent:false},{...doc,extractionPartial:true},{...doc,qualityFlags:['corrupt_text']},{...doc,extractedText:text.replace(/es declaren desertes 20 places/gi,'es declaren desertes 30 places')},{...doc,extractedText:text.replace('La Consellera','3. S’assignen places a una entitat.\nLa Consellera')}])
  assert.equal(concertVacantAmendmentProposal({...record,sourceDocuments:[changed]}),null);
 assert.equal(concertVacantAmendmentProposal({...record,sourceDocuments:[doc,doc]}),null);
 assert.equal(concertVacantAmendmentProposal({...record,reviewDecision:'approved'}),null);
 assert.equal(concertVacantAmendmentProposal({...record,isHistorical:true}),null);
 assert.equal(concertVacantAmendmentProposal({...record,financingType:'conveni'}),null);
});
test('the current human decision shows its own reason and clearly identifies a missing reason',()=>{
 const base={reviewDecision:'rejected' as const,reviewReason:'La resolució declara desertes les places.',reviewHistory:[{id:'review',jobId:'job',classification:'discarded',decision:'rejected',reason:'La resolució declara desertes les places.',reasons:['no_concert_award'],createdAt:'2026-11-02'}]};
 const html=renderToStaticMarkup(React.createElement(HumanDecisionReason,{record:base}));
 assert.match(html,/Motiu de la decisió humana/);assert.match(html,/La resolució declara desertes/);assert.match(html,/L’acte no adjudica cap concert/);
 assert.match(renderToStaticMarkup(React.createElement(HumanDecisionReason,{record:{...base,reviewReason:null}})),/No consta una justificació escrita/);
 assert.equal(renderToStaticMarkup(React.createElement(HumanDecisionReason,{record:{...base,reviewDecision:null}})),'');
});
