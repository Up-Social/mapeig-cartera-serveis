import type {ExportRowProvider} from '../types';
import {loadConveniMapeigData} from './conveni-data';
import {CONVENI_EXTRA_COLUMNS,conveniRowsFromData} from './conveni-rows';

export const conveniRowProvider:ExportRowProvider={
 financingType:'conveni',
 extraColumns:CONVENI_EXTRA_COLUMNS,
 async load(db,context){
  return conveniRowsFromData(await loadConveniMapeigData(db),{origin:context.origin,catalogCodes:context.catalogCodes});
 },
};
