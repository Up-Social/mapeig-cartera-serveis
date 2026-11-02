import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {generalConcertMatchingCoverage,type MatchingCoverageUnit} from '../lib/concerts/matching-coverage';
import {ConcertMatchingCoverageNotice} from '../components/concert-matching-coverage-notice';
import type {SourceRecord} from '../lib/workbench-types';

const general={financingType:'concert',analysis:{rules_version:'evidence-roles-v2'}};
const unit=(code:string|null,changes:Partial<MatchingCoverageUnit>={}):MatchingCoverageUnit=>({act_type:'award',status:'draft',service_code:null,effective_service_code:null,observed_service_code:code,...changes});
const four=['1.2.6.2.4.1','1.2.6.2.4.2','1.2.6.3.4.1','1.2.6.3.4.1.2'].map(code=>unit(code));

test('counts distinct documentary codes without converting parent codes into specific services',()=>{
 assert.equal(generalConcertMatchingCoverage(general,four),4);
 assert.equal(generalConcertMatchingCoverage(general,four.slice(0,3)),null);
 assert.equal(generalConcertMatchingCoverage(general,[...four.slice(0,3),four[0],unit(null),unit('  ')]),null);
});

test('a fourth code beyond the first six cards is still counted from the complete unit set',()=>{
 const all=[four[0],four[0],four[1],four[1],four[2],four[2],four[3]];
 assert.equal(generalConcertMatchingCoverage(general,all),4);
 assert.equal(generalConcertMatchingCoverage(general,all.slice(0,6)),null);
 const snapshot=JSON.stringify(all);generalConcertMatchingCoverage(general,all);assert.equal(JSON.stringify(all),snapshot);
});

test('uses API correction values and the exact existing card precedence',()=>{
 const corrected=[...four.slice(0,3),unit(four[3].observed_service_code,{effective_service_code:four[0].observed_service_code})];
 assert.equal(generalConcertMatchingCoverage(general,corrected),null);
 const established=[...corrected.slice(0,3),{...corrected[3],service_code:four[3].observed_service_code}];
 assert.equal(generalConcertMatchingCoverage(general,established),4);
 const correctedFourth=[...four.slice(0,3),unit(four[0].observed_service_code,{effective_service_code:four[3].observed_service_code})];
 assert.equal(generalConcertMatchingCoverage(general,correctedFourth),4);
});

test('excludes rejected lines and non-award acts without changing their data',()=>{
 for(const change of [{status:'rejected'},{act_type:'modification'},{act_type:'renewal'},{act_type:'cession'},{act_type:'amendment'},{act_type:'termination'}]){
  const rows=[...four.slice(0,3),{...four[3],...change}];
  assert.equal(generalConcertMatchingCoverage(general,rows),null);
 }
 assert.equal(generalConcertMatchingCoverage(general,four.map(row=>({...row,status:'approved'}))),4);
});

test('does not warn for reconciled/program analyses, other financing types or before analysis',()=>{
 for(const version of ['concert-reconciled-annex-v1','concert-program-lines-v2','concert-title-no-award-v1','unknown-version',''])assert.equal(generalConcertMatchingCoverage({...general,analysis:{rules_version:version}},four),null);
 for(const version of ['evidence-roles-v1','evidence-roles-v3','evidence-roles-v4','leaf-normative-v1'])assert.equal(generalConcertMatchingCoverage({...general,analysis:{rules_version:version}},four),4);
 for(const financingType of ['conveni','contractacio','subvencio'])assert.equal(generalConcertMatchingCoverage({...general,financingType},four),null);
 assert.equal(generalConcertMatchingCoverage({...general,analysis:null},four),null);
});

test('renders a non-blocking warning, never an approval or a candidate list',()=>{
 const record=general as Pick<SourceRecord,'financingType'|'analysis'>;
 const html=renderToStaticMarkup(createElement(ConcertMatchingCoverageNotice,{record,units:four}));
 assert.match(html,/role="status"/);assert.match(html,/4 codis diferents/);
 assert.match(html,/no confirma els serveis ni els imports/);assert.match(html,/no modifica les decisions de revisió/);
 assert.doesNotMatch(html,/<(?:button|input|select)\b|disabled=/);
 assert.equal(renderToStaticMarkup(createElement(ConcertMatchingCoverageNotice,{record,units:four.slice(0,3)})),'');
});
