import type {SourceRecord} from './workbench-types';
export type ComparedField={label:string;original:string|number|null;document:string|number|null;effective:string|number|null;origin:'Excel'|'Document'|'Pendent';status:'Coincideix'|'Discrepància'|'Falta al document'|'Falta a l’Excel'|'Sense dades'|'Valor no vàlid'};
const normalize=(value:string|number)=>String(value).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('ca').replace(/\s+/g,' ').trim();
export function compareSourceField(label:string,original:string|number|null,document:string|number|null):ComparedField{
 const present=(v:string|number|null)=>v!==null&&String(v).trim()!=='';
 const originalPresent=present(original),documentPresent=present(document);
 const invalid=[original,document].some(v=>typeof v==='number'&&!Number.isFinite(v));
 return {label,original,document,effective:originalPresent?original:document,origin:originalPresent?'Excel':documentPresent?'Document':'Pendent',
  status:invalid?'Valor no vàlid':!originalPresent&&!documentPresent?'Sense dades':!originalPresent?'Falta a l’Excel':!documentPresent?'Falta al document':normalize(original!)===normalize(document!)?'Coincideix':'Discrepància'};
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
  compareSourceField('Mecanisme',record.mechanism,doc?.mechanism??null),compareSourceField('Import',record.amount,doc?.amount??null)];
}
