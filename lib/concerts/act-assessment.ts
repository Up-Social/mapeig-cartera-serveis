/** Conservative triage of a publication. This never creates financial rows. */
export type ConcertCase = 1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18;
export type ConcertEffect = 'none'|'possible_award'|'possible_reduction'|'possible_delta'|'possible_new_period'|'possible_correction'|'possible_maximum'|'possible_allocation'|'provisional';
export type ConcertAssessment = {
  primaryCase: ConcertCase|null;
  overlappingCases: ConcertCase[];
  effect: ConcertEffect;
  source: 'document'|'title'|'missing';
  reason: string;
  requiresReview: true;
};

export const CONCERT_CASE_LABELS:Record<ConcertCase,string>={
  1:'Denegació',2:'Cessament, minoració o resolució anticipada',3:'Modificació',
  4:'Proposta o acord previ',5:'Convocatòria',6:'Recurs',7:'Rectificació o esmena',
  8:'Títol genèric',9:'Places desertes',10:'Expedient territorial',
  11:'Concert i gestió delegada',12:'Pròrroga de programa',13:'Provisió d’emergència',
  14:'Òrgan finançador diferent',15:'Autorització de despesa',16:'Import plurianual',
  17:'Cessió',18:'Convalidació',
};

function normalize(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');}
const has=(value:string,re:RegExp)=>re.test(value);

/** A candidate only: the document, counterpart and economic basis still need human review. */
export function assessConcertAct(title:string, documentText?:string|null):ConcertAssessment {
  const t=normalize(title);
  const document=normalize(documentText??'');
  // Operative clauses describe the decision. Legal background, appeal rights and
  // annex labels can mention other act types without making this one of them.
  const resolc=document.search(/\bresolc\s*:/);
  const operative=resolc>=0?document.slice(resolc+document.slice(resolc).indexOf(':')+1).slice(0,1100):document;
  const firstAct=operative.split(/\b2\.\s/)[0].split(/\bd.acord amb\b/)[0];
  const text=firstAct?`${t} ${firstAct}`:t;
  const attributes=firstAct?`${t} ${firstAct}`:t;
  const source=document?'document':t?'title':'missing';
  const overlappingCases:ConcertCase[]=[];
  if(has(attributes,/\b(barcelona|lleida|girona|tarragona|terres de l.ebre)\b/) && has(attributes,/\b(exp\.|expedient|servei territorial)\b/))overlappingCases.push(10);
  if(has(attributes,/concert social/) && has(attributes,/gestio delegada/))overlappingCases.push(11);
  if(has(attributes,/consorci de serveis socials|igualtat i feminismes|\bife\//))overlappingCases.push(14);
  if(has(attributes,/\b(20\d{2})\s*[-–]\s*20\d{2}\b|import total plurianual|anualitats/))overlappingCases.push(16);
  const genericTitle=has(t,/resolucio de l.expedient|resolucio de l.expedient|^expedient[: ]/);
  if(genericTitle)overlappingCases.push(8);
  let primaryCase:ConcertCase|null=null;
  let effect:ConcertEffect='none';
  let reason='No es pot establir l’efecte econòmic sense llegir el document i les seves línies.';
  if(has(text,/convalidaci[oó]|es convalida/)){primaryCase=18;reason='La convalidació remet a un acte anterior: cal comprovar si canvia cap dada.';}
  else if(has(text,/cessio del|cessio de|traspas a una altra entitat/)){primaryCase=17;reason='La cessió canvia el prestador; no acredita per si sola més finançament.';}
  else if(has(text,/rectificaci|esmena d|correccio d.errors/)){primaryCase=7;effect='possible_correction';reason='Cal vincular l’acte corregit i comparar camps abans de recalcular.';}
  else if(has(text,/recurs de reposicio|resolucio del recurs/)){primaryCase=6;effect=has(text,/s.estima|estima el recurs|estimar el recurs/) && has(text,/adjudic|atorg|provisio/) ? 'possible_award':has(text,/s.estima|estima el recurs/)?'possible_correction':'none';reason='El recurs només genera nova adjudicació si el resolc la concedeix; si rectifica, cal revisar l’acte original.';}
  else if(has(text,/denegaci|denegar|places denegades|es denega/)){primaryCase=1;reason='La denegació no genera una nova provisió.';}
  else if(has(text,/cessament|minora(cio|cio)|resolucio anticipada|extincio anticipada/)){primaryCase=2;effect='possible_reduction';reason='La reducció requereix l’acord original, el període i l’import acreditat.';}
  else if(has(text,/proposta de resolucio|acord proposta|acord de proposta|acord del comite de provisio/)){primaryCase=4;effect='provisional';reason='Cal buscar una resolució definitiva abans de considerar cap provisional.';}
  else if(has(text,/convocatoria/) && !has(text,/adjudic|prorrog|provisio directa/)){primaryCase=5;reason='La convocatòria és una referència, sense adjudicació.';}
  else if(has(text,/places desertes|places desertes|places vacants/)){primaryCase=9;effect=has(text,/adjudic|atorga|proveir a favor/)?'possible_award':'none';reason='Cal comprovar si el resolc adjudica les places o només les declara desertes.';}
  else if(has(text,/\bprorrog(?:a|ues|ar|uem)\b/)){primaryCase=12;effect='possible_new_period';reason='La pròrroga pot comprometre un període nou; cal llegir DA, annex i acord base.';}
  else if(has(text,/autoritzacio de la despesa|autoritzacio de despesa|despesa per a|anualitat 20\d{2}/)){primaryCase=15;reason='L’autorització comptable sola no crea una adjudicació nova.';}
  else if(has(text,/modificaci|ampliacio/)){primaryCase=3;effect='possible_delta';reason='Cal separar actes mixtos i comparar import anterior i nou, sense sumar el total com un increment.';}
  else if(has(text,/emergencia|emergencia/)){primaryCase=13;effect='possible_maximum';reason='Si diu «fins a», el valor és un màxim, no despesa executada.';}
  else if(has(text,/adjudic|assignar els serveis|assignar places|provisio|concert social|gestio delegada/)){primaryCase=overlappingCases.includes(16)?16:overlappingCases.includes(11)?11:overlappingCases.includes(14)?14:overlappingCases.includes(10)?10:null;effect=overlappingCases.includes(16)?'possible_allocation':'possible_award';reason='Possible adjudicació: cal desglossar entitat, servei, període i import del resolc o de l’annex.';}
  if(genericTitle && !primaryCase){primaryCase=8;}
  if(genericTitle && !document){effect='none';reason='El títol només identifica l’expedient; cal llegir el document abans de classificar.';}
  if(source!=='document' && primaryCase!==8)reason+=' Classificació basada només en el títol; falta el text del document.';
  return {primaryCase,overlappingCases:[...new Set(overlappingCases.filter(value=>value!==primaryCase))],effect,source,reason,requiresReview:true};
}
