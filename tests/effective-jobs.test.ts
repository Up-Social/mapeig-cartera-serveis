import {test} from 'node:test';
import assert from 'node:assert/strict';
import {effectiveJobs} from '../lib/effective-jobs';
import {latestAnalysis} from '../lib/latest-analysis';

test('a newer comparative verification cannot replace a human-approved analysis',()=>{
 const approved={id:'approved',created_at:'2026-09-02',analysis_results:[{classification:'in_portfolio'}]};
 const check={id:'check',created_at:'2026-10-15',verification_only:true,analysis_results:[{classification:'insufficient_evidence'}]};
 assert.deepEqual(effectiveJobs([approved,check]),[approved]);
 assert.equal(latestAnalysis(effectiveJobs([approved,check]))?.classification,'in_portfolio');
 assert.equal(latestAnalysis([check])?.classification,'insufficient_evidence');
});
test('normal new attempts retain precedence and legacy jobs remain effective',()=>{
 const jobs=[{id:'old',created_at:'2026-09-02',analysis_results:[{classification:'in_portfolio'}]},
 {id:'new',created_at:'2026-10-15',verification_only:false,analysis_results:[]}];
 assert.equal(effectiveJobs(jobs).length,2);
 assert.equal(latestAnalysis(effectiveJobs(jobs)),null);
 assert.deepEqual(effectiveJobs(null),[]);
});
