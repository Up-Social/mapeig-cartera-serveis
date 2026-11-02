import {FINANCING_TYPES,type FinancingType} from './financing-types';

/** A missing or ambiguous relationship does not identify the financing type. */
export function catalogSourceFinancingType(relation:unknown):FinancingType|null {
 const source=Array.isArray(relation)?relation.length===1?relation[0]:null:relation;
 if(!source||typeof source!=='object')return null;
 const value=(source as {financing_type?:unknown}).financing_type;
 return FINANCING_TYPES.find(type=>type===value)??null;
}

/** The notice is optional: an unavailable embed must not break the older
 * catalog query. Do not hide unrelated permission, transport or query errors. */
export async function catalogProvisionPage<T>(read:(withSource:boolean)=>PromiseLike<{data:T[]|null;error:unknown}>) {
 const result=await read(true);
 const error=result.error as {code?:unknown;message?:unknown;details?:unknown}|null;
 const detail=`${error?.message??''} ${error?.details??''}`;
 if(error&&((['PGRST200','PGRST201'].includes(String(error.code))&&detail.includes('source_records'))
  ||error.code==='42703'&&detail.includes('financing_type')))return await read(false);
 return result;
}
