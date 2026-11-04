import {randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {FinancingType} from '@/lib/financing-types';
import {sha256} from '@/lib/source-storage';
import type {MapeigExportRecord,MapeigFilters,MapeigProvince} from './types';

export const MAPEIG_EXPORTS_BUCKET='mapeig-exports';
const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class MapeigHistoryError extends Error{constructor(message:string){super(message);this.name='MapeigHistoryError';}}
export class MapeigExportNotFoundError extends Error{constructor(){super('Aquesta exportació no és a l’històric.');this.name='MapeigExportNotFoundError';}}
type Row={id:string;created_at:string;file_name:string;financing_types:string[];provinces:string[]|null;year_from:number|null;year_to:number|null;row_count:number;total_cents:number|string;byte_size:number;sha256:string;storage_path:string;generated_by:string;note:string|null};
const COLUMNS='id,created_at,file_name,financing_types,provinces,year_from,year_to,row_count,total_cents,byte_size,sha256,storage_path,generated_by,note';
const toRecord=(row:Row):MapeigExportRecord=>({
 id:row.id,createdAt:row.created_at,fileName:row.file_name,
 financingTypes:row.financing_types as FinancingType[],provinces:row.provinces as MapeigProvince[]|null,yearFrom:row.year_from,yearTo:row.year_to,
 rowCount:row.row_count,totalCents:Number(row.total_cents),byteSize:row.byte_size,sha256:row.sha256,
 generatedBy:row.generated_by==='operator'?'operator':'web',note:row.note,
});
/** Older deployments can serve the page before the migration is applied. */
const missingTable=(error:{code?:string})=>error.code==='PGRST205'||error.code==='42P01';

export type MapeigExportInput={
 bytes:Uint8Array;sha256:string;fileName:string;filters:MapeigFilters;
 rowCount:number;totalCents:number;summary:Record<string,unknown>;notes:readonly string[];
};
/** Archive the bytes exactly as served, verify them, then register the row.
 * The object is content-checked before the row exists, so a listed export
 * can always be downloaded again with the same identity. */
export async function saveMapeigExport(db:SupabaseClient,input:MapeigExportInput):Promise<MapeigExportRecord>{
 const bytes=Buffer.from(input.bytes);
 if(sha256(bytes)!==input.sha256)throw new MapeigHistoryError('La identitat del fitxer no coincideix amb els bytes generats.');
 const id=randomUUID(),path=`${id}/${input.fileName}`;
 const storage=db.storage.from(MAPEIG_EXPORTS_BUCKET);
 const uploaded=await storage.upload(path,bytes,{contentType:XLSX_MIME,upsert:false});
 if(uploaded.error)throw new MapeigHistoryError(`No s’ha pogut arxivar el fitxer (${uploaded.error.message}).`);
 const stored=await storage.download(path);
 if(stored.error||!stored.data||sha256(Buffer.from(await stored.data.arrayBuffer()))!==input.sha256){
  await storage.remove([path]).catch(()=>undefined);
  throw new MapeigHistoryError('El fitxer arxivat no supera la verificació d’integritat.');
 }
 const inserted=await db.from('mapeig_exports').insert({
  id,file_name:input.fileName,financing_types:input.filters.financingTypes,provinces:input.filters.provinces,
  year_from:input.filters.yearFrom,year_to:input.filters.yearTo,row_count:input.rowCount,total_cents:input.totalCents,
  byte_size:bytes.length,sha256:input.sha256,storage_path:path,summary:input.summary,notes:[...input.notes],generated_by:'web',
 }).select(COLUMNS).single<Row>();
 if(inserted.error||!inserted.data){
  await storage.remove([path]).catch(()=>undefined);
  throw new MapeigHistoryError(`No s’ha pogut registrar l’exportació (${inserted.error?.message??'sense dades'}).`);
 }
 return toRecord(inserted.data);
}
export async function listMapeigExports(db:SupabaseClient,limit=500):Promise<MapeigExportRecord[]>{
 const result=await db.from('mapeig_exports').select(COLUMNS).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(limit).returns<Row[]>();
 if(result.error){if(missingTable(result.error))return [];throw result.error;}
 return (result.data??[]).map(toRecord);
}
/** The archived bytes are verified against the row before being served. */
export async function readMapeigExport(db:SupabaseClient,id:string):Promise<{record:MapeigExportRecord;bytes:Buffer}>{
 if(!UUID.test(id))throw new MapeigExportNotFoundError();
 const result=await db.from('mapeig_exports').select(COLUMNS).eq('id',id).maybeSingle<Row>();
 if(result.error){if(missingTable(result.error))throw new MapeigExportNotFoundError();throw result.error;}
 if(!result.data)throw new MapeigExportNotFoundError();
 const stored=await db.storage.from(MAPEIG_EXPORTS_BUCKET).download(result.data.storage_path);
 if(stored.error||!stored.data)throw new MapeigHistoryError('El fitxer arxivat no està disponible a Storage.');
 const bytes=Buffer.from(await stored.data.arrayBuffer());
 if(sha256(bytes)!==result.data.sha256)throw new MapeigHistoryError('El fitxer arxivat no supera la verificació d’integritat.');
 return {record:toRecord(result.data),bytes};
}
