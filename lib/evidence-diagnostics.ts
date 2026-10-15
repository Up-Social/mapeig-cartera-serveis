import type {StoredAnalysis} from './analysis-contract';
import type {SourceRecord} from './workbench-types';
export type EvidenceDiagnostic={code:string;message:string;field?:string;unitId?:string;documentId?:string;page?:number;action:'source'|'prepare'|'ocr'|'enrich'|'match'|'units'|'links';rule:string};
const fields:Record<string,string>={financed_object:'l’objecte finançat',final_population:'les persones destinatàries',final_service:'el servei prestat'};
export function sourceRecoveryDiagnostic(record:Pick<SourceRecord,'sourceDocuments'|'evidenceStatus'>):EvidenceDiagnostic|null{
 const documents=record.sourceDocuments;
 if(record.evidenceStatus==='ready'||!documents.length||!documents.every(d=>d.qualityFlags.includes('generic_portal')))return null;
 return {code:'portal_without_document',documentId:documents[0].id,message:'Només s’ha recuperat la pàgina del portal de publicació; no s’ha obtingut la resolució o l’annex oficial. Cal recuperar el document abans d’analitzar-lo. Augmentar l’OCR no resol l’absència del fitxer.',action:'prepare',rule:'source_document_quality'};
}
export function analysisDiagnostics(analysis:Pick<StoredAnalysis,'classification'|'explanation'|'rule_audit'|'model_conclusion'>):EvidenceDiagnostic[]{
 const audit=analysis.rule_audit??{};
 const explicit=Array.isArray(audit.diagnostics)?audit.diagnostics.filter((d):d is EvidenceDiagnostic=>!!d&&typeof d==='object'&&typeof d.code==='string'&&typeof d.message==='string'&&typeof d.rule==='string'&&['source','prepare','ocr','enrich','match','units','links'].includes(d.action)):[];
 if(explicit.length)return explicit;
 if(analysis.classification!=='insufficient_evidence')return [];
 const rule=String(audit.rule??'historical_result');
 if(rule==='ineligible_evidence')return [{code:'source_not_substantive',message:'No s’ha llegit una resolució o annex amb contingut útil; el portal o anunci localitzat no acredita el servei.',action:'prepare',rule}];
 const blocked=Array.isArray(audit.blocked_roles)?audit.blocked_roles.filter((d):d is {role:string;reason:string}=>!!d&&typeof d==='object'&&typeof d.role==='string'&&typeof d.reason==='string'):[];
 if(blocked?.length)return blocked.map(({role,reason})=>({code:reason,field:role,message:`Falta acreditar ${fields[role]??role}: ${reason==='contradictory'?'hi ha informació contradictòria':reason==='missing_fact'?'el fet no consta als fragments analitzats':'la cita no es pot verificar literalment en els fragments analitzats'}.`,action:'enrich',rule}));
 const original=analysis.model_conclusion;
 if(original?.population_verified===false||original?.social_service_verified===false)return [
  ...(original.population_verified===false?[{code:'population_unverified',field:'final_population',message:'No s’ha acreditat la compatibilitat dels destinataris amb el servei proposat.',action:'match' as const,rule}]:[]),
  ...(original.social_service_verified===false?[{code:'service_unverified',field:'final_service',message:'No s’ha acreditat quin servei concret finança aquesta resolució.',action:'match' as const,rule}]:[]),
 ];
 if(rule==='unknown_determinant_role')return [{code:'legacy_role_check',message:'La comprovació anterior no va acreditar l’objecte, el servei o els destinataris. Aquella versió no va registrar quin fet o cita fallava; cal repetir l’anàlisi amb el diagnòstic actual.',action:'enrich',rule}];
 if(audit.model_evidence_issue||analysis.explanation.startsWith('La comprovació'))return [{code:String(audit.model_evidence_issue??'service_check_failed'),message:analysis.explanation,action:'match',rule}];
 return [{code:'unresolved_evidence',message:analysis.explanation,action:'source',rule}];
}
export function diagnosticSummary(analysis:Parameters<typeof analysisDiagnostics>[0]){return analysisDiagnostics(analysis).map(d=>d.message).join(' ');}
