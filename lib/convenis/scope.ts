import {screenRecord,type ScopeInput,type ScopeProposal,type ScopeRule} from '../scope-screening';
import {EXCLUSION_LABELS,normalize,normalizeConveni} from './contract';

/** Ordered Conveni scope rules (Sprint 2, levels 2–3). Title and zero-funding
 * rules keep their historical automatic behaviour. Signatory rules only
 * propose a discard: the Excel column may be incomplete, so a person confirms. */
export const CONVENI_SCOPE_VERSION='conveni-scope-v2';

const article=/^(?:l |el |la |els |les |excm[ao]? |il lm[ao]? )+/;
const PUBLIC_BODY=[
 /^ajuntament\b/,/^consell (?:comarcal|insular)\b/,/^diputacio\b/,/^generalitat\b/,/^departament\b/,/^ministeri\b/,/^govern\b/,
 /^consorci\b/,/^mancomunitat\b/,/^area metropolitana\b/,/^entitat (?:municipal|metropolitana)\b/,
 /^institut (?:municipal|comarcal|catala)\b/,/^patronat (?:municipal|comarcal)\b/,/^organisme autonom\b/,/^agencia (?:catalana|de salut publica)\b/,
 /^servei catala\b/,/^fundacio publica\b/,/^(?:empresa|societat) municipal\b/,/^col legi oficial\b/,
 /^universitat (?!ramon llull|abat oliba|internacional de catalunya|de vic|oberta de catalunya)/,
 ];
// Instrumental public entities named in the Sprint 2 definition, even with a company suffix.
const KNOWN_PUBLIC=[/^sumar\b/,/\bgesat\b/,/^badalona serveis assistencials\b/];
// A private-looking party anywhere in the row keeps the case for documentary analysis.
const PRIVATE_MARKER=/\b(?:fundacio(?! publica)|fundacion|associacio|asociacion|entitat|entidad|caritas|creu roja|cruz roja|cooperativa|federacio|club|ampa|afa|parroquia|congregacio|germanes|germans|hermanitas|diocesana?|bisbat|ong|obra social|esplai|s (?:l|a)(?: u)?)\b/;

export const isPublicBodyName=(name:string)=>{const n=normalize(name).replace(article,'');return !!n&&(KNOWN_PUBLIC.some(p=>p.test(n))||!PRIVATE_MARKER.test(n)&&PUBLIC_BODY.some(p=>p.test(n)));};
const hasPrivateMarker=(value:string)=>PRIVATE_MARKER.test(normalize(value));
const TITLE_AMENDMENT=[/^(?:(?:primera|segona|tercera|quarta|cinquena|sisena|setena|vuitena|novena|desena|\d+(?:a|na|n|r)?) )?(?:addenda|adenda|prorroga|modificacio)\b/,/^conveni (?:de )?(?:prorroga|modificacio)\b|^adhesio a la (?:(?:primera|segona|tercera) )?addenda\b/];
const TITLE_INTERADMINISTRATIVE=/^(?:[ivxlcdm]+ )?conveni (?:marc )?(?:(?:de )?col laboracio )?interadministratiu\b|^(?:[ivxlcdm]+ )?conveni (?:marc )?de (?:col laboracio(?: i cooperacio)?|cooperacio) interadministrativa\b/;
const signatoryCaveat='La columna de l’Excel pot ser incompleta: confirma al document que no hi signa cap entitat privada abans de descartar-lo.';

/** No private-looking party in the title or in the public signatory columns. */
function onlyPublicParties({title,payload}:ScopeInput){
 const n=normalizeConveni(payload);
 return !hasPrivateMarker(title)&&!n.publicSignatories.some(name=>name.split(';').some(hasPrivateMarker));
}
export const CONVENI_SCOPE_RULES:readonly ScopeRule[]=[
 // An amendment that brings public funding to a private signatory is a record
 // of its own (Sprint 2, casuistry 6): only exclude amendments without one.
 {id:'excluded_amendment',mode:'auto',evaluate:({title,payload})=>{
  if(!TITLE_AMENDMENT.some(p=>p.test(normalize(title))))return null;
  const n=normalizeConveni(payload);
  if(n.signatoriesState==='listed'&&!n.signatories.every(isPublicBodyName)&&n.publicCents!==0)return null;
  return {reason:'excluded_amendment',label:EXCLUSION_LABELS.excluded_amendment,explanation:'Addenda, pròrroga o modificació d’un conveni sense entitat privada amb aportació pública: no crea un registre nou. No implica que no sigui un servei social.'};
 }},
 {id:'interadministrative_agreement',mode:'auto',evaluate:({title})=>TITLE_INTERADMINISTRATIVE.test(normalize(title))?{reason:'interadministrative_agreement',label:EXCLUSION_LABELS.interadministrative_agreement,explanation:'El títol identifica inequívocament un conveni interadministratiu.'}:null},
 {id:'no_public_funding',mode:'auto',evaluate:({payload})=>{
  const n=normalizeConveni(payload);if(n.publicCents!==0)return null;
  return {reason:'no_public_funding',label:EXCLUSION_LABELS.no_public_funding,explanation:(n.otherCents??0)>0
   ?'La suma de les aportacions previstes de Generalitat i ens locals és zero i només hi aporten altres organismes (flux invers): no hi ha finançament públic a una entitat.'
   :'La suma de les aportacions previstes de Generalitat i ens locals és zero. No s’infereix la direcció del flux.'};
 }},
 {id:'interadministrative_signatories',mode:'proposal',evaluate:input=>{
  const n=normalizeConveni(input.payload);
  if(n.signatoriesState!=='unknown'||!onlyPublicParties(input))return null;
  return {reason:'interadministrative_agreement',label:'Proposta: conveni interadministratiu',explanation:`La columna «Altres Organismes Signants» de l’Excel és buida: només hi consten organismes públics signants${n.publicSignatories.length?` (${n.publicSignatories.join('; ')})`:''}. Es proposa descartar-lo com a conveni interadministratiu sense llegir el document. ${signatoryCaveat}`};
 }},
 {id:'interadministrative_public_others',mode:'proposal',evaluate:input=>{
  const n=normalizeConveni(input.payload);
  if(n.signatoriesState!=='listed'||!onlyPublicParties(input)||!n.signatories.every(isPublicBodyName))return null;
  return {reason:'interadministrative_agreement',label:'Proposta: conveni interadministratiu',explanation:`Tots els signants de «Altres Organismes Signants» (${n.signatories.join('; ')}) s’identifiquen com a organismes públics. Es proposa descartar-lo com a conveni interadministratiu sense llegir el document. ${signatoryCaveat}`};
 }},
];
export const screenConveniScope=(title:string,payload:Record<string,unknown>):ScopeProposal|null=>screenRecord(CONVENI_SCOPE_RULES,CONVENI_SCOPE_VERSION,{title:title??'',payload:payload??{}});
export const screenConveni=screenConveniScope;
export const isConveniScopeProposal=(rule:unknown)=>CONVENI_SCOPE_RULES.some(r=>r.id===rule&&r.mode==='proposal');
