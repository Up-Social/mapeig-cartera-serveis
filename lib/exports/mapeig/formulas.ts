import {ORGAN_KEYWORDS,type OrganClass} from './organ';

/** Inline replacements for the template's formula-typed defined names
 * (Org_DSI, Org_AltresGeneralitat, Org_NoGeneralitat, Reg_Codi, Reg_Import).
 * exceljs only models range names, so the originals cannot survive a rewrite;
 * the expressions below reproduce them exactly, bound to the real last row. */
export const DETALL_SHEET='Detall_Registres';
export const DETALL_LAST_ROW_MIN=2;
export const range=(column:string,lastRow:number)=>`${DETALL_SHEET}!$${column}$2:$${column}$${Math.max(DETALL_LAST_ROW_MIN,lastRow)}`;
const search=(keyword:string,lastRow:number)=>`ISNUMBER(SEARCH("${keyword}",${range('G',lastRow)}))`;
const group=(organ:OrganClass,lastRow:number)=>`SIGN(${ORGAN_KEYWORDS[organ].map(keyword=>search(keyword,lastRow)).join('+')})`;
export function organExpression(organ:OrganClass,lastRow:number):string{
 const dsi=group('dsi',lastRow),generalitat=group('altresGeneralitat',lastRow),local=group('noGeneralitat',lastRow);
 if(organ==='dsi')return dsi;
 if(organ==='altresGeneralitat')return `(1-${dsi})*${generalitat}`;
 return `(1-${dsi})*(1-${generalitat})*${local}`;
}
const codeMatch=(row:number,lastRow:number)=>`((${range('K',lastRow)}=$A${row})+(LEFT(${range('K',lastRow)},LEN($A${row})+1)=$A${row}&"."))`;
export const organShareFormula=(row:number,organ:OrganClass,lastRow:number)=>
 `IF(OR($A${row}="",M${row}=0),"",SUMPRODUCT(${codeMatch(row,lastRow)}*${organExpression(organ,lastRow)},${range('F',lastRow)})/M${row})`;
export const organShareTotalFormula=(totalRow:number,organ:OrganClass,lastRow:number)=>
 `IF(M${totalRow}=0,"",SUMPRODUCT(${organExpression(organ,lastRow)},${range('F',lastRow)})/M${totalRow})`;
/** Distinct non-empty NIFs among rows of the code and its sublevels (column R). */
export function distinctNifFormula(row:number,lastRow:number):string{
 const nif=range('C',lastRow),code=range('K',lastRow);
 const count=`(COUNTIFS(${nif},${nif},${code},$A${row})+COUNTIFS(${nif},${nif},${code},$A${row}&".*"))`;
 return `IF($A${row}="","",SUMPRODUCT(${codeMatch(row,lastRow)}*(${nif}<>"")/(${count}+(${count}=0))))`;
}
export const distinctNifTotalFormula=(lastRow:number)=>`SUMPRODUCT((${range('C',lastRow)}<>"")/COUNTIF(${range('C',lastRow)},${range('C',lastRow)}&""))`;
