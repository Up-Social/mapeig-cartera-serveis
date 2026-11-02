import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {concertDiscardProposal,concertVacantAmendmentProposal} from '../lib/concerts/discard-proposal';
import {assessConcertAct} from '../lib/concerts/act-assessment';
import {concertCaseKeys} from '../lib/concerts/case-labels';
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

test('a documented call or spending authorization is only a reasoned proposal for human review',()=>{
 const doc=record.sourceDocuments[0];
 const callTitle='Resolució DSI/123/2025, de 15 de setembre, de convocatòria per a la provisió de places';
 const call='## Pàgina 1\nResolc:\n—1 Obrir una convocatòria per a la provisió de serveis.\n—2 El termini per presentar les sol·licituds és de 15 dies.\nAnnex 1\nPlaces convocades';
 const spendingTitle='Resolució d’autorització de la despesa fins a octubre dels serveis en funcionament';
 const spending='## Pàgina 7\nRESOLC\nPrimer.- Autoritzar la despesa de places assignades.\nSegon.- Autoritzar la despesa de serveis assignats.\n## Pàgina 8\nAnnex 1: Serveis i places\nDades';
 for(const [title,source,word] of [[callTitle,call,'convocatòria'],[spendingTitle,spending,'despesa']]){
  const proposal=concertDiscardProposal({...record,title,sourceDocuments:[{...doc,extractedText:source}]});
  assert.ok(proposal);assert.match(proposal.reason,new RegExp(word));assert.equal(record.reviewDecision,null);
  assert.equal(concertDiscardProposal({...record,title,sourceDocuments:[{...doc,extractedText:source.replace('Annex 1','—3 Adjudicar places a una entitat.\nAnnex 1')}]}),null);
  assert.equal(concertDiscardProposal({...record,title,sourceDocuments:[{...doc,extractedText:source.replace('Annex 1','—3 S’assignen places a una entitat.\nAnnex 1')}]}),null);
  assert.equal(concertDiscardProposal({...record,title,sourceDocuments:[{...doc,extractedText:source,extractionPartial:true}]}),null);
  assert.equal(concertDiscardProposal({...record,title,sourceDocuments:[{...doc,extractedText:source.replace('Annex 1','Continuació')}]}),null);
 }
 assert.equal(concertDiscardProposal({...record,title:'Resolució de la convocatòria per adjudicar places',sourceDocuments:[{...doc,extractedText:call}]}),null);
 assert.equal(assessConcertAct(spendingTitle,'Antecedents: una convocatòria anterior.\nRESOLC\nPrimer.- Autoritzar la despesa de places assignades.').primaryCase,15);
 assert.equal(concertCaseKeys(spendingTitle,[],spending)[0],'spending');
});
