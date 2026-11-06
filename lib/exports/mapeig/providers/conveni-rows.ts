import reference from '@/lib/concerts/data/municipalities-idescat.json';
import {municipalityReference} from '@/lib/concerts/geography';
import {BLOCKER_LABELS,normalizeConveni,type ConveniUnit} from '@/lib/convenis/contract';
import {conveniInstrumentsGrant} from '@/lib/convenis/marks';
import {OBSERVATIONS_KEY} from '../workbook';
import {MAPEIG_PROVINCES,type DetallRegistresRow,type ExtraColumn,type MapeigProvince,type ProviderResult} from '../types';

/** Rows read from the database, close to their tables so the mapping below can
 * be tested without services. */
export type ConveniCurrentUnitRow={
 unit_id:string;job_id:string;source_record_id:string;data:ConveniUnit;payload:{instrument_grant?:boolean|null}|null;
 outcome:string|null;reviewed_code:string|null;reviewed_job:string|null;review_note:string|null;
};
export type ConveniRecordRow={id:string;source_record_id:string;title:string|null;source_payload:Record<string,unknown>|null};
export type ConveniProvisionRow={source_record_id:string;unit_id:string|null;provider_name:string|null;provider_nif:string|null;amount:number|string|null;service_code:string|null;award_date:string|null;contracting_body:string|null;target_population:string|null;period:string|null};
export type ConveniMapeigData={units:ConveniCurrentUnitRow[];records:ConveniRecordRow[];provisions:ConveniProvisionRow[]};
export type ConveniRowOptions={origin:string;catalogCodes:Map<string,string>};

/** Out-of-portfolio financing goes to the template's FORA row, never to a code. */
export const CONVENI_OUT_OF_PORTFOLIO_CODE='FORA';
export const CONVENI_EXTRA_COLUMNS:readonly ExtraColumn[]=[
 {key:'lineState',header:'Estat de la línia',width:16},{key:'recordId',header:'ID registre',width:16},{key:'recordTitle',header:'Títol del registre',width:40},
 {key:'unitId',header:'ID línia',width:36},{key:'period',header:'Període',width:22},{key:'year',header:'Anualitat',width:10},
 {key:'amountState',header:'Estat de l’import',width:18},{key:'documentedAmount',header:'Import documentat a la línia',width:16},{key:'amountOrigin',header:'Origen de l’import',width:24},
 {key:'classification',header:'Classificació',width:18},{key:'serviceName',header:'Nom del servei',width:36},{key:'activity',header:'Tipus d’activitat',width:48},
 {key:'instrumentGrant',header:'Instrumenta subvenció',width:12},{key:'relatedConvenis',header:'Convenis relacionats',width:24},
 {key:'territoryOrigin',header:'Origen del territori',width:24},{key:'appLink',header:'Enllaç a l’aplicació',width:40},{key:OBSERVATIONS_KEY,header:'Observacions',width:60},
];
const AMOUNT_STATE:Record<string,string>={planned:'Previst',conditional:'Condicionat',confirmed:'Concessió confirmada'};
const CLASSIFICATION:Record<string,string>={in_portfolio:'Dins de la Cartera',out_of_portfolio:'Fora de la Cartera'};
const trimmed=(value:unknown)=>typeof value==='string'&&value.trim()&&value.trim()!=='None'?value.trim():null;
const isProvince=(value:string|null|undefined):value is MapeigProvince=>!!value&&(MAPEIG_PROVINCES as readonly string[]).includes(value);
const normalize=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('ca').replace(/\s+/g,' ').trim();
const countyProvince=new Map<string,string|null>();
for(const [,,county,province] of reference.rows){const key=normalize(county);countyProvince.set(key,countyProvince.has(key)&&countyProvince.get(key)!==province?null:province);}

const ARTICLE:Record<string,string>={"de l'":"l'",'de la ':'la','de les ':'les','del ':'el','dels ':'els'};
/** Idescat writes the article after the name («Vendrell, el»); the agreement
 * writes «Ajuntament del Vendrell» or «El Vendrell». */
function municipalityCandidates(body:string):string[]{
 const text=body.replace(/[’]/g,"'").replace(/\s+/g,' ').trim();
 const preposition=text.match(/^Ajuntament (de l'|de la |de les |dels |del |de |d')\s*(.+)$/i);
 const name=preposition?preposition[2].trim():text;
 const article=preposition?ARTICLE[preposition[1].toLowerCase()]:undefined;
 const leading=name.match(/^(El|La|Els|Les|L')\s*(.+)$/i);
 const candidates=[name];
 if(article)candidates.push(`${name}, ${article}`);
 if(leading)candidates.push(`${leading[2]}, ${leading[1].toLowerCase()}`);
 return candidates;
}
/** Province of the signing local body: a municipality (Ajuntament), a county
 * (Consell Comarcal) or a province (Diputació), from the pinned Idescat table. */
export function localBodyProvince(name:string|null):{province:MapeigProvince|null;origin:string|null;note:string|null}{
 const bodies=(name??'').split(/[;\n]/).map(part=>part.trim()).filter(Boolean);
 if(!bodies.length)return {province:null,origin:null,note:'Ens local signant no identificat'};
 const provinces=new Set<string>();
 for(const body of bodies){
  const diputacio=body.match(/^Diputació\s+(?:de\s+|d[’'])\s*(.+)$/i)?.[1];
  if(diputacio){const p=MAPEIG_PROVINCES.find(province=>normalize(province)===normalize(diputacio));if(p){provinces.add(p);continue;}}
  const county=body.match(/^Consell\s+Comarcal\s+(?:de\s+l[’']|de\s+la\s+|del\s+|dels\s+|de\s+|d[’'])\s*(.+)$/i)?.[1];
  if(county){const p=countyProvince.get(normalize(county));if(p){provinces.add(p);continue;}}
  const place=municipalityCandidates(body).map(name=>municipalityReference(name)).find(Boolean);
  if(place&&isProvince(place.province)){provinces.add(place.province);continue;}
  return {province:null,origin:null,note:`Província no resolta: ${body}`};
 }
 if(provinces.size!==1)return {province:null,origin:null,note:'Ens locals signants de més d’una província'};
 return {province:[...provinces][0] as MapeigProvince,origin:'Ens local signant (Idescat)',note:null};
}

/** The amount of a unit or concept: an approved provision prevails; otherwise the
 * proposal's amount. A joint amount shared by several recipients is shown but
 * not added up, so it is not counted once per recipient. */
export function conveniUnitAmount(unit:ConveniUnit,provision:ConveniProvisionRow|undefined):{amount:number|null;documented:number|null;origin:string|null;note:string|null}{
 const documented=typeof unit.amount_cents==='number'?unit.amount_cents/100:null;
 if(provision&&provision.amount!==null&&provision.amount!==''&&Number.isFinite(Number(provision.amount)))
  return {amount:Number(provision.amount),documented,origin:'Provisió aprovada',note:null};
 if(documented===null)return {amount:null,documented,origin:null,note:'Import pendent: el document no l’atribueix a aquesta línia'};
 if(unit.joint)return {amount:null,documented,origin:null,note:'Import conjunt sense repartiment entre receptors: no se suma'};
 return {amount:documented,documented,origin:'Proposta de l’anàlisi del conveni',note:unit.mixed?'Import mixt: cobreix diverses activitats sense repartiment':null};
}

const isoDate=(value:unknown)=>{const text=trimmed(value);return text&&/^\d{4}-\d{2}-\d{2}/.test(text)?text.slice(0,10):null;};

/** One row per exported Conveni unit: proposals (pending review) and approved
 * units, inside or outside the Cartera. Groups of concepts export each concept
 * that carries its own classification. Discards and units without enough
 * evidence are not exported; they are counted in the notes. */
export function conveniRowsFromData(data:ConveniMapeigData,options:ConveniRowOptions):ProviderResult{
 const records=new Map(data.records.map(r=>[r.id,r]));
 const provisionsByUnit=new Map(data.provisions.filter(p=>p.unit_id).map(p=>[p.unit_id!,p]));
 const rows:DetallRegistresRow[]=[];
 const counts={discarded:0,insufficient:0,rejected:0,legacyApproved:0,concepts:0};
 const recordsWithUnits=new Set(data.units.map(u=>u.source_record_id));
 const push=(record:ConveniRecordRow|undefined,unit:ConveniUnit,meta:{unitId:string;state:string;reviewedCode:string|null;outside:boolean;provision?:ConveniProvisionRow;grant:boolean|null|undefined;concept:boolean})=>{
  const payload=(record?.source_payload??{}) as Record<string,unknown>;
  const observations:string[]=[];
  const classification=meta.outside?'out_of_portfolio':unit.classification;
  const recipient=trimmed(meta.provision?.provider_name)??trimmed(unit.recipient);
  if(!recipient)observations.push('Entitat pendent de contrast');
  const nif=trimmed(meta.provision?.provider_nif)??trimmed(unit.recipient_nif);
  const amount=conveniUnitAmount(unit,meta.provision);
  if(amount.note)observations.push(amount.note);
  const code=classification==='out_of_portfolio'?CONVENI_OUT_OF_PORTFOLIO_CODE:trimmed(meta.provision?.service_code)??trimmed(meta.reviewedCode)??trimmed(unit.service_code);
  if(classification==='in_portfolio'&&!code)observations.push('Codi pendent de revisió');
  if(classification==='out_of_portfolio')observations.push('Finançament fora de la Cartera: no suma a cap codi de la Cartera');
  for(const blocker of unit.blockers??[])if(BLOCKER_LABELS[blocker]&&!(blocker==='mixed'&&unit.mixed)&&!(blocker==='joint'&&unit.joint))observations.push(BLOCKER_LABELS[blocker]);
  if(meta.concept)observations.push('Concepte d’un grup del mateix receptor i període');
  const localBodies=trimmed(payload['Organismes signants ens locals']);
  const contractingBody=trimmed(meta.provision?.contracting_body)??(unit.financiers?.length?unit.financiers.join('; '):null)??localBodies??trimmed(payload['Organismes signants per part de la Generalitat']);
  if(!contractingBody)observations.push('Òrgan no identificat');
  const territory=localBodyProvince(localBodies);
  if(territory.note)observations.push(territory.note);
  const awardDate=isoDate(meta.provision?.award_date)??isoDate(payload['Data signatura']);
  if(!awardDate)observations.push('Data de signatura no identificada');
  const original=normalizeConveni(payload);
  const sourceId=trimmed(payload['Número conveni definitiu'])??record?.source_record_id??'';
  const serviceName=code&&code!==CONVENI_OUT_OF_PORTFOLIO_CODE?options.catalogCodes.get(code)??trimmed(unit.service_name):null;
  rows.push({
   sourceUrl:trimmed(payload['Document conveni']),sourceId,providerName:recipient,providerNif:nif,mechanism:'Conveni',awardDate,amount:amount.amount,
   contractingBody,targetPopulation:trimmed(meta.provision?.target_population)??trimmed(unit.population),province:territory.province,source:'Registre de Convenis',carteraCode:code,
   extras:{
    lineState:meta.state,recordId:record?.source_record_id??null,recordTitle:record?.title??trimmed(payload['Títol conveni']),unitId:meta.unitId,
    period:trimmed(meta.provision?.period)??trimmed(unit.period),year:unit.year??null,amountState:AMOUNT_STATE[unit.amount_state]??null,
    documentedAmount:amount.documented,amountOrigin:amount.origin,classification:CLASSIFICATION[classification]??classification,serviceName,
    activity:classification==='out_of_portfolio'?trimmed(unit.description):null,
    instrumentGrant:conveniInstrumentsGrant(payload,meta.grant)?'Sí':'No',relatedConvenis:original.related.join('; ')||null,
    territoryOrigin:territory.origin,appLink:record?`${options.origin}/records/${record.id}`:null,
   },
   observations,
  });
 };
 for(const current of data.units){
  const record=records.get(current.source_record_id);
  const reviewed=current.reviewed_job===current.job_id?current.outcome:null;
  if(reviewed&&reviewed!=='select'&&reviewed!=='outside'){counts.rejected+=1;continue;}
  const state=reviewed?'Aprovada':'Pendent de revisió';
  const grant=current.payload?.instrument_grant;
  const concepts=(current.data.concepts??[]).filter(c=>c.classification==='in_portfolio'||c.classification==='out_of_portfolio');
  if(!reviewed&&concepts.length&&current.data.classification!=='in_portfolio'&&current.data.classification!=='out_of_portfolio'){
   concepts.forEach((concept,index)=>{counts.concepts+=1;push(record,concept,{unitId:`${current.unit_id}#${index+1}`,state,reviewedCode:null,outside:false,grant,concept:true});});
   continue;
  }
  if(reviewed==='outside'||current.data.classification==='out_of_portfolio'||current.data.classification==='in_portfolio'||reviewed==='select'){
   push(record,current.data,{unitId:current.unit_id,state,reviewedCode:reviewed==='select'?current.reviewed_code:null,outside:reviewed==='outside',provision:reviewed==='select'?provisionsByUnit.get(current.unit_id):undefined,grant,concept:false});
   continue;
  }
  if(current.data.classification==='discarded')counts.discarded+=1;else counts.insufficient+=1;
 }
 // Records approved before the unit proposals existed keep only their provision.
 for(const provision of data.provisions){
  if(recordsWithUnits.has(provision.source_record_id))continue;
  const record=records.get(provision.source_record_id);
  counts.legacyApproved+=1;
  const unit:ConveniUnit={key:provision.unit_id??provision.source_record_id,recipient:provision.provider_name??'',recipient_nif:provision.provider_nif,recipient_nature:'unknown',joint:false,period:provision.period??'',year:null,
   amount_cents:null,amount_state:'confirmed',mixed:false,financiers:[],territory:null,classification:'in_portfolio',service_code:provision.service_code,population:provision.target_population??'',description:'',explanation:'',reason:null,evidence:[],blockers:[]};
  push(record,unit,{unitId:provision.unit_id??provision.source_record_id,state:'Aprovada',reviewedCode:provision.service_code,outside:false,provision,grant:null,concept:false});
 }
 const notes:string[]=[];
 notes.push('Convenis: s’exporten les propostes (pendents de revisió) i les línies aprovades, dins i fora de la Cartera. El finançament fora de la Cartera es compta a la fila FORA i no suma a cap codi.');
 if(counts.concepts)notes.push(`${counts.concepts} línies són conceptes d’un grup del mateix receptor i període; cadascun porta el seu import i la seva proposta.`);
 if(counts.discarded||counts.insufficient||counts.rejected)notes.push(`Convenis no exportats: ${counts.discarded} unitats amb proposta de descart, ${counts.insufficient} amb evidència insuficient i ${counts.rejected} rebutjades a la revisió. Els registres descartats per regla d’abast tampoc no s’exporten.`);
 if(counts.legacyApproved)notes.push(`${counts.legacyApproved} línies corresponen a convenis aprovats abans de les propostes per unitat; surten de la provisió aprovada.`);
 return {rows,notes};
}
