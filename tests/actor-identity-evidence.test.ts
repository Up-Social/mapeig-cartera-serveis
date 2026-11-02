import test from 'node:test';
import assert from 'node:assert/strict';
import {applyScopeRules,hasRoleEvidence,type RoleFact,type RoleName} from '../lib/scope-rules';
import type {AnalysisOutput} from '../lib/analysis-contract';

const actorRoles:RoleName[]=['financier','economic_recipient','direct_beneficiary','service_provider'];
const fact=(value:string,quote:string):RoleFact=>({state:'known',kind:'entity',value,evidence_ordinals:[1],quotes:[quote]});
test('each actor identity with an explicit different identifier is not evidenced by a literal quote',()=>{
 const quote='La fundació amb NIF G12345678 figura a la resolució oficial.';
 for(const role of actorRoles){
  assert.equal(hasRoleEvidence(role,fact('Fundació distinta, NIF G87654321',quote),[{content:quote}]),false,role);
  assert.equal(hasRoleEvidence(role,fact('Fundació, NIF G-1234567-8',quote),[{content:quote}]),true,role);
 }
});
test('identifier boundaries, formats and unlabelled names do not invent evidence',()=>{
 const run=(value:string,quote:string)=>hasRoleEvidence('economic_recipient',fact(value,quote),[{content:quote}]);
 assert.equal(run('Fundació amb NIF G12345678','El text conté XXG12345678X com a referència interna.'),false);
 assert.equal(run('Fundació amb NIF G12345678','El text conté ÑG12345678 com a referència interna.'),false);
 assert.equal(run('Fundació amb NIF G12345678','El text conté G12345678é com a referència interna.'),false);
 assert.equal(run('Titular NIE X1234567A','La resolució esmenta el NIE X-1234567-A del titular.'),true);
 assert.equal(run('Titular DNI 12345678A','La resolució esmenta el DNI 12345678-A del titular.'),true);
 assert.equal(run('Titular DNI 12.345.678-A','La resolució esmenta el DNI 12345678A del titular.'),true);
 assert.equal(run('Fundació, NIF G.1.234.567.8','La resolució esmenta el NIF G12345678 de la fundació.'),true);
 assert.equal(run('Titular DNI 12.345.678-A','La resolució esmenta el DNI 87654321B del titular.'),false);
 assert.equal(run('Fundació Serra','Entitat social prestadora de suport comunitari.'),true,'names without an explicit identifier retain the existing paraphrase contract');
 assert.equal(hasRoleEvidence('final_population',fact('Persones vinculades al NIF G12345678','Persones usuàries del servei social comunitari.'),[{content:'Persones usuàries del servei social comunitari.'}]),true,'population descriptions are not actor identifiers');
});
test('an unsubstantiated actor identifier cannot satisfy a determinant of individual-grant exclusion',()=>{
 const quotes=['La persona amb DNI 12345678A rep l’ajut econòmic.','La persona amb DNI 12345678A és la beneficiària directa.','L’instrument és un ajut econòmic directe a la persona.'];
 const chunks=quotes.map(content=>({content}));
 const roles={economic_recipient:{...fact('Persona, DNI 87654321B',quotes[0]),kind:'person'},
  direct_beneficiary:{...fact('Persona, DNI 12345678A',quotes[1]),kind:'person',evidence_ordinals:[2]},
  financial_instrument:{...fact('Ajut econòmic directe',quotes[2]),kind:'direct_grant',evidence_ordinals:[3]}};
 const original={classification:'discarded',reasons:['individual_grant'],candidates:[],explanation:'Ajut individual',evidence_ordinals:[1],service_description:'',target_population:'',population_verified:false,social_service_verified:false} as AnalysisOutput;
 const result=applyScopeRules(original,roles,chunks);
 assert.equal(result.classification,'insufficient_evidence');assert.equal(result.rule_audit.blocked_roles[0].role,'economic_recipient');
});
