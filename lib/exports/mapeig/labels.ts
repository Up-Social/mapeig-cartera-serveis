import {MAPEIG_PROVINCES,MAPEIG_TYPE_LABELS,type MapeigFilters} from './types';

type Period=Pick<MapeigFilters,'yearFrom'|'yearTo'>;
/** Catalan wording shared by the page, the history and the workbook notes. */
export const periodLabel=({yearFrom,yearTo}:Period):string=>
 yearFrom!==null&&yearTo!==null?(yearFrom===yearTo?String(yearFrom):`${yearFrom}–${yearTo}`)
 :yearFrom!==null?`des de ${yearFrom}`:yearTo!==null?`fins a ${yearTo}`:'tots els anys';
export const provincesLabel=(provinces:MapeigFilters['provinces']):string=>
 provinces&&provinces.length&&provinces.length<MAPEIG_PROVINCES.length
  ?[...provinces].sort((a,b)=>MAPEIG_PROVINCES.indexOf(a)-MAPEIG_PROVINCES.indexOf(b)).join(', '):'Catalunya';
export const typesLabel=(types:MapeigFilters['financingTypes']):string=>types.map(type=>MAPEIG_TYPE_LABELS[type]).join(', ');
