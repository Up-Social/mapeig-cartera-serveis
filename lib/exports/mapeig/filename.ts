import {MAPEIG_PROVINCES,MAPEIG_TYPE_LABELS,type MapeigFilters} from './types';

/** ASCII-only name that states what the file contains. */
export function mapeigFilename(filters:MapeigFilters,today:string):string{
 const types=filters.financingTypes.map(type=>MAPEIG_TYPE_LABELS[type]).join('+');
 const provinces=filters.provinces&&filters.provinces.length&&filters.provinces.length<MAPEIG_PROVINCES.length
  ?[...filters.provinces].sort((a,b)=>MAPEIG_PROVINCES.indexOf(a)-MAPEIG_PROVINCES.indexOf(b)).join('+'):'Catalunya';
 const period=filters.awardDateFrom&&filters.awardDateTo?`${filters.awardDateFrom}_${filters.awardDateTo}`
  :filters.awardDateFrom?`des-de-${filters.awardDateFrom}`:filters.awardDateTo?`fins-a-${filters.awardDateTo}`:'tot-el-periode';
 return `Mapeig-Cartera_${types}_${provinces}_${period}_${today}.xlsx`.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Za-z0-9._+-]/g,'-');
}
