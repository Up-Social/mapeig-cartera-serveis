import {FINANCING_TYPES,FINANCING_TYPE_LABELS,type FinancingType} from '@/lib/financing-types';
import {MAPEIG_AVAILABLE_TYPES,MAPEIG_PROVINCES,MapeigFilterError,type DetallRegistresRow,type MapeigFilters,type MapeigProvince} from './types';

const ISO=/^\d{4}-\d{2}-\d{2}$/;
const isCalendarDate=(value:string)=>ISO.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
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
 const from=one(input,'from'),to=one(input,'to');
 if(from&&!isCalendarDate(from))throw new MapeigFilterError('La data «des de» no és vàlida.');
 if(to&&!isCalendarDate(to))throw new MapeigFilterError('La data «fins a» no és vàlida.');
 if(from&&to&&to<from)throw new MapeigFilterError('La data «fins a» ha de ser posterior o igual a la data «des de».');
 return {financingTypes:types as FinancingType[],provinces:provinces.length?provinces as MapeigProvince[]:null,awardDateFrom:from,awardDateTo:to};
}
export function mapeigFiltersToSearchParams(filters:MapeigFilters):URLSearchParams{
 const params=new URLSearchParams();
 for(const type of filters.financingTypes)params.append('type',type);
 for(const province of filters.provinces??[])params.append('province',province);
 if(filters.awardDateFrom)params.set('from',filters.awardDateFrom);
 if(filters.awardDateTo)params.set('to',filters.awardDateTo);
 return params;
}

/** A row is only excluded by a filter when it has the datum the filter reads.
 * Missing data is kept and annotated, never silently dropped. */
export function applyRowFilters(rows:readonly DetallRegistresRow[],filters:MapeigFilters):{rows:DetallRegistresRow[];excluded:{province:number;dateRange:number}}{
 const excluded={province:0,dateRange:0};
 const kept:DetallRegistresRow[]=[];
 for(const row of rows){
  if(filters.provinces&&row.province&&!filters.provinces.includes(row.province)){excluded.province+=1;continue;}
  if(row.awardDate&&((filters.awardDateFrom&&row.awardDate<filters.awardDateFrom)||(filters.awardDateTo&&row.awardDate>filters.awardDateTo))){excluded.dateRange+=1;continue;}
  const observations=[...row.observations];
  if(filters.provinces&&!row.province)observations.push('Província no identificada: no filtrada per territori');
  if((filters.awardDateFrom||filters.awardDateTo)&&!row.awardDate)observations.push('Data de concessió no identificada: no filtrada pel període');
  kept.push(observations.length===row.observations.length?row:{...row,observations});
 }
 return {rows:kept,excluded};
}
