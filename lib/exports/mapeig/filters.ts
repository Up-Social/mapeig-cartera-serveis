import {FINANCING_TYPES,FINANCING_TYPE_LABELS,type FinancingType} from '@/lib/financing-types';
import {MAPEIG_AVAILABLE_TYPES,MAPEIG_PROVINCES,MapeigFilterError,type DetallRegistresRow,type MapeigFilters,type MapeigProvince} from './types';

const YEAR=/^\d{4}$/;
const parseYear=(value:string|null,label:string):number|null=>{
 if(!value)return null;
 if(!YEAR.test(value))throw new MapeigFilterError(`L’any «${label}» no és vàlid.`);
 const year=Number(value);
 if(year<1900||year>2200)throw new MapeigFilterError(`L’any «${label}» no és vàlid.`);
 return year;
};
type Input=URLSearchParams|Record<string,string|string[]|undefined>;
const values=(input:Input,key:string):string[]=>{
 if(input instanceof URLSearchParams)return input.getAll(key);
 const value=input[key];return value===undefined?[]:Array.isArray(value)?value:[value];
};
const one=(input:Input,key:string):string|null=>{const found=values(input,key).map(v=>v.trim()).filter(Boolean);return found.length?found[found.length-1]:null;};

/** One parser for the page and the route: what is previewed is what is downloaded. */
export function parseMapeigFilters(input:Input):MapeigFilters{
 const types=[...new Set(values(input,'type').map(v=>v.trim()).filter(Boolean))];
 if(!types.length)throw new MapeigFilterError('Cal indicar almenys una tipologia.');
 for(const type of types){
  if(!(FINANCING_TYPES as readonly string[]).includes(type))throw new MapeigFilterError(`Tipologia no vàlida: ${type}.`);
  if(!MAPEIG_AVAILABLE_TYPES.includes(type as FinancingType))throw new MapeigFilterError(`La tipologia «${FINANCING_TYPE_LABELS[type as FinancingType]}» encara no està disponible per exportar.`);
 }
 const provinces=[...new Set(values(input,'province').map(v=>v.trim()).filter(Boolean))];
 for(const province of provinces)if(!(MAPEIG_PROVINCES as readonly string[]).includes(province))throw new MapeigFilterError(`Província no vàlida: ${province}.`);
 const yearFrom=parseYear(one(input,'from'),'des de'),yearTo=parseYear(one(input,'to'),'fins a');
 if(yearFrom!==null&&yearTo!==null&&yearTo<yearFrom)throw new MapeigFilterError('L’any «fins a» ha de ser posterior o igual a l’any «des de».');
 return {financingTypes:types as FinancingType[],provinces:provinces.length?provinces as MapeigProvince[]:null,yearFrom,yearTo};
}
export function mapeigFiltersToSearchParams(filters:MapeigFilters):URLSearchParams{
 const params=new URLSearchParams();
 for(const type of filters.financingTypes)params.append('type',type);
 for(const province of filters.provinces??[])params.append('province',province);
 if(filters.yearFrom!==null)params.set('from',String(filters.yearFrom));
 if(filters.yearTo!==null)params.set('to',String(filters.yearTo));
 return params;
}

/** A row is only excluded by a filter when it has the datum the filter reads.
 * Missing data is kept and annotated, never silently dropped. */
export function applyRowFilters(rows:readonly DetallRegistresRow[],filters:MapeigFilters):{rows:DetallRegistresRow[];excluded:{province:number;dateRange:number}}{
 const excluded={province:0,dateRange:0};
 const kept:DetallRegistresRow[]=[];
 const byYear=filters.yearFrom!==null||filters.yearTo!==null;
 for(const row of rows){
  if(filters.provinces&&row.province&&!filters.provinces.includes(row.province)){excluded.province+=1;continue;}
  if(row.awardDate){
   const year=Number(row.awardDate.slice(0,4));
   if((filters.yearFrom!==null&&year<filters.yearFrom)||(filters.yearTo!==null&&year>filters.yearTo)){excluded.dateRange+=1;continue;}
  }
  const observations=[...row.observations];
  if(filters.provinces&&!row.province)observations.push('Província no identificada: no filtrada per territori');
  if(byYear&&!row.awardDate)observations.push('Data de concessió no identificada: no filtrada pel període');
  kept.push(observations.length===row.observations.length?row:{...row,observations});
 }
 return {rows:kept,excluded};
}
