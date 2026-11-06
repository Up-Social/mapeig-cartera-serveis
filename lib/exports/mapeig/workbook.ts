import ExcelJS from 'exceljs';
import {createHash} from 'node:crypto';
import {excelCalendarDate,ExcelCalendarDateError} from '@/lib/excel-calendar-date';
import {distinctNifFormula,distinctNifTotalFormula,organShareFormula,organShareTotalFormula} from './formulas';
import {periodLabel} from './labels';
import {ORGAN_CLASSES,type OrganClass} from './organ';
import {summarizeMapeig,type CodeAggregate,type MapeigSummary} from './summary';
import {cellText,DETALL_FIXED_COLUMNS,DETALL_SHEET_NAME,loadMapeigTemplate,readSummaryCodes,TAULA_CONTROL_ROWS,TAULA_FIRST_CODE_ROW,TAULA_LAST_CODE_ROW,TAULA_SHEET,TAULA_TOTAL_ROW} from './template';
import {MAPEIG_PROVINCES,MAPEIG_TYPE_LABELS,type DetallRegistresRow,type ExtraColumn,type MapeigFilters,type MapeigProvince} from './types';

export type MapeigWorkbookOptions={
 filters:MapeigFilters;generatedAt:string;origin:string;
 extraColumns:readonly ExtraColumn[];
 catalogCodes:Map<string,string>;            // code → name of the active official catalogue
 distinctEntities?:'formula'|'value'|'auto'; // column R; the formula is O(N²)
 notes?:readonly string[];
 templateBytes?:Buffer|Uint8Array;
};
export type MapeigWorkbookResult={bytes:Uint8Array;sha256:string;summary:MapeigSummary;rowCount:number;lastDataRow:number;unlistedCodes:string[];placedCodes:string[]};
export const OBSERVATIONS_KEY='observations';
export const NOTES_SHEET='Notes_Exportacio';
const DISTINCT_FORMULA_MAX_ROWS=1500;
const YELLOW_ROWS={first:147,last:TAULA_LAST_CODE_ROW};
const COLUMN={E:5,F:6,G:7,H:8,I:9,J:10,K:11,L:12,M:13,N:14,O:15,P:16,Q:17,R:18,S:19,T:20,U:21,V:22,W:23,X:24,Y:25,Z:26} as const;
const PROVINCE_COLUMN:Record<MapeigProvince,number>={Barcelona:COLUMN.T,Tarragona:COLUMN.U,Girona:COLUMN.V,Lleida:COLUMN.W};
const ORGAN_COLUMN:Record<OrganClass,number>={dsi:COLUMN.O,altresGeneralitat:COLUMN.P,noGeneralitat:COLUMN.Q};
const MECHANISM_COLUMNS={Concert:[COLUMN.E,COLUMN.F],'Subvenció':[COLUMN.G,COLUMN.H],Conveni:[COLUMN.I,COLUMN.J],'Contractació':[COLUMN.K,COLUMN.L]} as const;
const euros=(cents:number)=>cents/100;
type FormulaResult=ExcelJS.CellFormulaValue['result'];
type CellStyle=Partial<ExcelJS.Style>;
/** exceljs ships data validations without typings. */
export type DataValidations={model:Record<string,ExcelJS.DataValidation>;find(address:string):ExcelJS.DataValidation|undefined;add(range:string,validation:ExcelJS.DataValidation):void};
export const dataValidationsOf=(sheet:ExcelJS.Worksheet):DataValidations=>(sheet as unknown as {dataValidations:DataValidations}).dataValidations;

export async function buildMapeigWorkbook(rows:readonly DetallRegistresRow[],options:MapeigWorkbookOptions):Promise<MapeigWorkbookResult>{
 const workbook=await loadMapeigTemplate(options.templateBytes);
 const taula=workbook.getWorksheet(TAULA_SHEET)!,detall=workbook.getWorksheet(DETALL_SHEET_NAME)!;
 const codes=readSummaryCodes(taula);
 const {unlisted,placed}=placeUnlistedCodes(taula,rows,options.catalogCodes,codes);
 const styles=clearDetallExamples(detall);
 const lastDataRow=writeDetallRows(detall,rows,options.extraColumns,styles);
 resetDetallValidations(detall,lastDataRow);
 const summary=summarizeMapeig(rows,codes);
 const mode=options.distinctEntities??'auto';
 const distinct=mode==='auto'?(rows.length<=DISTINCT_FORMULA_MAX_ROWS?'formula':'value'):mode;
 writeSummaryCells(taula,summary,lastDataRow,distinct);
 removeFormulaNames(workbook);
 writeNotes(workbook,rows,summary,options,{unlisted,placed,distinct});
 workbook.calcProperties.fullCalcOnLoad=true;
 const output=await workbook.xlsx.writeBuffer();
 const bytes=new Uint8Array(output);
 return {bytes,sha256:createHash('sha256').update(bytes).digest('hex'),summary,rowCount:rows.length,lastDataRow,unlistedCodes:unlisted,placedCodes:placed};
}

/** Codes used by rows but absent from the Taula go to the yellow rows when the
 * official catalogue knows them; anything else stays unlisted (control row 163). */
export function placeUnlistedCodes(taula:ExcelJS.Worksheet,rows:readonly DetallRegistresRow[],catalogCodes:Map<string,string>,codes:Array<{code:string;name:string;row:number}>):{unlisted:string[];placed:string[]}{
 const known=new Set(codes.map(c=>c.code.toUpperCase()));
 const missing=[...new Set(rows.map(r=>r.carteraCode).filter((code):code is string=>!!code&&!known.has(code.toUpperCase())))].sort();
 const unlisted:string[]=[],placed:string[]=[];
 let nextRow=YELLOW_ROWS.first;
 for(const code of missing){
  const name=catalogCodes.get(code);
  while(nextRow<=YELLOW_ROWS.last&&cellText(taula.getCell(`A${nextRow}`).value).trim())nextRow++;
  if(name===undefined||nextRow>YELLOW_ROWS.last){unlisted.push(code);continue;}
  taula.getCell(`A${nextRow}`).value=code;taula.getCell(`B${nextRow}`).value=name;taula.getCell(`D${nextRow}`).value='Dins';
  codes.push({code,name,row:nextRow});placed.push(code);nextRow++;
 }
 return {unlisted,placed};
}
/** Keeps the first example row's styles and empties the examples, the «↑» note
 * and the pre-formatted input rows. exceljs' spliceRows does not delete a block
 * that reaches the last row, so rows are cleared and rewritten in place. */
export function clearDetallExamples(detall:ExcelJS.Worksheet):CellStyle[]{
 const styles=Array.from({length:DETALL_FIXED_COLUMNS},(_,index)=>structuredClone(detall.getCell(2,index+1).style));
 for(let number=2;number<=detall.rowCount;number++){const row=detall.getRow(number);row.values=[];row.height=undefined as unknown as number;}
 return styles;
}
/** First added column, right after the template's: why column F is blank. F
 * stays empty (a number or nothing) so the summary formulas are unchanged. */
export const AMOUNT_BLANK_REASON_KEY='amountBlankReason';
export const AMOUNT_BLANK_REASON_COLUMN:ExtraColumn={key:AMOUNT_BLANK_REASON_KEY,header:'Motiu de l’import en blanc',width:44};
export const amountBlankReason=(row:DetallRegistresRow)=>row.amount===null?(row.amountBlankReason?.trim()||'Import no identificat al document'):null;
export function writeDetallRows(detall:ExcelJS.Worksheet,rows:readonly DetallRegistresRow[],providerColumns:readonly ExtraColumn[],styles:CellStyle[]):number{
 const extraColumns=[AMOUNT_BLANK_REASON_COLUMN,...providerColumns.filter(column=>column.key!==AMOUNT_BLANK_REASON_KEY)];
 const headerStyle=structuredClone(detall.getCell(1,DETALL_FIXED_COLUMNS).style);
 headerStyle.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF595959'}};
 const extraStyle=structuredClone(styles[1]);extraStyle.font={...extraStyle.font,color:{argb:'FF404040'}};extraStyle.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF2F2F2'}};
 extraColumns.forEach((column,index)=>{
  const cell=detall.getCell(1,DETALL_FIXED_COLUMNS+index+1);
  cell.value=column.header;cell.style=structuredClone(headerStyle);
  detall.getColumn(DETALL_FIXED_COLUMNS+index+1).width=column.width??18;
 });
 if(extraColumns.length)detall.getCell(1,DETALL_FIXED_COLUMNS+1).note='Columnes afegides per l’aplicació per validar les línies. El full Taula (resum) no les fa servir.';
 rows.forEach((row,index)=>{
  let date:Date|null=null;
  try{date=excelCalendarDate(row.awardDate,row.sourceId);}catch(error){if(!(error instanceof ExcelCalendarDateError))throw error;}
  const values:ExcelJS.CellValue[]=[
   row.sourceUrl?{text:row.sourceId,hyperlink:row.sourceUrl}:row.sourceId,
   row.providerName,row.providerNif,row.mechanism,date,row.amount,row.contractingBody,row.targetPopulation,row.province,row.source,row.carteraCode,
   ...extraColumns.map(column=>column.key===OBSERVATIONS_KEY?(row.observations.join(' · ')||null):column.key===AMOUNT_BLANK_REASON_KEY?amountBlankReason(row):row.extras[column.key]??null),
  ];
  const added=detall.getRow(index+2);
  added.values=values;
  for(let column=1;column<=values.length;column++)added.getCell(column).style=structuredClone(column<=DETALL_FIXED_COLUMNS?styles[column-1]:extraStyle);
  added.getCell(COLUMN.E).numFmt='yyyy-mm-dd';
  const reason=amountBlankReason(row);
  if(reason)added.getCell(COLUMN.F).note=`Import en blanc: ${reason}`;
 });
 const lastColumn=detall.getColumn(DETALL_FIXED_COLUMNS+extraColumns.length).letter;
 detall.autoFilter=`A1:${lastColumn}1`;
 return rows.length+1;
}
/** The template validates rows 2–500 cell by cell; rebuild them as ranges that cover the data. */
export function resetDetallValidations(detall:ExcelJS.Worksheet,lastDataRow:number):void{
 const limit=Math.max(500,lastDataRow+200);
 const validations=dataValidationsOf(detall);
 const definitions=(['D','I','J','K'] as const).map(column=>[column,validations.find(`${column}2`)] as const);
 validations.model={};
 for(const [column,definition] of definitions)if(definition)validations.add(`${column}2:${column}${limit}`,structuredClone(definition));
}
const share=(value:number|null)=>value===null?'':value;
function codeResults(a:CodeAggregate):Map<number,FormulaResult>{
 const results=new Map<number,FormulaResult>();
 for(const [mechanism,[sum,count]] of Object.entries(MECHANISM_COLUMNS)){const totals=a.byMechanism[mechanism as keyof typeof MECHANISM_COLUMNS];results.set(sum,euros(totals.amountCents));results.set(count,totals.count);}
 results.set(COLUMN.M,euros(a.totalCents));results.set(COLUMN.N,a.dominant);
 for(const organ of ORGAN_CLASSES)results.set(ORGAN_COLUMN[organ],share(a.share[organ]));
 results.set(COLUMN.R,a.distinctNifs);
 for(const province of MAPEIG_PROVINCES)results.set(PROVINCE_COLUMN[province],euros(a.byProvince[province]));
 results.set(COLUMN.X,a.level);results.set(COLUMN.Y,a.hasChildren?'Sí':'No');results.set(COLUMN.Z,euros(a.ownLevelCents));
 return results;
}
/** Every formula cell of the summary gets an explicit formula plus its computed
 * result: shared formulas become plain ones, O/P/Q/R lose the broken names. */
export function writeSummaryCells(taula:ExcelJS.Worksheet,summary:MapeigSummary,lastDataRow:number,distinct:'formula'|'value'):void{
 const byRow=new Map(summary.byCode.map(a=>[a.row,a]));
 for(let row=TAULA_FIRST_CODE_ROW;row<=TAULA_LAST_CODE_ROW;row++){
  const aggregate=byRow.get(row);
  const results=aggregate?codeResults(aggregate):null;
  for(let column:number=COLUMN.E;column<=COLUMN.Z;column++){
   const cell=taula.getCell(row,column);
   const organ=(Object.keys(ORGAN_COLUMN) as OrganClass[]).find(key=>ORGAN_COLUMN[key]===column);
   if(organ)cell.value={formula:organShareFormula(row,organ,lastDataRow),result:results?.get(column)??''};
   else if(column===COLUMN.R){
    if(!aggregate)cell.value=null;
    else if(distinct==='formula')cell.value={formula:distinctNifFormula(row,lastDataRow),result:aggregate.distinctNifs};
    else cell.value=aggregate.distinctNifs;
   }
   else if(column===COLUMN.S)continue;
   else if(cell.formula)cell.value={formula:cell.formula,result:results?.get(column)??''};
  }
 }
 const total=summary.total,totalRow=TAULA_TOTAL_ROW;
 const totalResults=new Map<number,FormulaResult>();
 for(const [mechanism,[sum,count]] of Object.entries(MECHANISM_COLUMNS)){const totals=total.byMechanism[mechanism as keyof typeof MECHANISM_COLUMNS];totalResults.set(sum,euros(totals.amountCents));totalResults.set(count,totals.count);}
 totalResults.set(COLUMN.M,euros(total.totalCents));totalResults.set(COLUMN.N,total.dominant);
 for(const province of MAPEIG_PROVINCES)totalResults.set(PROVINCE_COLUMN[province],euros(total.byProvince[province]));
 totalResults.set(COLUMN.Z,euros(total.ownLevelSumCents));
 for(let column:number=COLUMN.E;column<=COLUMN.Z;column++){
  const cell=taula.getCell(totalRow,column);
  const organ=(Object.keys(ORGAN_COLUMN) as OrganClass[]).find(key=>ORGAN_COLUMN[key]===column);
  if(organ)cell.value={formula:organShareTotalFormula(totalRow,organ,lastDataRow),result:share(total.share[organ])};
  else if(column===COLUMN.R)cell.value=distinct==='formula'?{formula:distinctNifTotalFormula(lastDataRow),result:total.distinctNifs}:total.distinctNifs;
  else if(cell.formula)cell.value={formula:cell.formula,result:totalResults.get(column)??''};
 }
 const [unmatchedRow,organRow]=TAULA_CONTROL_ROWS;
 const unmatched=taula.getCell(unmatchedRow,COLUMN.M);if(unmatched.formula)unmatched.value={formula:unmatched.formula,result:euros(summary.unmatchedCents)};
 const unclassified=taula.getCell(organRow,COLUMN.M);if(unclassified.formula)unclassified.value={formula:unclassified.formula,result:euros(summary.unclassifiedOrganCents)};
}
export function removeFormulaNames(workbook:ExcelJS.Workbook):void{
 workbook.definedNames.model=workbook.definedNames.model.filter(name=>!/^(?:Org_|Reg_)/.test(name.name));
}
const money=(cents:number)=>`${(cents/100).toLocaleString('ca-ES',{minimumFractionDigits:2,maximumFractionDigits:2})} €`;
function writeNotes(workbook:ExcelJS.Workbook,rows:readonly DetallRegistresRow[],summary:MapeigSummary,options:MapeigWorkbookOptions,extra:{unlisted:string[];placed:string[];distinct:'formula'|'value'}):void{
 const sheet=workbook.addWorksheet(NOTES_SHEET);
 sheet.getColumn(1).width=120;
 const lines:string[]=[
  `Exportació del Mapeig de la Cartera generada el ${options.generatedAt} des de ${options.origin}.`,
  `Tipologies: ${options.filters.financingTypes.map(type=>MAPEIG_TYPE_LABELS[type]).join(', ')}. Províncies: ${options.filters.provinces?.join(', ')??'totes'}. Any de concessió: ${periodLabel(options.filters)}.`,
  `${rows.length} línies a Detall_Registres. Import total: ${money(summary.total.totalCents)}.`,
  'Les línies amb dades pendents (codi, data, import, província, òrgan o NIF) s’exporten igualment i queden anotades a la columna «Observacions» de Detall_Registres; no s’ha inventat cap dada.',
  `Línies sense codi de la Cartera: ${summary.counts.withoutCode}. Sense data de concessió: ${summary.counts.withoutDate}. Sense import: ${summary.counts.withoutAmount}. Sense província: ${summary.counts.withoutProvince} (${money(summary.withoutProvinceCents)} fora de les columnes de territori). Sense NIF: ${summary.counts.withoutNif} (no compten a «Nre. entitats prestadores»). Òrgan no reconegut per les paraules clau: ${summary.counts.withoutOrgan} (${money(summary.unclassifiedOrganCents)}, fila de control 164).`,
  extra.placed.length?`Codis del catàleg oficial afegits a les files grogues de la Taula (resum): ${extra.placed.join(', ')}.`:'No ha calgut afegir cap codi a les files grogues de la Taula (resum).',
  extra.unlisted.length?`Codis que no són a la Taula (resum) ni al catàleg oficial (fila de control 163, ${money(summary.unmatchedCents)}): ${extra.unlisted.join(', ')}.`:'Tots els codis de Detall_Registres existeixen a la Taula (resum).',
  'Les columnes O, P i Q (percentatges per òrgan) i R (entitats prestadores) de la Taula (resum) porten fórmules explícites sobre Detall_Registres, equivalents als noms Org_DSI, Org_AltresGeneralitat i Org_NoGeneralitat de la plantilla original, que no es poden conservar en regenerar el fitxer.',
  extra.distinct==='value'?'La columna R (Nre. entitats prestadores) s’ha escrit com a valor calculat per l’aplicació perquè el volum de línies fa la fórmula massa lenta; no es recalcula en editar Detall_Registres.':'La columna R (Nre. entitats prestadores) compta NIF diferents per codi, inclosos els subnivells.',
  'La columna S (Places / capacitat RESES) es deixa en blanc per omplir a mà: no surt dels registres de finançament.',
  'Els valors de la Taula (resum) s’han precalculat; Excel els recalcula en obrir el fitxer.',
  ...(options.notes??[]),
 ];
 for(const line of lines){const row=sheet.addRow([line]);row.getCell(1).alignment={wrapText:true,vertical:'top'};}
}
