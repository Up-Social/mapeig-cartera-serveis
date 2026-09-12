import {assertEligible,type OfficialService} from './official-catalog';
export const CLASSIFICATIONS=['in_portfolio','out_of_portfolio','discarded','insufficient_evidence'] as const;
export type Classification=typeof CLASSIFICATIONS[number];
export const DISCARD_REASONS=['not_social_service','incompatible_population','interadministrative_transfer','individual_grant','economic_benefit','technological_benefit'] as const;
export const CLASSIFICATION_LABELS:Record<Classification,string>={in_portfolio:'En cartera',out_of_portfolio:'Fora de cartera',discarded:'Descartat',insufficient_evidence:'Evidència insuficient'};
export type AnalysisOutput={classification:Classification;reasons:string[];explanation:string;service_description:string;target_population:string; evidence_ordinals:number[];population_verified:boolean;social_service_verified:boolean;candidates:CandidateOutput[]};
export type CandidateOutput={code:string;score:number;rationale:string;evidence_ordinals:number[];evidence_explanation:string;population_compatible:boolean;legal_reference:string};
export function analysisSchema(candidateSchema:Record<string,unknown>){return {classification:{type:'string',enum:CLASSIFICATIONS},reasons:{type:'array',items:{type:'string',enum:DISCARD_REASONS}},explanation:{type:'string',minLength:20},service_description:{type:'string'},target_population:{type:'string'},evidence_ordinals:{type:'array',items:{type:'integer',minimum:1}},population_verified:{type:'boolean'},social_service_verified:{type:'boolean'},candidates:candidateSchema};}
export function validateAnalysis(value:AnalysisOutput,all:OfficialService[],chunkCount:number,complete=true):AnalysisOutput {
 if(!CLASSIFICATIONS.includes(value.classification)||typeof value.explanation!=='string'||value.explanation.trim().length<20)throw Error('Resposta de classificació invàlida');
 if(!Array.isArray(value.candidates)||value.candidates.length>3||!Array.isArray(value.reasons)||value.reasons.some(r=>!DISCARD_REASONS.includes(r as typeof DISCARD_REASONS[number])))throw Error('Contracte de classificació invàlid');
 const ordinals=(items:number[])=>Array.isArray(items)&&items.length>0&&items.every(n=>Number.isInteger(n)&&n>0&&n<=chunkCount);
 if(!ordinals(value.evidence_ordinals))throw Error('Falta evidència de la classificació');
 if(value.classification==='discarded'&&!value.reasons.length)throw Error('Cal un motiu de descart');
 if(value.classification!=='discarded'&&value.reasons.length)throw Error('Motius de descart incompatibles amb la classificació');
 if(value.classification==='in_portfolio'||value.classification==='out_of_portfolio') {
  if(!complete||!value.population_verified||!value.social_service_verified||!value.target_population.trim()||!value.service_description.trim())throw Error('Cal acreditar servei i destinataris amb catàleg complet');
 }
 if(value.classification!=='in_portfolio'&&value.candidates.length)throw Error('Un resultat sense correspondència no pot tenir candidats');
 if(value.classification==='in_portfolio'&&!value.candidates.length)throw Error('Falta el servei proposat');
 for(const c of value.candidates){const service=assertEligible(c.code,all);if(!Number.isFinite(c.score)||c.score<0||c.score>1||!c.population_compatible||!ordinals(c.evidence_ordinals)||c.legal_reference!==service.legal_reference)throw Error('Candidat incompatible o sense evidència normativa/documental');}
 const sorted=[...value.candidates].sort((a,b)=>b.score-a.score);
 return {...value,candidates:sorted.filter((c,i)=>sorted.findIndex(x=>x.code===c.code)===i)};
}
export type StoredAnalysis={id:string;classification:Classification;reasons:string[];explanation:string;service_description:string;target_population:string;catalog_version_id:string;rules_version:string;reviewed_classification:Classification|null;review_notes:string|null;evidence:Array<{content:string;url?:string}>};
