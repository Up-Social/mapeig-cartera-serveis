import ExcelJS from 'exceljs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {MapeigTemplateError} from './types';

/** The client's v2 workbook, shipped with the application. */
export const MAPEIG_TEMPLATE_PATH=path.join(process.cwd(),'data','exports','master-mapeig-cartera-v2.xlsx');
export const TAULA_SHEET='Taula (resum)';
export const DETALL_SHEET_NAME='Detall_Registres';
export const LISTS_SHEET='Llistes_Auxiliars';
export const TAULA_FIRST_CODE_ROW=4;
export const TAULA_LAST_CODE_ROW=160; // rows 147–160 are the yellow rows for new codes
export const TAULA_TOTAL_ROW=162;
export const TAULA_CONTROL_ROWS=[163,164] as const;
export const DETALL_HEADERS=['Font\n(enllaç)','Nom entitat beneficiària','NIF entitat','Mecanisme\n(Concert/Subvenció/\nConveni/Contractació)','Data concessió','Import (€)','Òrgan contractant\n(text lliure: ajuntament, consell\ncomarcal, diputació, departament...)','Població objectiu /\nbeneficiaris\n(text lliure)','Territori\n(província)','Font\n(RAISC / PSCP / Registre\nde Convenis / e-Tauler)','Codi Cartera (servei) — completat per IA, després d\'analitzar la provisió'] as const;
export const DETALL_FIXED_COLUMNS=DETALL_HEADERS.length;

export async function loadMapeigTemplate(bytes?:Buffer|Uint8Array):Promise<ExcelJS.Workbook>{
 const workbook=new ExcelJS.Workbook();
 const source=bytes??await readFile(MAPEIG_TEMPLATE_PATH);
 await workbook.xlsx.load(Buffer.from(source) as never);
 assertMapeigTemplate(workbook);
 return workbook;
}
const text=(value:ExcelJS.CellValue):string=>value===null||value===undefined?'':typeof value==='object'&&'richText' in value?value.richText.map(part=>part.text).join(''):String(value);
/** Fail closed when the workbook is not the layout this generator was written for. */
export function assertMapeigTemplate(workbook:ExcelJS.Workbook):void{
 const taula=workbook.getWorksheet(TAULA_SHEET),detall=workbook.getWorksheet(DETALL_SHEET_NAME),lists=workbook.getWorksheet(LISTS_SHEET);
 if(!taula||!detall||!lists)throw new MapeigTemplateError('La plantilla del Mapeig no conté els fulls esperats (Taula (resum), Detall_Registres, Llistes_Auxiliars).');
 if(text(taula.getCell(`A${TAULA_FIRST_CODE_ROW}`).value)!=='1.1.1'||text(taula.getCell('A146').value)!=='FORA'||!text(taula.getCell(`A${TAULA_TOTAL_ROW}`).value).startsWith('TOTAL'))
  throw new MapeigTemplateError('La plantilla del Mapeig no té la Taula (resum) a les files esperades.');
 DETALL_HEADERS.forEach((header,index)=>{
  if(text(detall.getCell(1,index+1).value).replace(/\s+/g,' ').trim()!==header.replace(/\s+/g,' ').trim())
   throw new MapeigTemplateError(`La plantilla del Mapeig no té la capçalera esperada a la columna ${index+1} de Detall_Registres.`);
 });
}
export function readSummaryCodes(taula:ExcelJS.Worksheet):Array<{code:string;name:string;row:number}>{
 const codes:Array<{code:string;name:string;row:number}>=[];
 for(let row=TAULA_FIRST_CODE_ROW;row<=TAULA_LAST_CODE_ROW;row++){
  const code=text(taula.getCell(`A${row}`).value).trim();
  if(code)codes.push({code,name:text(taula.getCell(`B${row}`).value).trim(),row});
 }
 return codes;
}
export const cellText=text;
