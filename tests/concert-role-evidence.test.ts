import test from 'node:test';
import assert from 'node:assert/strict';
import {applyConcertRoleReview,concertRolesNeedingReview} from '../lib/concerts/role-evidence';
import {hasLiteralRoleEvidence,type RoleFacts} from '../lib/scope-rules';

const chunks=[{content:'No s’adjudica el servei de pis assistit per a joves majors de 18 anys.'},
 {content:'Resolc assignar el servei de pis assistit a l’entitat que consta a l’annex.'}];
const fact={state:'known' as const,value:'servei de pis assistit',kind:'yes',evidence_ordinals:[1],quotes:['Es finança el servei de pis assistit.']};
const roles:Partial<RoleFacts>={final_service:fact};

test('a value mentioned in a negation cannot repair its own evidence',()=>{
 assert.deepEqual(concertRolesNeedingReview(roles,chunks),['final_service']);
 assert.equal(hasLiteralRoleEvidence(fact,chunks),false);
 assert.throws(()=>applyConcertRoleReview(roles,chunks,undefined));
 const rejected=applyConcertRoleReview(roles,chunks,{checks:[{role:'final_service',state:'unknown',evidence_ordinal:0}]});
 assert.equal(rejected.roles.final_service?.state,'unknown');
 assert.equal(hasLiteralRoleEvidence(rejected.roles.final_service,chunks),false);
});
test('independent review selects the complete literal source, not a fabricated quotation',()=>{
 const reviewed=applyConcertRoleReview(roles,chunks,{checks:[{role:'final_service',state:'known',evidence_ordinal:2}]});
 assert.deepEqual(reviewed.roles.final_service?.quotes,[chunks[1].content]);
 assert.deepEqual(reviewed.roles.final_service?.evidence_ordinals,[2]);
 assert.equal(hasLiteralRoleEvidence(reviewed.roles.final_service,chunks),true);
 assert.deepEqual(roles.final_service,fact);
});
test('unknown, contradictory and already literal facts never enter quote repair',()=>{
 for(const f of [{...fact,state:'unknown' as const},{...fact,state:'contradictory' as const},{...fact,quotes:[chunks[0].content]}]){
  assert.deepEqual(concertRolesNeedingReview({final_service:f},chunks),[]);
  assert.throws(()=>applyConcertRoleReview({final_service:f},chunks,{checks:[{role:'final_service',state:'known',evidence_ordinal:2}]}));
 }
});
test('missing, duplicated, foreign and out-of-range review decisions fail closed',()=>{
 for(const checks of [[],[{role:'final_population',state:'known',evidence_ordinal:2}],
  [{role:'final_service',state:'known',evidence_ordinal:0}],
  [{role:'final_service',state:'known',evidence_ordinal:3}],
  [{role:'final_service',state:'unknown',evidence_ordinal:2}],
  [{role:'final_service',state:'known',evidence_ordinal:2},{role:'final_service',state:'known',evidence_ordinal:2}]]){
  assert.throws(()=>applyConcertRoleReview(roles,chunks,{checks}));
 }
});
