import type {AnalysisOutput,CandidateOutput} from './analysis-contract';
import type {OfficialService} from './official-catalog';

function normalized(value:string){return value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('ca').replace(/[^a-z0-9]+/g,' ').trim();}
function words(value:string){return normalized(value).split(/\s+/).filter(Boolean);}
function hasCode(value:string,code:string){const escaped=code.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp(`(^|[^0-9.])${escaped}(?![0-9]|\\.[0-9])`).test(value);}
function describes(service:OfficialService,value:string){
 const haystack=new Set(words(value));
 const tokens=[...new Set(words(service.service_name).filter(token=>token.length>=4))];
 const required=Math.min(5,Math.max(2,Math.ceil(tokens.length*.55)));
 return tokens.filter(token=>haystack.has(token)).length>=required;
}
function mentioned(name:string,description:string){
 const tokens=words(name);
 if(!tokens.some(token=>token.length>=8))return false;
 const pattern=tokens.map(token=>`${token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}s?`).join('(?:\\s+|.{1,18})');
 return new RegExp(pattern,'i').test(normalized(description));
}
export function findExplicitServiceEvidence(eligible:OfficialService[],chunks:Array<{content:string}>){
 return eligible.flatMap(service=>{
  const ordinals=chunks.flatMap((chunk,index)=>hasCode(chunk.content,service.service_code)&&describes(service,chunk.content)?[index+1]:[]);
  return ordinals.length?[{service,ordinals}]:[];
 }).sort((a,b)=>a.ordinals[0]-b.ordinals[0]||a.service.service_code.localeCompare(b.service.service_code));
}
/** Detection changes ordering, never the set of admissible services. */
export function prioritizeExplicitServices(eligible:OfficialService[],explicit:Array<{service:OfficialService}>):OfficialService[]{
 const detected=new Set(explicit.map(item=>item.service.service_code));
 return [...eligible.filter(service=>detected.has(service.service_code)),...eligible.filter(service=>!detected.has(service.service_code))];
}
export function bindExplicitCodeCandidates<T extends AnalysisOutput>(value:T,eligible:OfficialService[],chunks:Array<{content:string}>):T{
 if(value.classification!=='in_portfolio')return value;
 const explicit=findExplicitServiceEvidence(eligible,chunks).slice(0,3);
 if(!explicit.length)return value;
 const existing=new Map(value.candidates.map(candidate=>[candidate.code,candidate]));
 const cited=explicit.map(({service,ordinals})=>{
  const candidate=existing.get(service.service_code);
  return {code:service.service_code,score:candidate?.score??1,population_compatible:true,legal_reference:service.legal_reference,evidence_ordinals:ordinals,rationale:candidate?.rationale??'El document oficial identifica el codi i la descripció del servei. La correspondència resta sotmesa a l’auditoria normativa independent.',evidence_explanation:`El fragment oficial identifica el codi ${service.service_code} i descriu ${service.service_name}.`};
 });
 const citedCodes=new Set(cited.map(candidate=>candidate.code));
 // Retain a separately documented model proposal when its complete official
 // name appears in its own cited fragment. It still requires positive audit.
 const others=value.candidates.filter(candidate=>{
  if(citedCodes.has(candidate.code))return false;
  const service=eligible.find(item=>item.service_code===candidate.code);
  return !!service&&candidate.evidence_ordinals.some(ordinal=>mentioned(service.service_name,chunks[ordinal-1]?.content??''));
 });
 const candidates=[...cited,...others].slice(0,3);
 return {...value,candidates,evidence_ordinals:[...new Set(candidates.flatMap(item=>item.evidence_ordinals))],explanation:`El document oficial identifica explícitament ${cited.map(candidate=>`${candidate.code} · ${eligible.find(service=>service.service_code===candidate.code)!.service_name}`).join('; ')}.${candidates.length>cited.length?' Altres propostes amb nom documentat requereixen comprovació específica.':''}`};
}
export function addNamedCandidates<T extends AnalysisOutput>(value:T,eligible:OfficialService[],chunks:Array<{content:string}>):T{
 if(value.classification!=='in_portfolio')return value;
 const existing=new Set(value.candidates.map(candidate=>candidate.code));
 const additions:CandidateOutput[]=[];
 for(const service of eligible){
  if(existing.has(service.service_code)||!mentioned(service.service_name,value.service_description))continue;
  const ordinal=chunks.findIndex(chunk=>mentioned(service.service_name,chunk.content));
  if(ordinal<0)continue;
  additions.push({code:service.service_code,score:1,population_compatible:true,legal_reference:service.legal_reference,evidence_ordinals:[ordinal+1],rationale:`Candidat nominal detectat al servei descrit i al fragment oficial. La compatibilitat final resta sotmesa a l'auditoria normativa independent.`,evidence_explanation:`El fragment oficial identifica nominalment ${service.service_name}.`});
 }
 if(!additions.length)return value;
 const candidates=[...additions,...value.candidates].filter((candidate,index,all)=>all.findIndex(other=>other.code===candidate.code)===index).slice(0,3);
 return {...value,candidates};
}
/** A Concert fragment that literally names the official service identifies its
 * type and population. Individual access conditions (age, guardianship, degree)
 * are never accredited per user, so they cannot drop that candidate before the
 * independent positive audit. */
export function keepOfficiallyNamedCandidates<T extends AnalysisOutput>(value:T,eligible:OfficialService[],chunks:Array<{content:string}>):T{
 if(value.classification!=='in_portfolio'||!Array.isArray(value.candidates))return value;
 const candidates=value.candidates.map(candidate=>{
  if(candidate.population_compatible)return candidate;
  const service=eligible.find(item=>item.service_code===candidate.code);
  if(!service||!Array.isArray(candidate.evidence_ordinals)||!candidate.evidence_ordinals.some(ordinal=>mentioned(service.service_name,chunks[ordinal-1]?.content??'')))return candidate;
  return {...candidate,population_compatible:true,evidence_explanation:`${candidate.evidence_explanation} El fragment cita el nom oficial del servei; les condicions individuals d’accés no s’acrediten per persona usuària i resten sotmeses a l’auditoria normativa i a la revisió humana.`};
 });
 return {...value,candidates};
}
