import {assertEligible,eligibleServices,type OfficialService} from '../official-catalog';
import type {AnalysisOutput} from '../analysis-contract';
// The selected code identifies the normative reference; case facts still need
// documentary validation and the independent service-specific positive audit.
export function insufficientForIneligibleCode(value:AnalysisOutput,all:OfficialService[],documentedCodes:ReadonlySet<string>=new Set()):AnalysisOutput|null {
 if(value.classification!=='in_portfolio'||!Array.isArray(value.candidates))return null;
 const eligible=new Set([...eligibleServices(all).map(service=>service.service_code),...documentedCodes]);
 if(!value.candidates.some(candidate=>!eligible.has(candidate.code)))return null;
 return {...value,classification:'insufficient_evidence',reasons:[],candidates:[],explanation:'La proposta automàtica conté un codi que no identifica una prestació de servei elegible de la Cartera. Cal revisar la correspondència amb la font oficial abans de proposar cap servei.'};
}
export function normalizeCandidates(value:AnalysisOutput,all:OfficialService[],chunkCount:number,documentedCodes:ReadonlySet<string>=new Set()):AnalysisOutput {
 if(value.classification!=='in_portfolio'||!Array.isArray(value.candidates))return value;
 const candidates=value.candidates.filter(c=>Number.isFinite(c.score)&&c.score>0).map(c=>{
  const service=documentedCodes.has(c.code)?all.find(s=>s.service_code===c.code&&s.benefit_type==='service')??assertEligible(c.code,all):assertEligible(c.code,all);
  if(c.score>1||typeof c.population_compatible!=='boolean'||!Array.isArray(c.evidence_ordinals)||(c.population_compatible&&!c.evidence_ordinals.length)||c.evidence_ordinals.some(n=>!Number.isInteger(n)||n<1||n>chunkCount))throw Error('INVALID_CANDIDATE');
  return {...c,legal_reference:service.legal_reference};
 }).filter(c=>c.population_compatible);
 if(value.candidates.length && (!candidates.length||value.population_verified===false||value.social_service_verified===false))return {...value,classification:'insufficient_evidence',candidates:[],reasons:[],explanation:[value.social_service_verified===false?'No s’ha acreditat el servei finançat.':null,value.population_verified===false?'No s’han acreditat els destinataris del servei.':null,!candidates.length?'Cap servei proposat té compatibilitat documental acreditada.':null].filter(Boolean).join(' ')};
 return {...value,candidates};
}
