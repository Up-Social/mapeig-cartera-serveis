import type {AnalysisOutput} from './analysis-contract';
export const SCOPE_RULES_VERSION='evidence-roles-v4';
export const MODEL_DISCARD_POLICY_VERSION='model-discard-review-v2';
export const ROLE_NAMES=['financed_object','financier','economic_recipient','direct_beneficiary','service_provider','final_population','final_service','financial_instrument'] as const;
export type RoleName=typeof ROLE_NAMES[number];
export type RoleFact={value:string|null;state:'known'|'unknown'|'contradictory';kind:string;evidence_ordinals:number[];quotes:string[]};
export type RoleFacts=Record<RoleName,RoleFact>;
export type RoleAccreditation={kind:string;evidence_ordinals:number[];basis:'official_service_code_and_description'};
export type RoleAccreditations=Partial<Record<RoleName,RoleAccreditation>>;
export const ROLE_INSTRUCTIONS='A scope_facts.roles diferencia objecte finançat, finançador, receptor econòmic, beneficiari directe, prestador i població final. Final_service.kind és yes/no/unknown; financial_instrument.kind és direct_grant/interadministrative_transfer/service_financing/other/unknown; els rols d’actors usen administration/entity/person/population/other/unknown. Cada fet known ha de tenir value, ordinals i cites literals dels fragments. Marca unknown o contradictory quan no es pugui acreditar. No dedueixis cap rol només pel nom d’una entitat.';
export const roleFactsSchema={type:'object',additionalProperties:false,required:[...ROLE_NAMES],properties:Object.fromEntries(ROLE_NAMES.map(name=>[name,{type:'object',additionalProperties:false,required:['value','state','kind','evidence_ordinals','quotes'],properties:{value:{anyOf:[{type:'string'},{type:'null'}]},state:{type:'string',enum:['known','unknown','contradictory']},kind:{type:'string',enum:['administration','entity','person','population','yes','no','direct_grant','interadministrative_transfer','service_financing','other','unknown']},evidence_ordinals:{type:'array',items:{type:'integer',minimum:1}},quotes:{type:'array',items:{type:'string'}}}}]))};
export function hasLiteralRoleEvidence(f:RoleFact|undefined,chunks:ReadonlyArray<{content:string}>):boolean{
 const normalized=(value:string)=>value.replace(/\s+/g,' ').trim();
 const literal=(quote:string,ordinals:number[])=>{const exact=normalized(quote);const peripheral=exact.replace(/^(?:\.{3}|…)+\s*/,'').replace(/\s*(?:\.{3}|…)+$/,'').trim();const withoutTerminalPunctuation=peripheral.replace(/[.;:!?]+$/,'').trim();return withoutTerminalPunctuation.length>=12&&ordinals.some(n=>{const content=normalized(chunks[n-1]?.content??'');return content.includes(exact)||content.includes(peripheral)||content.includes(withoutTerminalPunctuation);});};
 return !!f&&f.state==='known'&&f.kind!=='unknown'&&!!f.value?.trim()&&Array.isArray(f.evidence_ordinals)&&f.evidence_ordinals.length>0&&f.evidence_ordinals.every(n=>Number.isInteger(n)&&n>0&&n<=chunks.length)&&Array.isArray(f.quotes)&&f.quotes.length>0&&f.quotes.every(q=>q.trim().length>0&&literal(q,f.evidence_ordinals));
}
const ACTOR_ROLES:ReadonlySet<RoleName>=new Set(['financier','economic_recipient','direct_beneficiary','service_provider']);
/** An explicit identifier in an actor's value must occur in the cited passage.
 * This binds only the identifier, not the actor's role or the meaning of the quote. */
function explicitTaxIdentifiers(value:string):string[]{
 const pattern=/(?<![\p{L}\p{N}])(?:[ABCDEFGHJNPQRSUVWXYZ][ .-]?(?:\d{7}|\d\.\d{3}\.\d{3})[ .-]?[A-Z0-9]|(?:\d{8}|\d{2}\.\d{3}\.\d{3})[ .-]?[A-Z])(?![\p{L}\p{N}])/giu;
 return [...new Set([...value.matchAll(pattern)].map(match=>match[0].replace(/[ .-]/g,'').toUpperCase()))];
}
export function hasRoleEvidence(name:RoleName,f:RoleFact|undefined,chunks:ReadonlyArray<{content:string}>):boolean{
 if(!hasLiteralRoleEvidence(f,chunks))return false;
 if(!ACTOR_ROLES.has(name))return true;
 const identifiers=explicitTaxIdentifiers(f!.value!);
 if(!identifiers.length)return true;
 const cited=new Set(f!.quotes.flatMap(explicitTaxIdentifiers));
 return identifiers.every(identifier=>cited.has(identifier));
}
export function applyScopeRules(original:AnalysisOutput,roles:Partial<RoleFacts>|undefined,chunks:{content:string}[],accreditations:RoleAccreditations={}){
 const literalKnown=(name:RoleName)=>hasRoleEvidence(name,roles?.[name],chunks);
 const accredited=(name:RoleName)=>{const f=roles?.[name],a=accreditations[name];return f?.state!=='contradictory'&&!!a&&a.kind!=='unknown'&&Array.isArray(a.evidence_ordinals)&&a.evidence_ordinals.length>0&&a.evidence_ordinals.every(n=>Number.isInteger(n)&&n>0&&n<=chunks.length);};
 const known=(name:RoleName)=>literalKnown(name)||accredited(name);
 const kind=(name:RoleName)=>literalKnown(name)?roles![name]!.kind:accredited(name)?accreditations[name]!.kind:'unknown';
 const evidenceFor=(name:RoleName)=>literalKnown(name)?roles![name]!.evidence_ordinals:accredited(name)?accreditations[name]!.evidence_ordinals:[];
 let rule='retain_model';let reason:string|undefined;
 if(kind('financier')==='administration'&&kind('economic_recipient')==='administration'&&kind('final_service')==='no'&&kind('financial_instrument')==='interadministrative_transfer'){rule='interadministrative_transfer';reason=rule;}
 else if(kind('economic_recipient')==='person'&&kind('direct_beneficiary')==='person'&&kind('financial_instrument')==='direct_grant'){rule='individual_grant';reason=rule;}
 const determinant:RoleName[]=original.classification==='discarded'
  ? original.reasons.includes('interadministrative_transfer')?['financier','economic_recipient','final_service','financial_instrument']
   :original.reasons.includes('individual_grant')?['economic_recipient','direct_beneficiary','financial_instrument']
   :['financed_object','direct_beneficiary','final_service']
  :original.classification==='insufficient_evidence'?[]:['financed_object','final_population','final_service'];
 if(reason)rule='role_discard_requires_review';
 else if(determinant.some(n=>!known(n)))rule='unknown_determinant_role';
 else if(!reason&&original.classification==='discarded')rule='model_discard_requires_review';
 const blocked_roles=determinant.filter(n=>!known(n)).map(role=>({role,reason:roles?.[role]?.state==='contradictory'?'contradictory':roles?.[role]?.state!=='known'?'missing_fact':'unverifiable_quote'}));
 const used=reason==='interadministrative_transfer'?['financier','economic_recipient','final_service','financial_instrument'] as RoleName[]:reason==='individual_grant'?['economic_recipient','direct_beneficiary','financial_instrument'] as RoleName[]:determinant;
 const evidence=[...new Set(used.flatMap(evidenceFor))];
 // The original ordinals are context, not proof of a missing fact or of the
 // model's proposed exclusion. Preserve them for review when valid.
 const reviewEvidence=[...new Set([...evidence,...original.evidence_ordinals.filter(n=>Number.isInteger(n)&&n>0&&n<=chunks.length)])];
 const result:AnalysisOutput=reason?{...original,classification:'insufficient_evidence',reasons:[],candidates:[],evidence_ordinals:reviewEvidence,explanation:reason==='individual_grant'?'Els rols proposen una possible ajuda directa individual. Cal contrastar les cites i la relació entre les persones abans de decidir el descart.':'Els rols proposen una possible transferència entre administracions sense servei final. Cal contrastar les cites i els rols abans de decidir el descart.'}:rule==='unknown_determinant_role'?{...original,classification:'insufficient_evidence',reasons:[],candidates:[],evidence_ordinals:reviewEvidence,explanation:'No s’han pogut acreditar tots els rols determinants o hi ha contradiccions. Cal completar la documentació abans de classificar.'}:rule==='model_discard_requires_review'?{...original,classification:'insufficient_evidence',reasons:[],candidates:[],evidence_ordinals:reviewEvidence,explanation:'La proposta de descart necessita revisió. Consulta les fonts i les dades pendents abans de decidir.'}:original;
 return {...result,rule_audit:{version:SCOPE_RULES_VERSION,discard_policy:MODEL_DISCARD_POLICY_VERSION,rule,proposed_discard_reason:reason??null,blocked_roles,roles:roles??null,accredited_roles:Object.keys(accreditations).length?accreditations:null,evidence_ordinals:evidence},model_conclusion:original};
}

/** Role-derived Concert exclusions previously reached the discard receipt
 * fence. Keep that fence even while their classification remains pending. */
export function requiresConcertScopeDiscardFence(financingType:string,result:{classification:string;rule_audit?:{rule?:unknown}}):boolean {
 return financingType==='concert'&&(result.classification==='discarded'||result.rule_audit?.rule==='role_discard_requires_review');
}
