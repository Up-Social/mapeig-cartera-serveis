import type {ExportRowProvider} from '../types';
import {loadConcertMapeigData} from './concert-data';
import {CONCERT_EXTRA_COLUMNS,concertRowsFromData} from './concert-rows';

export const concertRowProvider:ExportRowProvider={
 financingType:'concert',
 extraColumns:CONCERT_EXTRA_COLUMNS,
 async load(db,context){
  const data=await loadConcertMapeigData(db,{awardDateMode:process.env.MAPEIG_AWARD_DATE_MODE==='stored'?'stored':'printed'});
  return concertRowsFromData(data,{origin:context.origin,catalogCodes:context.catalogCodes});
 },
};
