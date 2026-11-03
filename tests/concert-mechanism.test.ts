import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {concertMechanismParts} from '../lib/concerts/mechanism';
import {AnalysisResult} from '../components/analysis-result';
import type {StoredAnalysis} from '../lib/analysis-contract';
import type {MatchingCandidate} from '../lib/workbench-types';

test('the Concert mechanism is shown alone and the procedure separately',()=>{
 assert.deepEqual(concertMechanismParts('Concert social mitjançant procediment de provisió directa de 9 places'),{mechanism:'Concert social',procedure:'provisió directa'});
 assert.deepEqual(concertMechanismParts('Autorització de despesa en règim de concert social i gestió delegada'),{mechanism:'Concert social / gestió delegada',procedure:'autorització de despesa'});
 assert.deepEqual(concertMechanismParts('Concert social: resolució de provisió i assignació de 5 places'),{mechanism:'Concert social',procedure:'provisió'});
 assert.deepEqual(concertMechanismParts('Concert social; assignació de places per provisió directa i modificació de places'),{mechanism:'Concert social',procedure:'provisió directa · modificació'});
 assert.deepEqual(concertMechanismParts('concert'),{mechanism:'Concert social',procedure:null});
 assert.deepEqual(concertMechanismParts('Subvenció directa'),{mechanism:'Subvenció directa',procedure:null});
 assert.equal(concertMechanismParts('  '),null);assert.equal(concertMechanismParts(null),null);
});
test('a reconciled annex lists every line service without a principal one (S1-2, S1-12)',()=>{
 const analysis={id:'a',classification:'in_portfolio',reasons:[],explanation:'Annex conciliat.',service_description:'Serveis',target_population:'Persones',catalog_version_id:'c',rules_version:'concert-reconciled-annex-v1',reviewed_classification:null,review_notes:null,evidence:[]} as StoredAnalysis;
 const candidate=(rank:number,code:string):MatchingCandidate=>({id:code,pipelineJobId:'job',rank,targetCode:code,targetName:`Servei ${code}`,score:1,rationale:'',model:'synthetic',serviceDetail:{sectorScope:null,portfolioStatus:null},evidence:[]});
 const html=renderToStaticMarkup(createElement(AnalysisResult,{analysis,candidates:[candidate(1,'1.2.3.6'),candidate(2,'1.2.7.6')]}));
 assert.match(html,/Serveis acreditats a les línies de l’annex \(2\)/);
 assert.doesNotMatch(html,/Servei principal|Altres serveis de la resolució|border-neutral-900/);
 assert.match(html,/1\.2\.3\.6/);assert.match(html,/1\.2\.7\.6/);
 const single=renderToStaticMarkup(createElement(AnalysisResult,{analysis:{...analysis,rules_version:'evidence-roles-v4'},candidates:[candidate(1,'1.2.3.6'),candidate(2,'1.2.7.6')]}));
 assert.match(single,/Servei principal/);assert.match(single,/Alternatives per a la revisió \(1\)/);
});
