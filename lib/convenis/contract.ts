import {ConveniValidationError,type ConveniDiagnostic} from './diagnostics';
import {missingDiscardDiagnostic} from './missing-discard';
/** Sprint 2 policy: client conversation takes precedence over the original PDF. */
export const CONVENI_VERSION = 'convenis-sprint2-v1';
export const CONVENI_NORMALIZATION_VERSION = 'conveni-concepts-v4';
export const SOURCE_NAME = 'Registre de Convenis de Col·laboració i Cooperació';
export type Payload = Record<string, unknown>;
export const EXCLUSION_LABELS: Record<string,string> = {
 interadministrative_agreement:'Conveni interadministratiu',
 excluded_amendment:'Fora de l’abast del Sprint 2: addenda, pròrroga o modificació',
 no_public_funding:'Aportació prevista de la Generalitat i els ens locals: 0',
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
  signatoriesState:text(payload['Altres Organismes Signants']).split(';').some(v=>v.trim())?'listed':'unknown',
  publicSignatories:[text(payload['Organismes signants per part de la Generalitat']),text(payload['Organismes signants ens locals'])].filter(Boolean),
  aocCodes:(typeof payload['Codi AOC organismes signants ens locals']==='number'?String(payload['Codi AOC organismes signants ens locals']):text(payload['Codi AOC organismes signants ens locals'])).split(';').map(v=>v.trim()).filter(Boolean),
  related:text(payload['Convenis relacionats']).split(';').map(v=>v.trim()).filter(Boolean),
  agreementUrl:text(payload['Document conveni'])||null,
  annexes:Object.entries(payload).filter(([key,v])=>/annex/i.test(key)&&typeof v==='string'&&/^https?:\/\//.test(v)).map(([field,url])=>({field,url:String(url)})),
 };
}
export type Citation={document_id:string;page:number;quote:string};
export type Actor={name:string;nif:string|null;nature:'public'|'private'|'unknown';roles:Array<'signatory'|'recipient'|'provider'|'financier'>;evidence:Citation[]};
export type ConveniUnit={key:string;recipient:string;recipient_nif:string|null;recipient_nature:'public'|'private'|'unknown';joint:boolean;period:string;year:number|null;amount_cents:number|null;amount_state:'planned'|'conditional'|'confirmed';mixed:boolean;financiers:string[];territory:string|null;classification:'in_portfolio'|'out_of_portfolio'|'discarded'|'insufficient_evidence';service_code:string|null;population:string;description:string;explanation:string;reason:string|null;evidence:Citation[];blockers:string[];service_name?:string|null;semantic_version?:string;social_assessment?:SocialAssessment;concepts?:ConveniUnit[];original_classification?:string;unresolved_service_ref?:string};
export type ConveniAnalysis={actors:Actor[];units:ConveniUnit[];instrument_grant:boolean;coverage_complete:boolean;unallocated_cents:number|null;summary:string;diagnostics?:ConveniDiagnostic[];normalization_version?:string;scope_rule?:string;scope_version?:string};
export type SocialAssessment={status:'social'|'non_social'|'uncertain';explanation:string;evidence:Citation[]};
export type DocumentEvidence={id:string;extracted_text:string;storage_sha256:string;active_extraction_id?:string|null;
 mime_type?:string|null;extraction_method?:string|null;extraction_coverage?:unknown};

/** A PDF without page markers can only support page 1 when extraction coverage
 * explicitly identifies one complete page. Plain HTML/text has no PDF pages. */
export function unmarkedConveniPageIsReliable(doc:DocumentEvidence):boolean{
 const mime=doc.mime_type?.toLowerCase().split(';')[0].trim();
 const pdf=mime==='application/pdf'||/^(?:pdf-|pdftotext)/.test(doc.extraction_method??'');
 if(!pdf)return mime==='text/html'||mime==='text/plain'||doc.extraction_method==='html-basic';
 const coverage=doc.extraction_coverage;
 if(!coverage||typeof coverage!=='object'||!('complete' in coverage)||coverage.complete!==true||!('pages' in coverage)||!Array.isArray(coverage.pages))return false;
 return coverage.pages.length===1&&typeof coverage.pages[0]==='object'&&coverage.pages[0]!==null&&coverage.pages[0].page===1;
}
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
/** A name and NIF must at least occur together in cited documentary text.
 * Co-occurrence is only a prerequisite; a human still verifies attribution. */
function recipientIdentityCited(unit:ConveniUnit,actors:Actor[]){
 const nif=(unit.recipient_nif??'').replace(/[\s-]/g,'').toUpperCase();
 const recipient=normalize(unit.recipient);
 if(!/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(nif)||!recipient)return false;
 // Allow separators inside a NIF, but never accept a longer identifier as a match.
 const pattern=new RegExp(`(?:^|[^\\p{L}\\p{N}])${[...nif].join('[\\s-]*')}(?![\\p{L}\\p{N}])`,'u');
 const matchingActors=actors.filter(actor=>actor.nature==='private'&&actor.roles.includes('recipient')&&normalize(actor.name)===recipient&&(actor.nif??'').replace(/[\s-]/g,'').toUpperCase()===nif);
 return [...unit.evidence,...matchingActors.flatMap(actor=>actor.evidence)].some(citation=>{
  const quote=citation.quote??'';
  return ` ${normalize(quote)} `.includes(` ${recipient} `)&&pattern.test(quote.toUpperCase());
 });
}
function citationPage(c:Citation,documents:DocumentEvidence[]) {
 if(!c||typeof c!=='object')return null;
 const doc=documents.find(d=>d.id===c.document_id);if(!doc||!Number.isInteger(c.page)||c.page<1)return null;
 const marked=[...doc.extracted_text.matchAll(/^## Pàgina (\d+)\s*\n([\s\S]*?)(?=^## Pàgina \d+\s*$|$(?![\s\S]))/gm)];
 if(marked.length&&(doc.extracted_text.slice(0,marked[0].index).trim()||new Set(marked.map(m=>Number(m[1]))).size!==marked.length))return null;
 return marked.length?marked.find(m=>Number(m[1])===c.page)?.[2]??null:c.page===1&&unmarkedConveniPageIsReliable(doc)?doc.extracted_text:null;
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
/** Missing documentary facts are not evidence for excluding a case. These
 * diagnostics report what the proposal did not identify; they do not claim
 * that an incomplete extraction covered every source or page. */
export function conveniMissingFieldDiagnostics(units:ConveniUnit[]):ConveniDiagnostic[] {
 const issues:ConveniDiagnostic[]=[];
 const fields=[
  ['recipient','CONVENI_RECIPIENT_MISSING','el receptor'],
  ['period','CONVENI_PERIOD_MISSING','el període'],
  ['population','CONVENI_POPULATION_MISSING','la població destinatària'],
  ['description','CONVENI_DESCRIPTION_MISSING','la descripció del servei'],
 ] as const;
 for(const [index,unit] of units.entries()){
  if(!unit||typeof unit!=='object')continue;
  for(const [field,code,label] of fields){
   const value=unit[field];
   if(value==null||typeof value==='string'&&!value.trim())issues.push({code,field,index,
    ...(typeof unit.recipient==='string'&&unit.recipient.trim()?{recipient:unit.recipient}:{}),
    message:`No s’ha identificat ${label} a la proposta; queda pendent de contrast documental.`});
  }
 }
 return issues;
}
export const BLOCKER_LABELS:Record<string,string>={joint:'Import conjunt sense repartiment',mixed:'Import mixt pendent d’atribució',unknown_recipient:'Naturalesa del receptor pendent',missing_nif:'NIF no localitzat al document (pot estar anonimitzat)',missing_amount:'Import pendent',reconciliation:'Desglossament no conciliat',incomplete:'Cobertura documental incompleta',unknown_service:'Servei principal no acreditat',multiple_services:'Més d’un servei principal per entitat',public_recipient:'Receptor públic fora de l’abast',duplicate:'Unitat repetida',invalid_nif:'NIF no vàlid',unverified_identity:'Nom i NIF del receptor sense cita conjunta: cal contrastar-ne l’atribució'};
/** Preserve repeated concepts without assuming whether they overlap or sum.
 * Conflicting identity or period facts stay visible as a duplicate to review:
 * the record is kept instead of failing as a whole. */
export function groupConveniConcepts(units:ConveniUnit[]):ConveniUnit[]{
 const groups=new Map<string,ConveniUnit[]>();
 for(const unit of units)groups.set(unit.key,[...(groups.get(unit.key)??[]),unit]);
 return [...groups.values()].map(group=>{
  if(group.length===1)return group[0];
  const first=group[0];
  const same=<K extends keyof ConveniUnit>(field:K)=>group.every(u=>u[field]===first[field]);
  const compatible=same('recipient_nif')&&same('recipient_nature')&&same('year')&&same('joint')&&same('amount_state');
  // Several projects of one recipient that are all outside the portfolio are
  // one reviewable unit: amounts are added only when each one is documented.
  if(compatible&&group.every(u=>u.classification==='out_of_portfolio'))return outsideGroup(group);
  return {...first,concepts:group.map(u=>({...u,concepts:undefined})),mixed:true,amount_cents:null,service_code:null,service_name:null,
   classification:'insufficient_evidence',reason:null,social_assessment:undefined,
   recipient_nif:same('recipient_nif')?first.recipient_nif:null,recipient_nature:same('recipient_nature')?first.recipient_nature:'unknown',
   year:same('year')?first.year:null,joint:group.some(u=>u.joint),
   explanation:compatible
    ?'Hi ha diversos conceptes per al mateix receptor i període. Cal revisar-los i atribuir l’import i el servei sense sumar ni repartir automàticament.'
    :'Hi ha propostes per al mateix receptor i període amb NIF, naturalesa, anualitat o estat de l’import diferents. Poden ser conceptes diferents o una duplicació: cal revisar-les abans de sumar, descartar o repartir imports.',
   population:[...new Set(group.map(u=>u.population).filter(Boolean))].join(' · '),
   description:[...new Set(group.map(u=>u.description).filter(Boolean))].join(' · '),
   financiers:[...new Set(group.flatMap(u=>u.financiers))],territory:group.every(u=>u.territory===first.territory)?first.territory:null,
   evidence:group.flatMap(u=>u.evidence).filter((e,i,all)=>all.findIndex(other=>other.document_id===e.document_id&&other.page===e.page&&other.quote===e.quote)===i),
   blockers:[...new Set([...group.flatMap(u=>u.blockers),'mixed','missing_amount',...(compatible?[]:['duplicate'])])]};
 });
}
const euros=(value:number|null)=>value===null?'import no atribuït':`${(value/100).toLocaleString('ca-ES',{minimumFractionDigits:0,maximumFractionDigits:2})} €`;
function outsideGroup(group:ConveniUnit[]):ConveniUnit{
 const first=group[0];
 const known=group.every(u=>u.amount_cents!==null&&!u.mixed);
 const unique=(items:Citation[])=>items.filter((e,i,all)=>all.findIndex(other=>other.document_id===e.document_id&&other.page===e.page&&other.quote===e.quote)===i);
 const evidence=unique(group.flatMap(u=>u.evidence));
 return {...first,amount_cents:known?group.reduce((sum,u)=>sum+u.amount_cents!,0):null,mixed:!known,service_code:null,service_name:null,reason:null,
  explanation:`Projectes fora de la Cartera agrupats en una sola unitat: ${group.map(u=>`${u.description.trim()||u.explanation.trim()} (${euros(u.amount_cents)})`).join('; ')}.`,
  population:[...new Set(group.map(u=>u.population).filter(Boolean))].join(' · '),
  description:[...new Set(group.map(u=>u.description).filter(Boolean))].join(' · '),
  financiers:[...new Set(group.flatMap(u=>u.financiers))],territory:group.every(u=>u.territory===first.territory)?first.territory:null,evidence,
  social_assessment:first.social_assessment?{...first.social_assessment,evidence:unique(group.flatMap(u=>u.social_assessment?.evidence??[]))}:undefined,
  blockers:[...new Set([...group.flatMap(u=>u.blockers),...(known?[]:['mixed','missing_amount'])])]};
}
const CLASSIFICATION_VALUES=['in_portfolio','out_of_portfolio','discarded','insufficient_evidence'];
/** Only a response without the minimum structure, or without any verifiable
 * unit, is an error. Every other inconsistency degrades the affected unit to
 * a reviewable proposal (insufficient_evidence, original classification and a
 * diagnostic): one wrong field never hides the rest of the conveni. Valid
 * proposals keep exactly the same payload as before. */
export function validateConveni(input:ConveniAnalysis,payload:Payload,documents:DocumentEvidence[],eligibleCodes:Set<string>,options:{requireSemanticAssessment?:boolean}={}):ConveniAnalysis {
 if(!input||!Array.isArray(input.units)||!input.units.length||input.units.length>500||!Array.isArray(input.actors)||typeof input.summary!=='string'||typeof input.instrument_grant!=='boolean'||typeof input.coverage_complete!=='boolean')
  throw new ConveniValidationError({code:'CONVENI_RESPONSE_INCOMPLETE',message:'La resposta de la IA no té l’estructura mínima d’un conveni (unitats, actors, resum i cobertura). Cal tornar a analitzar-lo.'});
 const issues:ConveniDiagnostic[]=conveniCitationDiagnostics(input,documents);
 const missing=conveniMissingFieldDiagnostics(input.units);
 const keep=(items:Citation[]|undefined)=>Array.isArray(items)?items.filter(c=>validCitation(c,documents)):[];
 const actors=input.actors.flatMap((actor,index)=>{
  if(!actor||typeof actor!=='object'||!actor.name?.trim()){issues.push({code:'CONVENI_ACTOR_INVALID',message:`Actor ${index+1} sense nom: no es té en compte.`,field:'actors',index});return [];}
  const evidence=keep(actor.evidence);
  if(!evidence.length){issues.push({code:'CONVENI_ACTOR_UNVERIFIED',message:`L’actor ${actor.name} no té cap cita verificable: no s’utilitza per acreditar naturalesa ni rol.`,field:'actors',index,recipient:actor.name});return [];}
  return [{...actor,nature:['public','private','unknown'].includes(actor.nature)?actor.nature:'unknown' as const,
   roles:Array.isArray(actor.roles)?actor.roles.filter(r=>['signatory','recipient','provider','financier'].includes(r)):[],evidence}];
 });
 let degraded=issues.length>0;
 const individualUnits=input.units.flatMap((raw,index)=>{
  if(!raw||typeof raw!=='object'){issues.push({code:'INVALID_CONVENI_PROPOSAL',message:`La proposta ${index+1} no és vàlida i no es pot mostrar.`,field:'units',index});degraded=true;return [];}
  const unitMissing=missing.filter(m=>m.index===index);
  if(!raw.recipient?.trim()||!raw.period?.trim()){issues.push(...unitMissing.filter(m=>m.field==='recipient'||m.field==='period'),{code:'CONVENI_UNIT_IDENTITY_MISSING',message:`La proposta ${index+1} no identifica receptor i període: no es pot mostrar com a unitat i cal revisar el document.`,field:'units',index});degraded=true;return [];}
  const evidence=keep(raw.evidence);
  if(!evidence.length){issues.push({code:'CONVENI_UNIT_UNVERIFIED_EVIDENCE',message:`La proposta per a ${raw.recipient} (${raw.period}) no té cap cita verificable al document: no es pot mostrar com a unitat i cal revisar-ne l’import.`,field:'units',index,recipient:raw.recipient,period:raw.period});degraded=true;return [];}
  const u:ConveniUnit={...raw,evidence};
  const changed=evidence.length!==raw.evidence.length;
  const note=(code:string,message:string,field?:string)=>{issues.push({code,message,field,index,recipient:u.recipient});degraded=true;};
  const degrade=(code:string,message:string,field?:string)=>{
   note(code,message,field);
   if(u.original_classification===undefined)u.original_classification=u.classification;
   u.classification='insufficient_evidence';u.service_code=null;u.service_name=null;u.reason=null;
  };
  if(changed)degraded=true;
  if(!CLASSIFICATION_VALUES.includes(u.classification))degrade('CONVENI_CLASSIFICATION_INVALID','La classificació proposada no és vàlida.','classification');
  if(!['planned','conditional','confirmed'].includes(u.amount_state)){u.amount_state='planned';note('CONVENI_AMOUNT_STATE_INVALID','L’estat de l’import no és vàlid; es tracta com a previst.','amount_state');}
  if(!['public','private','unknown'].includes(u.recipient_nature)){u.recipient_nature='unknown';note('CONVENI_RECIPIENT_NATURE_INVALID','La naturalesa del receptor no és vàlida; queda pendent.','recipient_nature');}
  if(typeof u.joint!=='boolean'){u.joint=false;note('CONVENI_JOINT_INVALID','No s’ha indicat si l’import és conjunt.','joint');}
  if(typeof u.mixed!=='boolean'){u.mixed=true;note('CONVENI_MIXED_INVALID','No s’ha indicat si l’import és mixt; es tracta com a mixt.','mixed');}
  if(!Array.isArray(u.financiers))u.financiers=[];
  if(u.amount_cents!==null&&(!Number.isSafeInteger(u.amount_cents)||u.amount_cents<0)){u.amount_cents=null;note('CONVENI_AMOUNT_INVALID','L’import proposat no és vàlid; queda pendent.','amount_cents');}
  if(u.year!==null&&(!Number.isInteger(u.year)||u.year<1900||u.year>2200)){u.year=null;note('CONVENI_YEAR_INVALID','L’anualitat proposada no és vàlida; queda pendent.','year');}
  if(!u.explanation?.trim())degrade('CONVENI_EXPLANATION_MISSING','La proposta no explica la classificació; cal revisar-la al document.','explanation');
  const assessment=u.social_assessment;
  if(assessment){
   const assessmentEvidence=keep(assessment.evidence);
   if(!['social','non_social','uncertain'].includes(assessment.status)||!assessment.explanation?.trim()||!assessmentEvidence.length){
    u.social_assessment={status:'uncertain',explanation:assessment.explanation?.trim()||'Valoració social sense explicació verificable.',evidence:assessmentEvidence.length?assessmentEvidence:evidence};
    note('CONVENI_SOCIAL_ASSESSMENT_UNVERIFIED','La valoració de la naturalesa social no té evidència verificable; queda pendent.','social_assessment');
   }else if(assessmentEvidence.length!==assessment.evidence.length)u.social_assessment={...assessment,evidence:assessmentEvidence};
  }
  if(options.requireSemanticAssessment&&!u.social_assessment&&['in_portfolio','out_of_portfolio'].includes(u.classification))degrade('CONVENI_SOCIAL_ASSESSMENT_MISSING','Falta acreditar explícitament la naturalesa social del servei.','social_assessment');
  const social=u.social_assessment?.status;
  if(['in_portfolio','out_of_portfolio'].includes(u.classification)&&social&&social!=='social')degrade('CONVENI_SOCIAL_CLASSIFICATION_CONFLICT','Classificació positiva incompatible amb la valoració social: queda com a proposta pendent de revisió, sense canviar-ne la categoria automàticament.','social_assessment.status');
  if(u.classification==='discarded'){
   const reason=u.reason?.trim().toLowerCase()??'';
   const missingDiscard=missingDiscardDiagnostic(u.reason);
   // Lack of catalog fit is not a scope exclusion: with a documented social
   // service and population it is an outside-the-portfolio proposal.
   if(reason==='service_not_in_catalog'){
    if(social==='social'&&u.population?.trim()&&u.description?.trim()){u.original_classification='discarded';u.classification='out_of_portfolio';u.reason=null;
     note('CONVENI_DISCARD_REASON_CONFLICT','La manca d’encaix en la cartera no és un motiu de descart: amb servei social i població documentats es proposa «Fora de cartera».','reason');}
    else degrade('CONVENI_DISCARD_REASON_CONFLICT','La manca d’encaix en la cartera no justifica per si sola un descart. Cal revisar la naturalesa social i el motiu documentat.','reason');
   }
   // An amendment that brings public funding to a non-public recipient is a
   // record of its own (Sprint 2, casuistry 6), as in the scope rule: it is not
   // discarded and its service still has to be classified.
   else if(reason==='excluded_amendment'&&u.recipient_nature!=='public'&&(normalizeConveni(payload).publicCents??1)!==0)
    degrade('CONVENI_FUNDED_AMENDMENT','Addenda, pròrroga o modificació amb aportació pública a una entitat no pública: és un registre propi i no es descarta. Cal classificar el servei que finança.','reason');
   else if(!reason)degrade('CONVENI_DISCARD_REASON_MISSING','La proposta de descart no indica cap motiu.','reason');
   else if(missingDiscard)degrade(missingDiscard.code,missingDiscard.message,'reason');
  }
  if(u.unresolved_service_ref!==undefined){
   const message=`La fitxa indicada per la IA${u.unresolved_service_ref?` («${u.unresolved_service_ref}»)`:''} no és al catàleg oficial vigent; no es conserva cap codi.`;
   if(u.classification==='in_portfolio')degrade('CONVENI_UNKNOWN_SERVICE_REFERENCE',`${message} Queda pendent de revisió.`,'service_ref');else note('CONVENI_UNKNOWN_SERVICE_REFERENCE',message,'service_ref');
  }
  if(u.classification==='in_portfolio'&&(!u.service_code||!eligibleCodes.has(u.service_code)||!u.population?.trim()||!u.description?.trim()))degrade('CONVENI_SERVICE_UNVERIFIED','La proposta en cartera no acredita una fitxa elegible, la població i la descripció del servei.','service_code');
  if(u.classification!=='in_portfolio'&&u.service_code!==null&&u.service_code!==undefined){u.service_code=null;u.service_name=null;note('CONVENI_CODE_CLASSIFICATION_CONFLICT','La proposta indicava un codi de servei incompatible amb la seva classificació; no es conserva.','service_code');}
  if(u.classification==='out_of_portfolio'&&(!u.population?.trim()||!u.description?.trim()))degrade('CONVENI_OUTSIDE_FACTS_MISSING','«Fora de cartera» requereix descriure el servei social i la població; queda pendent.','population');
  if(u.original_classification!==undefined)issues.push(...unitMissing);
  const key=unitKey(u.recipient,u.period);
  const blockers:string[]=[];
  if(u.joint)blockers.push('joint');if(u.mixed)blockers.push('mixed');
  if(u.recipient_nature==='unknown'||(u.recipient_nature==='private'&&!documentedPrivateRecipient(u,actors)))blockers.push('unknown_recipient');if(u.recipient_nature==='public')blockers.push('public_recipient');
  if(!u.recipient_nif)blockers.push('missing_nif');else if(!/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(u.recipient_nif))blockers.push('invalid_nif');
  else if(u.recipient_nature==='private'&&!u.joint&&!recipientIdentityCited(u,actors))blockers.push('unverified_identity');
  if(u.amount_cents===null)blockers.push('missing_amount');
  if(!input.coverage_complete)blockers.push('incomplete');
  return [{...u,key,blockers}];
 });
 if(!individualUnits.length)throw new ConveniValidationError({code:'CONVENI_NO_VERIFIABLE_UNIT',message:'Cap proposta de la IA té receptor, període i una cita verificable al document. Cal revisar l’extracció del document o tornar a analitzar-lo.',field:'units'},[...issues,...conveniFundingDiagnostics(input,payload)]);
 let units=groupConveniConcepts(individualUnits);
 // A total and its annual children must never coexist as economic units:
 // keep the documented annualities and report the total.
 for(const name of new Set(units.map(u=>normalize(u.recipient)))){
  const own=units.filter(u=>normalize(u.recipient)===name);
  if(own.some(u=>u.year===null)&&own.some(u=>u.year!==null)){
   units=units.filter(u=>!(normalize(u.recipient)===name&&u.year===null));degraded=true;
   issues.push({code:'CONVENI_TOTAL_AND_ANNUALITIES',message:`La proposta per a ${own[0].recipient} incloïa el total i les anualitats; es conserven les anualitats documentades i el total no es mostra com a unitat.`,field:'units',recipient:own[0].recipient});
  }
  if(new Set(own.map(u=>u.service_code).filter(Boolean)).size>1)own.forEach(u=>u.blockers.push('multiple_services'));
 }
 let unallocated=input.unallocated_cents;
 if(unallocated!==null&&(!Number.isSafeInteger(unallocated)||unallocated<0)){unallocated=null;degraded=true;issues.push({code:'CONVENI_UNALLOCATED_INVALID',message:'El romanent no assignat proposat no és vàlid; queda pendent.',field:'unallocated_cents'});}
 const reconciled=conveniFundingDiagnostics({...input,unallocated_cents:unallocated,units},payload).length===0;
 if(!reconciled)units.forEach(u=>u.blockers.push('reconciliation'));
 const collisions=conveniUnitCollisions(input.units);
 // Do not change persisted payloads for proposals that were already valid:
 // exact historical replays compare JSON, and have no reducer-version fence.
 const diagnostics=collisions.length||degraded?[...issues,...collisions,...conveniFundingDiagnostics({...input,unallocated_cents:unallocated},payload)]:[];
 return {...input,...(degraded?{actors,unallocated_cents:unallocated}:{}),units,normalization_version:CONVENI_NORMALIZATION_VERSION,...(diagnostics.length?{diagnostics}: {})};
}

/** AOC codes are 10 digits; Excel numeric cells may have lost the initial zero. */
export const aocLookupKey=(code:string)=>/^\d{9,10}$/.test(code.trim())?code.trim().padStart(10,'0'):code.trim();
