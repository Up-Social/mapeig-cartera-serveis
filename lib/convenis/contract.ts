import {ConveniValidationError,type ConveniDiagnostic} from './diagnostics';
/** Sprint 2 policy: client conversation takes precedence over the original PDF. */
export const CONVENI_VERSION = 'convenis-sprint2-v1';
export const SOURCE_NAME = 'Registre de Convenis de Col·laboració i Cooperació';
export type Payload = Record<string, unknown>;
export const EXCLUSION_LABELS: Record<string,string> = {
 interadministrative_agreement:'Conveni interadministratiu',
 excluded_amendment:'Fora de l’abast del Sprint 2: addenda, pròrroga o modificació',
 no_public_funding:'Sense aportació pública prevista',
};
export function cents(value: unknown): number | null {
 if (typeof value !== 'number' && typeof value !== 'string') return null;
 let text=String(value).trim().replace(/\s|€/g,'');
 if (!text) return null;
 if (text.includes(',')) { if(!/^-?\d{1,3}(?:\.\d{3})*,\d{1,2}$|^-?\d+,\d{1,2}$/.test(text))return null; text=text.replaceAll('.','').replace(',','.'); }
 if(!/^-?\d+(?:\.\d{1,2})?$/.test(text))return null;
 const negative=text.startsWith('-');const [whole,fraction='']=text.replace('-','').split('.');
 const result=(Number(whole)*100+Number(fraction.padEnd(2,'0')))*(negative?-1:1);
 return Number.isSafeInteger(result)?result:null;
}
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
export const normalize=(v:string)=>v.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function normalizeConveni(payload:Payload) {
 const generalitat=cents(payload['Total aportacions previstes Generalitat']);
 const local=cents(payload['Total aportacions previstes ens locals']);
 const publicCents=generalitat===null||local===null||generalitat<0||local<0||!Number.isSafeInteger(generalitat+local)?null:generalitat+local;
 return {publicCents, generalitatCents:generalitat, localCents:local, otherCents:cents(payload['Total aportacions previstes altres Organismes']),
  originalTotalCents:cents(payload['Sumatori aportacions totals previstes']),
  signatories:text(payload['Altres Organismes Signants']).split(';').map(v=>v.trim()).filter(Boolean),
  publicSignatories:[text(payload['Organismes signants per part de la Generalitat']),text(payload['Organismes signants ens locals'])].filter(Boolean),
  aocCodes:(typeof payload['Codi AOC organismes signants ens locals']==='number'?String(payload['Codi AOC organismes signants ens locals']):text(payload['Codi AOC organismes signants ens locals'])).split(';').map(v=>v.trim()).filter(Boolean),
  related:text(payload['Convenis relacionats']).split(';').map(v=>v.trim()).filter(Boolean),
  agreementUrl:text(payload['Document conveni'])||null,
  annexes:Object.entries(payload).filter(([key,v])=>/annex/i.test(key)&&typeof v==='string'&&/^https?:\/\//.test(v)).map(([field,url])=>({field,url:String(url)})),
 };
}
export function screenTitle(title:string):string|null {
 const t=normalize(title);
 // Match the act being registered, not a modification/original cited later in its title.
 if(/^(?:(?:primera|segona|tercera|quarta|cinquena|sisena|setena|vuitena|novena|desena|\d+(?:a|na|n|r)?) )?(?:addenda|adenda|prorroga|modificacio)\b/.test(t))return 'excluded_amendment';
 if(/^conveni (?:de )?(?:prorroga|modificacio)\b|^adhesio a la (?:(?:primera|segona|tercera) )?addenda\b/.test(t))return 'excluded_amendment';
 if(/^(?:[ivxlcdm]+ )?conveni (?:marc )?(?:(?:de )?col laboracio )?interadministratiu\b|^(?:[ivxlcdm]+ )?conveni (?:marc )?de (?:col laboracio(?: i cooperacio)?|cooperacio) interadministrativa\b/.test(t))return 'interadministrative_agreement';
 return null;
}
export function screenConveni(title:string,payload:Payload) {
 const reason=screenTitle(title)??(normalizeConveni(payload).publicCents===0?'no_public_funding':null);
 return reason?{reason,label:EXCLUSION_LABELS[reason],version:CONVENI_VERSION}:null;
}
export type Citation={document_id:string;page:number;quote:string};
export type Actor={name:string;nif:string|null;nature:'public'|'private'|'unknown';roles:Array<'signatory'|'recipient'|'provider'|'financier'>;evidence:Citation[]};
export type ConveniUnit={key:string;recipient:string;recipient_nif:string|null;recipient_nature:'public'|'private'|'unknown';joint:boolean;period:string;year:number|null;amount_cents:number|null;amount_state:'planned'|'conditional'|'confirmed';mixed:boolean;financiers:string[];territory:string|null;classification:'in_portfolio'|'out_of_portfolio'|'discarded'|'insufficient_evidence';service_code:string|null;population:string;description:string;explanation:string;reason:string|null;evidence:Citation[];blockers:string[];service_name?:string|null;semantic_version?:string;social_assessment?:SocialAssessment};
export type ConveniAnalysis={actors:Actor[];units:ConveniUnit[];instrument_grant:boolean;coverage_complete:boolean;unallocated_cents:number|null;summary:string};
export type SocialAssessment={status:'social'|'non_social'|'uncertain';explanation:string;evidence:Citation[]};
export type DocumentEvidence={id:string;extracted_text:string;storage_sha256:string;active_extraction_id?:string|null};
export function unitKey(recipient:string,period:string){return `${normalize(recipient)}|${normalize(period)}`;}
/** A name variant can refer to the same documented recipient. A NIF links an
 * actor; it never establishes private nature or an economic role by itself. */
function documentedPrivateRecipient(unit:ConveniUnit,actors:Actor[]) {
 const nif=(value:string|null)=>value?.replace(/[\s-]/g,'').toUpperCase()??'';
 const recipientNif=nif(unit.recipient_nif);
 const matches=recipientNif?actors.filter(a=>nif(a.nif)===recipientNif):[];
 const candidates=matches.length?matches:actors.filter(a=>normalize(a.name)===normalize(unit.recipient)&&(!recipientNif||!nif(a.nif)||nif(a.nif)===recipientNif));
 return candidates.length>0&&candidates.every(a=>a.nature==='private')&&candidates.some(a=>a.roles.includes('recipient'));
}
function citationPage(c:Citation,documents:DocumentEvidence[]) {
 if(!c||typeof c!=='object')return null;
 const doc=documents.find(d=>d.id===c.document_id);if(!doc||!Number.isInteger(c.page)||c.page<1)return null;
 const marked=[...doc.extracted_text.matchAll(/^## Pàgina (\d+)\s*\n([\s\S]*?)(?=^## Pàgina \d+\s*$|$(?![\s\S]))/gm)];
 return marked.length?marked.find(m=>Number(m[1])===c.page)?.[2]??null:c.page===1?doc.extracted_text:null;
}
export function validCitation(c:Citation,documents:DocumentEvidence[]) {
 const page=citationPage(c,documents);if(typeof c?.quote!=='string'||c.quote.trim().length<12)return false;
 return !!page&&page.replace(/\s+/g,' ').includes(c.quote.replace(/\s+/g,' ').trim());
}
/** Explain literal failures without changing quotes, pages, or recipient facts. */
export function conveniCitationDiagnostics(input:ConveniAnalysis,documents:DocumentEvidence[]):ConveniDiagnostic[] {
 const issues:ConveniDiagnostic[]=[];
 const groups=[...(input.actors??[]).map((a,index)=>({field:'actors',index,name:a.name,evidence:a.evidence})),...(input.units??[]).flatMap((u,index)=>[{field:'units',index,name:u.recipient,evidence:u.evidence},...(u.social_assessment?[{field:'units.social_assessment',index,name:u.recipient,evidence:u.social_assessment.evidence}]:[])])];
 for(const group of groups){
  if(!Array.isArray(group.evidence)||!group.evidence.length){issues.push({code:'CONVENI_EVIDENCE_MISSING',message:`Evidència absent: ${group.field}[${group.index}] (${group.name}).`,field:group.field,index:group.index,recipient:group.name});continue;}
  group.evidence.forEach((citation,index)=>{if(!validCitation(citation,documents)){
   const fold=(s:string)=>s.replace(/\s+/g,' ').trim().normalize('NFD').replace(/\p{M}/gu,'');
   const page=citationPage(citation,documents);
   const variant=!!page&&typeof citation?.quote==='string'&&citation.quote.trim().length>=12&&fold(page).includes(fold(citation.quote));
   issues.push({code:variant?'CONVENI_CITATION_DIACRITIC_VARIANT':'CONVENI_CITATION_UNVERIFIABLE',message:`${variant?'Cita amb diferència de diacrítics respecte del text extret; cal contrast visual, sense acceptació automàtica':'Cita d’evidència no verificable literalment'}: ${group.field}[${group.index}].evidence[${index}] (${group.name}), pàgina ${citation?.page??'desconeguda'}.`,field:`${group.field}[${group.index}].evidence[${index}]`,index:group.index,recipient:group.name,documentId:citation?.document_id,page:citation?.page,quote:citation?.quote,...(variant?{requiresVisualReview:true}:{})});
  }});
 }
 return issues;
}
/** Repeated recipient/period may represent different concepts, or a duplicate.
 * Both require review; neither permits blind summing, dropping, or splitting. */
export function conveniUnitCollisions(units:ConveniUnit[]):ConveniDiagnostic[] {
 const groups=new Map<string,Array<{unit:ConveniUnit;index:number}>>();
 units.forEach((unit,index)=>{if(unit?.recipient&&unit.period){const key=unitKey(unit.recipient,unit.period);groups.set(key,[...(groups.get(key)??[]),{unit,index}]);}});
 return [...groups.values()].filter(g=>g.length>1).map(group=>({code:'CONVENI_RECIPIENT_PERIOD_COLLISION',message:'Identitat de receptor i període repetida; poden ser conceptes diferents. Cal revisar l’agrupació abans de sumar, descartar o repartir imports.',recipient:group[0].unit.recipient,period:group[0].unit.period,units:group.map(({unit,index})=>({index,amount_cents:unit.amount_cents,classification:unit.classification}))}));
}
/** Reconcile independently of identity/citation failures, so the first error
 * cannot hide a missing table row or tempt a reviewer to merge blindly. */
export function conveniFundingDiagnostics(input:ConveniAnalysis,payload:Payload):ConveniDiagnostic[] {
 const expected=normalizeConveni(payload).publicCents;
 if(expected===null||input.unallocated_cents===null||!Number.isSafeInteger(input.unallocated_cents)||input.unallocated_cents<0||input.units.some(u=>u?.amount_cents===null||!Number.isSafeInteger(u?.amount_cents)||u.amount_cents!<0))return [{code:'CONVENI_AMOUNT_UNRESOLVED',message:'Import públic, unitat o romanent pendent; no es pot conciliar.',field:'amount_cents'}];
 const allocated=input.units.reduce((sum,u)=>sum+BigInt(u.amount_cents!),BigInt(0)),difference=BigInt(expected)-allocated-BigInt(input.unallocated_cents);
 if(allocated>BigInt(Number.MAX_SAFE_INTEGER)||difference>BigInt(Number.MAX_SAFE_INTEGER)||difference<BigInt(Number.MIN_SAFE_INTEGER))return [{code:'CONVENI_AMOUNT_OVERFLOW',message:'Suma fora del rang segur de cèntims; no es pot consolidar.',field:'amount_cents'}];
 return difference===BigInt(0)?[]:[{code:'CONVENI_RECONCILIATION_DIFFERENCE',message:'El desglossament no concilia amb l’aportació pública; cal revisar files i conceptes sense inventar el romanent.',field:'amount_cents',expected_cents:expected,allocated_cents:Number(allocated),unallocated_cents:input.unallocated_cents,difference_cents:Number(difference)}];
}
export const BLOCKER_LABELS:Record<string,string>={joint:'Import conjunt sense repartiment',mixed:'Import mixt pendent d’atribució',unknown_recipient:'Naturalesa del receptor pendent',missing_nif:'NIF del receptor pendent',missing_amount:'Import pendent',reconciliation:'Desglossament no conciliat',incomplete:'Cobertura documental incompleta',unknown_service:'Servei principal no acreditat',multiple_services:'Més d’un servei principal per entitat',public_recipient:'Receptor públic fora de l’abast',duplicate:'Unitat repetida',invalid_nif:'NIF no vàlid'};
export function validateConveni(input:ConveniAnalysis,payload:Payload,documents:DocumentEvidence[],eligibleCodes:Set<string>,options:{requireSemanticAssessment?:boolean}={}):ConveniAnalysis {
 if(!input||!Array.isArray(input.units)||!input.units.length||input.units.length>500||!Array.isArray(input.actors)||typeof input.summary!=='string'||typeof input.instrument_grant!=='boolean'||typeof input.coverage_complete!=='boolean')throw Error('Resposta de conveni incompleta');
 const hardIssues=[...conveniCitationDiagnostics(input,documents),...conveniUnitCollisions(input.units)];
 if(hardIssues.length)throw new ConveniValidationError(hardIssues[0],[...hardIssues,...conveniFundingDiagnostics(input,payload)]);
 const validEvidence=(items:Citation[])=>Array.isArray(items)&&items.length>0&&items.every(c=>validCitation(c,documents));
 for(const actor of input.actors)if(!actor.name?.trim()||!['public','private','unknown'].includes(actor.nature)||!Array.isArray(actor.roles)||!actor.roles.every(r=>['signatory','recipient','provider','financier'].includes(r))||!validEvidence(actor.evidence))throw Error('Actor sense evidència documental verificable');
 const units=input.units.map(u=>{
  if(!u.recipient?.trim()||!u.period?.trim()||!u.explanation?.trim()||!validEvidence(u.evidence)||!['in_portfolio','out_of_portfolio','discarded','insufficient_evidence'].includes(u.classification)||!['planned','conditional','confirmed'].includes(u.amount_state)||typeof u.joint!=='boolean'||typeof u.mixed!=='boolean'||!['public','private','unknown'].includes(u.recipient_nature)||!Array.isArray(u.financiers))throw Error('Unitat de conveni invàlida o sense evidència');
  if(u.amount_cents!==null&&(!Number.isSafeInteger(u.amount_cents)||u.amount_cents<0))throw Error('Import de conveni invàlid');
  if(u.year!==null&&(!Number.isInteger(u.year)||u.year<1900||u.year>2200))throw Error('Anualitat invàlida');
  const assessment=u.social_assessment;
  if(options.requireSemanticAssessment&&!assessment)throw new ConveniValidationError({code:'CONVENI_SOCIAL_ASSESSMENT_MISSING',message:'Falta acreditar explícitament la naturalesa social del servei.',recipient:u.recipient,field:'social_assessment'});
  if(assessment&&(!['social','non_social','uncertain'].includes(assessment.status)||!assessment.explanation?.trim()||!validEvidence(assessment.evidence)))throw Error('Valoració social sense evidència verificable');
  if(assessment&&['in_portfolio','out_of_portfolio'].includes(u.classification)&&assessment.status!=='social')throw new ConveniValidationError({code:'CONVENI_SOCIAL_CLASSIFICATION_CONFLICT',message:'Classificació positiva incompatible amb la valoració social: cal revisió, no un canvi automàtic de categoria.',recipient:u.recipient,field:'social_assessment.status'});
  if(u.classification==='in_portfolio'&&(!u.service_code||!eligibleCodes.has(u.service_code)||!u.population?.trim()||!u.description?.trim()))throw Error('Servei principal o població no acreditats');
  if(u.classification!=='in_portfolio'&&u.service_code!==null)throw Error('Codi incompatible amb la classificació');
  if(u.classification==='out_of_portfolio'&&(!u.population?.trim()||!u.description?.trim()))throw Error('Fora de cartera requereix servei i població');
  if(u.classification==='discarded'&&!u.reason?.trim())throw Error('Cal un motiu de descart');
  const key=unitKey(u.recipient,u.period);
  const blockers:string[]=[];
  if(u.joint)blockers.push('joint');if(u.mixed)blockers.push('mixed');
  if(u.recipient_nature==='unknown'||(u.recipient_nature==='private'&&!documentedPrivateRecipient(u,input.actors)))blockers.push('unknown_recipient');if(u.recipient_nature==='public')blockers.push('public_recipient');
  if(!u.recipient_nif)blockers.push('missing_nif');else if(!/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(u.recipient_nif))blockers.push('invalid_nif');
  if(u.amount_cents===null)blockers.push('missing_amount');
  if(!input.coverage_complete)blockers.push('incomplete');
  return {...u,key,blockers};
 });
 // A total and its annual children must never coexist as economic units.
 const recipients=new Set(units.map(u=>normalize(u.recipient)));
 for(const name of recipients){const own=units.filter(u=>normalize(u.recipient)===name);
  if(own.some(u=>u.year===null)&&own.some(u=>u.year!==null))throw Error('Total i anualitats duplicats');
  if(new Set(own.map(u=>u.service_code).filter(Boolean)).size>1)own.forEach(u=>u.blockers.push('multiple_services'));
 }
 if(input.unallocated_cents!==null&&(!Number.isSafeInteger(input.unallocated_cents)||input.unallocated_cents<0))throw Error('Romanent invàlid');
 const reconciled=conveniFundingDiagnostics({...input,units},payload).length===0;
 if(!reconciled)units.forEach(u=>u.blockers.push('reconciliation'));
 return {...input,units};
}

/** AOC codes are 10 digits; Excel numeric cells may have lost the initial zero. */
export const aocLookupKey=(code:string)=>/^\d{9,10}$/.test(code.trim())?code.trim().padStart(10,'0'):code.trim();
