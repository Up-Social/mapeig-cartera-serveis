import {DISCARD_REASONS} from './analysis-contract';
export type ReviewOutcome = 'select' | 'reject' | 'outside' | 'insufficient';
export const REVIEW_LABELS:Record<ReviewOutcome,string>={select:'Aprovar selecció',reject:'Descartar',outside:'Servei social fora de la cartera',insufficient:'Evidència insuficient'};
export const DISCARD_REASON_LABELS:Record<string,string>={not_social_service:'No és un servei social',incompatible_population:'Població incompatible',interadministrative_transfer:'Transferència entre administracions',individual_grant:'Ajuda directa a una persona física',economic_benefit:'Prestació econòmica',technological_benefit:'Prestació tecnològica'};
export function reviewValidation(outcome:ReviewOutcome,notes:string,reasons:string[],rectification=false) {
 if((outcome!=='select'||rectification)&&!notes.trim())return 'Cal justificar aquesta decisió.';
 if(outcome==='reject'&&(!reasons.length||reasons.some(r=>!DISCARD_REASONS.includes(r as typeof DISCARD_REASONS[number]))))return 'Selecciona almenys un motiu de descart.';
 return null;
}
