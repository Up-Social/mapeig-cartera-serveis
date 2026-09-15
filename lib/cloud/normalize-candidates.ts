import {assertEligible,type OfficialService} from '../official-catalog';
import type {AnalysisOutput} from '../analysis-contract';
// The selected code identifies the normative reference; case facts still need
// documentary validation and the independent service-specific positive audit.
export function normalizeCandidates(value:AnalysisOutput,all:OfficialService[],chunkCount:number):AnalysisOutput {
 if(value.classification!=='in_portfolio'||!Array.isArray(value.candidates))return value;
 const candidates=value.candidates.map(c=>{
  const service=assertEligible(c.code,all);
  if(!Number.isFinite(c.score)||c.score<0||c.score>1||typeof c.population_compatible!=='boolean'||!Array.isArray(c.evidence_ordinals)||(c.population_compatible&&!c.evidence_ordinals.length)||c.evidence_ordinals.some(n=>!Number.isInteger(n)||n<1||n>chunkCount))throw Error('INVALID_CANDIDATE');
  return {...c,legal_reference:service.legal_reference};
 }).filter(c=>c.population_compatible);
 if(value.candidates.length && (!candidates.length||value.population_verified===false||value.social_service_verified===false))return {...value,classification:'insufficient_evidence',candidates:[],reasons:[],explanation:'No es pot confirmar la correspondència: manca acreditar la compatibilitat del servei o dels destinataris. '+value.explanation};
 return {...value,candidates};
}
