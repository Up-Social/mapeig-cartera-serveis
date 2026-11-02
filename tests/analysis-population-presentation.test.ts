import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AnalysisResult} from '../components/analysis-result';
import {MatchingCandidateAnalysis} from '../components/matching-candidate-analysis';
import type {StoredAnalysis} from '../lib/analysis-contract';
import type {MatchingCandidate} from '../lib/workbench-types';

const base:StoredAnalysis={id:'synthetic',classification:'in_portfolio',reasons:[],explanation:'Proposta sintètica de correspondència.',service_description:'Servei sintètic',target_population:'Joves vinculats a programes d’inserció laboral.',catalog_version_id:'synthetic-catalog',rules_version:'evidence-roles-v2',reviewed_classification:null,review_notes:null,evidence:[{content:'Fragment documental sintètic conservat.'}]};
const label='Destinataris proposats per l’anàlisi · pendent de contrastar:';
const warning='Aquesta descripció no acredita per si sola';
const render=(analysis:StoredAnalysis|null=base)=>renderToStaticMarkup(createElement(AnalysisResult,{analysis,candidates:[]}));

test('short population is a proposal next to its caveat, without modifying stored data',()=>{
 const snapshot=JSON.stringify(base),html=render();
 assert.ok(html.includes(label));assert.ok(html.includes(base.target_population));assert.ok(html.includes(warning));
 assert.ok(html.indexOf(label)<html.indexOf('<details'));
 assert.equal(html.split(label).length-1,1);assert.equal(JSON.stringify(base),snapshot);
 assert.doesNotMatch(html,/procedeix del catàleg|prové del catàleg|Destinataris:/);
 assert.ok(html.includes(base.explanation));assert.ok(html.includes(base.evidence[0].content));
});

test('long and multi-line analysis populations retain the disclosure and caveat together',()=>{
 const long={...base,target_population:'Població descrita a la proposta. '.repeat(15)};
 const html=render(long),details=html.slice(html.indexOf('<details'));
 assert.match(html.slice(0,html.indexOf('<details')),/destinataris proposats, pendents de contrastar/);
 assert.ok(details.includes(label));assert.ok(details.includes(warning));assert.ok(details.includes(long.target_population));
 for(const rules_version of ['concert-reconciled-annex-v1','concert-program-lines-v2']){
  const multi=render({...base,rules_version}),expanded=multi.slice(multi.indexOf('<details'));
  assert.match(multi.slice(0,multi.indexOf('<details')),/pot derivar del catàleg/);
  assert.match(expanded,/Text de població de l’anàlisi/);assert.match(expanded,/No acredita la població de cada línia/);
  assert.ok(expanded.includes(base.target_population));assert.ok(!expanded.includes(label));
 }
});

test('absent, null and empty population are explicitly pending without fabricating a proposal',()=>{
 for(const target_population of [undefined,null,'','  \n ']){
  const html=render({...base,target_population} as StoredAnalysis);
  assert.ok(!html.includes(label));assert.ok(!html.includes(warning));assert.ok(html.includes(base.explanation));
  assert.match(html,/Població destinatària: no identificada a l’anàlisi · pendent de contrast/);
 }
 assert.ok(!render(null).includes(label));
});

test('special branches remain unchanged and a saved human decision is still visible',()=>{
 const invalid=render({...base,reliability_status:'invalidated'});
 assert.match(invalid,/Resultat no fiable pendent de reanàlisi/);assert.ok(!invalid.includes(label));
 const container=render({...base,rule_audit:{rule:'review_by_recipient'}});
 assert.match(container,/Resultats per unitat del conveni/);assert.ok(!container.includes(label));
 const reviewed=render({...base,reviewed_classification:'in_portfolio',review_notes:'Decisió humana conservada.'});
 assert.ok(reviewed.includes(label));assert.match(reviewed,/Decisió humana conservada/);
});

test('program evidence warns about line population without changing the historical quote or explanation',()=>{
 const candidate:MatchingCandidate={id:'candidate',pipelineJobId:'job',rank:1,targetCode:'1.2',targetName:'Servei de prova',score:0.9,rationale:'Encaix: servei',model:'synthetic',serviceDetail:{sectorScope:'Persones grans',portfolioStatus:'Dentro'},evidence:[{ordinal:1,content:'RESES S12345 · Tipologia del servei.',explanation:'Tipologia del servei i destinataris impresos a les línies de l’annex.'}]};
 const html=renderToStaticMarkup(createElement(AnalysisResult,{analysis:{...base,rules_version:'concert-program-lines-v2'},candidates:[candidate]}));
 assert.ok(html.includes(candidate.evidence[0].explanation!));assert.ok(html.includes(candidate.evidence[0].content));
 assert.match(html,/la població de cada línia requereix contrast específic/);
 assert.match(html,/Població segons el catàleg de referència incorporat/);assert.match(html,/no acredita la població de l’expedient/);
 const general=renderToStaticMarkup(createElement(AnalysisResult,{analysis:base,candidates:[candidate]}));
 assert.doesNotMatch(general,/la població de cada línia requereix contrast específic/);
 assert.match(general,/Població segons el catàleg de referència incorporat/);
 const byModel=renderToStaticMarkup(createElement(MatchingCandidateAnalysis,{candidate:{...candidate,model:'program-columns-v2'}}));
 assert.match(byModel,/la població de cada línia requereix contrast específic/);
});

test('catalog population caveat also applies in the shared candidate card without inventing an absent value',()=>{
 const candidate:MatchingCandidate={id:'candidate',pipelineJobId:'job',rank:1,targetCode:'1.2',targetName:'Servei',score:0.7,rationale:'',model:'synthetic',serviceDetail:{sectorScope:null,portfolioStatus:null},evidence:[]};
 const html=renderToStaticMarkup(createElement(MatchingCandidateAnalysis,{candidate}));
 assert.match(html,/Població segons el catàleg de referència incorporat/);assert.doesNotMatch(html,/Aquesta referència no acredita/);
 assert.match(html,/versió del catàleg d’aquesta proposta no està registrada/);assert.doesNotMatch(html,/Veure fitxa completa del servei/);
 const staleLink=renderToStaticMarkup(createElement(MatchingCandidateAnalysis,{candidate:{...candidate,legalReference:'https://example.invalid/old'}}));
 assert.doesNotMatch(staleLink,/Definició normativa/);
 const versioned=renderToStaticMarkup(createElement(MatchingCandidateAnalysis,{candidate:{...candidate,catalogVersionId:'versio-anterior'}}));
 assert.match(versioned,/Veure fitxa completa del servei/);assert.match(versioned,/version=versio-anterior/);
});
