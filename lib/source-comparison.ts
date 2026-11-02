import type {SourceRecord} from './workbench-types';
export type ComparedField={label:string;original:string|number|null;document:string|number|null;effective:string|number|null;origin:'Excel'|'Document'|'Pendent';status:'Coincideix'|'Discrepància'|'No disponible al resultat documental'|'Falta a l’Excel'|'Sense dades'|'Valor no vàlid'|'Naturalesa pendent'};
const normalize=(value:string|number)=>String(value).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('ca').replace(/\s+/g,' ').trim();
export function compareSourceField(label:string,original:string|number|null,document:string|number|null):ComparedField{
 const present=(v:string|number|null)=>v!==null&&String(v).trim()!=='';
 const originalPresent=present(original),documentPresent=present(document);
 const invalid=[original,document].some(v=>typeof v==='number'&&!Number.isFinite(v));
 const selected=originalPresent?original:documentPresent?document:null;
 // An invalid source value must not silently become a valid document value.
 // Preserve the discrepancy for review instead of exporting NaN or Infinity.
 const effective=typeof selected==='number'&&!Number.isFinite(selected)?null:selected;
 return {label,original,document,effective,origin:effective===null?'Pendent':originalPresent?'Excel':'Document',
  status:invalid?'Valor no vàlid':!originalPresent&&!documentPresent?'Sense dades':!originalPresent?'Falta a l’Excel':!documentPresent?'No disponible al resultat documental':normalize(original!)===normalize(document!)?'Coincideix':'Discrepància'};
}
/** A Concert can have multiple providers, so a null aggregate does not imply
 * that its individual line identities were not extracted. */
export function extractedFieldDisplay(type:string,label:string,value:string|number|null|undefined):string {
 if(value==null||typeof value==='string'&&!value.trim())return type==='concert'&&(label==='Entitat'||label==='NIF')
  ?'No disponible a nivell global · consulta les línies':'No identificat en l’extracció · pendent de contrast';
 return typeof value==='number'?new Intl.NumberFormat('ca-ES',{style:'currency',currency:'EUR'}).format(value):value;
}
export type ContractAmountSource='award'|'tender'|'estimate'|'unknown'|'none';
/** The imported amount is a fallback among three distinct fields. Classify it
 * only if the original row proves which field supplied the stored number. */
export function contractAmountSource(amount:number|null,payload:Record<string,unknown>|null|undefined):ContractAmountSource{
 if(amount===null)return 'none';
 if(!Number.isFinite(amount)||Math.abs(amount)>=2**46||!payload)return 'unknown';
 const fields:[string,ContractAmountSource][]=[['Importe de adjudicación','award'],['Presupuesto de licitación','tender'],['Valor estimado del contrato','estimate']];
 for(const [key,kind] of fields){
  const value=payload[key];
  const string=typeof value==='string'?value.replace(/^ +| +$/g,''):null;
  const number=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value.replace(',','.')):null;
  if(number!==null&&Number.isFinite(number)){
   // The importer also accepts exotic Number() syntax. Do not infer which
   // field supplied an amount when its textual notation is ambiguous.
   if(string&&(string.length>32||!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(string)))return 'unknown';
   return number===amount?kind:'unknown';
  }
 }
 return 'unknown';
}
/** A tender budget or estimated value is not an awarded amount. The current
 * document enrichment also lacks an amount-type field; keep it visible but do
 * not use it as an equivalent contract award without further evidence. */
export function compareImportedAmount(dataset:string,amount:number|null,document:number|null,verifiedAward?:number|null,financingType?:string|null):ComparedField{
 const compared=compareSourceField('Import',amount,document);
 if((dataset!=='contractacions'&&financingType!=='contractacio')||compared.status==='Sense dades')return compared;
 if(dataset!=='contractacions'||financingType!=='contractacio')
  return {...compared,effective:null,origin:'Pendent',status:compared.status==='Valor no vàlid'?'Valor no vàlid':'Naturalesa pendent'};
 // Only the server-side SQL computation can validate the original JSON number
 // without losing decimal precision during JSON parsing in JavaScript.
 if(typeof verifiedAward!=='number'||!Number.isFinite(verifiedAward)||verifiedAward!==amount||Math.abs(verifiedAward)>=2**46)
  return {...compared,effective:null,origin:'Pendent',status:compared.status==='Valor no vàlid'?'Valor no vàlid':'Naturalesa pendent'};
 if(compared.status==='Valor no vàlid')return compared;
 return {...compared,effective:verifiedAward,origin:'Excel',status:document===null?compared.status:'Naturalesa pendent'};
}
export function importedComparisonFields(record:Pick<SourceRecord,'sourceDataset'|'sourcePayload'>){
 const value=(key:string)=>{const v=record.sourcePayload[key];return typeof v==='string'||typeof v==='number'?String(v).trim()||null:null;};
 const grant=record.sourceDataset.startsWith('raisc_');
 const date=value(grant?'Data concessió':record.sourceDataset==='convenis'?'Data signatura':'');
 const dmy=date?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
 const normalizedDate=dmy?`${dmy[3]}-${dmy[2]}-${dmy[1]}`:date&&/^\d{4}-\d{2}-\d{2}/.test(date)?date.slice(0,10):date;
 // Publication dates and beneficiaries of a grant are not award dates or final users.
 return {nif:grant?value('CIF Beneficiari'):null,date:normalizedDate,
  contractingBody:record.sourceDataset==='contractacions'?value('Órgano de contratación'):grant?value('Entitat, OO.AA. o Departament convocant'):null};
}
export function sourceComparison(record:SourceRecord):ComparedField[]{
 const doc=record.externalEnrichment,original=importedComparisonFields(record);
 return [compareSourceField('Títol',record.title,doc?.title??null),compareSourceField('Entitat',record.providerName,doc?.providerName??null),
  compareSourceField('NIF',original.nif,doc?.providerNif??null),
  compareSourceField(record.sourceDataset==='convenis'?'Data de signatura':'Data de concessió / adjudicació',original.date,doc?.awardDate??null),
  compareSourceField('Òrgan concedent / contractant',original.contractingBody,doc?.contractingBody??null),
  compareSourceField('Mecanisme',record.mechanism,doc?.mechanism??null),compareImportedAmount(record.sourceDataset,record.amount,doc?.amount??null,record.contractVerifiedAward,record.financingType)];
}
