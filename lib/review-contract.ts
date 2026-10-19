import {EXCLUSION_LABELS} from './convenis/contract';
import {DISCARD_REASONS} from './analysis-contract';
export type ReviewOutcome = 'select' | 'reject' | 'outside' | 'insufficient';
export const REVIEW_LABELS:Record<ReviewOutcome,string>={select:'Aprovar selecció',reject:'Descartar',outside:'Servei social fora de la cartera',insufficient:'Evidència insuficient'};
export const DISCARD_REASON_LABELS:Record<string,string>={...EXCLUSION_LABELS,not_social_service:'No és un servei social',incompatible_population:'Població incompatible',interadministrative_transfer:'Transferència entre administracions',individual_grant:'Ajuda directa a una persona física',economic_benefit:'Prestació econòmica',technological_benefit:'Prestació tecnològica',no_concert_award:'L’acte no adjudica cap concert'};
export function reviewValidation(outcome:ReviewOutcome,notes:string,reasons:string[],rectification=false) {
 if((outcome!=='select'||rectification)&&!notes.trim())return 'Cal justificar aquesta decisió.';
 if(outcome==='reject'&&(!reasons.length||reasons.some(r=>!DISCARD_REASONS.includes(r as typeof DISCARD_REASONS[number]))))return 'Selecciona almenys un motiu de descart.';
 return null;
}

/** Shared policy: only concerts exclude the outside-portfolio decision. */
export function reviewOptions(financingType:string) {
 return (Object.keys(REVIEW_LABELS) as ReviewOutcome[]).filter(value=>financingType!=='concert'||value!=='outside')
  .map(value=>({value,label:financingType==='concert'?({select:'Aprovar concert',reject:'Descartar concert',insufficient:'Pendent de completar · Evidència insuficient'} as Partial<Record<ReviewOutcome,string>>)[value]??REVIEW_LABELS[value]:REVIEW_LABELS[value]}));
}
export function isReviewOutcomeAllowed(financingType:string,outcome:string) {
 return reviewOptions(financingType).some(option=>option.value===outcome);
}

export const MANUAL_DISCARD_REASONS=Object.fromEntries(Object.entries(DISCARD_REASON_LABELS).filter(([key])=>DISCARD_REASONS.includes(key as typeof DISCARD_REASONS[number])));
