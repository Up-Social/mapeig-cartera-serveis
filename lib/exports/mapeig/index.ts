import type {SupabaseClient} from '@supabase/supabase-js';
import {loadOfficialCatalog} from '@/lib/official-catalog';
import {applyRowFilters} from './filters';
import {mapeigFilename} from './filename';
import {providersFor} from './providers';
import {summarizeMapeig,type MapeigSummary} from './summary';
import {loadMapeigTemplate,readSummaryCodes,TAULA_SHEET} from './template';
import {MAPEIG_EXPORT_MAX_ROWS,MAPEIG_PROVINCES,type DetallRegistresRow,type ExtraColumn,type MapeigFilters,type MapeigProvince} from './types';
import {buildMapeigWorkbook,type MapeigWorkbookResult} from './workbook';

export type MapeigPreview={
 rowCount:number;totalCents:number;
 byProvince:Array<{province:MapeigProvince|null;rows:number;amountCents:number}>;
 counts:MapeigSummary['counts'];excluded:{province:number;dateRange:number};
 tooManyRows:boolean;maxRows:number;notes:string[];
};
type Prepared={rows:DetallRegistresRow[];extraColumns:ExtraColumn[];catalogCodes:Map<string,string>;notes:string[];excluded:{province:number;dateRange:number};codes:Array<{code:string;row:number}>};

async function catalogCodes(db:SupabaseClient,notes:string[]):Promise<Map<string,string>>{
 try{const catalog=await loadOfficialCatalog(db);return new Map(catalog.all.map(service=>[service.service_code,service.service_name]));}
 catch(error){notes.push(`El catàleg oficial no s’ha pogut carregar (${error instanceof Error?error.message:'error desconegut'}); els codis observats als annexos no s’han pogut contrastar.`);return new Map();}
}
export async function prepareMapeigExport(db:SupabaseClient,filters:MapeigFilters,origin:string):Promise<Prepared>{
 const notes:string[]=[];
 const codes=readSummaryCodes((await loadMapeigTemplate()).getWorksheet(TAULA_SHEET)!);
 const catalog=await catalogCodes(db,notes);
 const providers=providersFor(filters.financingTypes);
 const rows:DetallRegistresRow[]=[];
 const extraColumns:ExtraColumn[]=[];
 for(const provider of providers){
  const result=await provider.load(db,{origin,catalogCodes:catalog});
  rows.push(...result.rows);notes.push(...result.notes);
  for(const column of provider.extraColumns)if(!extraColumns.some(existing=>existing.key===column.key))extraColumns.push(column);
 }
 const filtered=applyRowFilters(rows,filters);
 return {rows:filtered.rows,extraColumns,catalogCodes:catalog,notes,excluded:filtered.excluded,codes};
}
export function previewFromRows(prepared:Prepared):MapeigPreview{
 const summary=summarizeMapeig(prepared.rows,prepared.codes);
 const byProvince=[...MAPEIG_PROVINCES,null].map(province=>{
  const rows=prepared.rows.filter(row=>row.province===province);
  return {province,rows:rows.length,amountCents:rows.reduce((sum,row)=>sum+(row.amount===null?0:Math.round(row.amount*100)),0)};
 }).filter(item=>item.province!==null||item.rows>0);
 return {rowCount:prepared.rows.length,totalCents:summary.total.totalCents,byProvince,counts:summary.counts,excluded:prepared.excluded,tooManyRows:prepared.rows.length>MAPEIG_EXPORT_MAX_ROWS,maxRows:MAPEIG_EXPORT_MAX_ROWS,notes:prepared.notes};
}
export async function previewMapeigExport(db:SupabaseClient,filters:MapeigFilters,origin:string):Promise<MapeigPreview>{
 return previewFromRows(await prepareMapeigExport(db,filters,origin));
}
export class MapeigTooManyRowsError extends Error{constructor(count:number){super(`L’exportació supera el màxim de ${MAPEIG_EXPORT_MAX_ROWS.toLocaleString('ca-ES')} línies (${count.toLocaleString('ca-ES')}). Acota per província o per dates.`);this.name='MapeigTooManyRowsError';}}
export async function buildMapeigExport(db:SupabaseClient,filters:MapeigFilters,origin:string,now=new Date()):Promise<MapeigWorkbookResult&{fileName:string;preview:MapeigPreview}>{
 const prepared=await prepareMapeigExport(db,filters,origin);
 if(prepared.rows.length>MAPEIG_EXPORT_MAX_ROWS)throw new MapeigTooManyRowsError(prepared.rows.length);
 const today=now.toISOString().slice(0,10);
 const excluded=[prepared.excluded.province?`${prepared.excluded.province} línies excloses pel filtre de província.`:null,prepared.excluded.dateRange?`${prepared.excluded.dateRange} línies excloses pel filtre de data de concessió.`:null].filter((note):note is string=>!!note);
 const result=await buildMapeigWorkbook(prepared.rows,{filters,generatedAt:now.toISOString(),origin,extraColumns:prepared.extraColumns,catalogCodes:prepared.catalogCodes,notes:[...excluded,...prepared.notes]});
 return {...result,fileName:mapeigFilename(filters,today),preview:previewFromRows(prepared)};
}
