import {FINANCING_TYPE_LABELS,type FinancingType} from '@/lib/financing-types';
import {MapeigUnavailableTypeError,type ExportRowProvider} from '../types';
import {concertRowProvider} from './concert';
import {conveniRowProvider} from './conveni';

/** One row provider per typology: Concerts and Convenis; the others are added
 * here when their mapping is agreed. */
export const MAPEIG_PROVIDERS:Partial<Record<FinancingType,ExportRowProvider>>={concert:concertRowProvider,conveni:conveniRowProvider};
export function providersFor(types:readonly FinancingType[]):ExportRowProvider[]{
 return types.map(type=>{
  const provider=MAPEIG_PROVIDERS[type];
  if(!provider)throw new MapeigUnavailableTypeError(`La tipologia «${FINANCING_TYPE_LABELS[type]}» encara no es pot exportar al Mapeig.`);
  return provider;
 });
}
