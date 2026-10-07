import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {fetchOfficialDocument} from './pipeline/official-resolution';

export const SOURCE_BUCKET='cloud-documents';
type Source={id:string;source_record_id:string;url:string;content_hash?:string|null;storage_path?:string|null;storage_sha256?:string|null;mime_type?:string|null};
type Bytes={bytes:Buffer;mimeType:string};
export class SourceContentChangedError extends Error {}
export class ArchivedSourceUnavailableError extends Error {}
const extension=(mime:string,bytes:Buffer)=>bytes.subarray(0,4).toString()==='%PDF'||mime.includes('pdf')?'pdf':mime.includes('spreadsheet')?'xlsx':mime.includes('html')?'html':mime.includes('json')?'json':mime.includes('xml')?'xml':mime.startsWith('text/')?'txt':'bin';
const mimeForPath=(path:string)=>path.endsWith('.pdf')?'application/pdf':path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.txt')?'text/plain; charset=utf-8':path.endsWith('.json')?'application/json':path.endsWith('.xml')?'application/xml':path.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/octet-stream';
export const sha256=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function validSourcePath(document:Source){
 const prefix=`cases/${document.source_record_id}/documents/${document.id}/`;
 const filename=document.storage_path?.slice(prefix.length);
 return !!document.storage_path?.startsWith(prefix)&&!!document.storage_sha256&&/^[0-9a-f]{64}$/.test(document.storage_sha256)&&!!filename&&filename.startsWith(`${document.storage_sha256}.`)&&/^[a-z0-9]+$/.test(filename.slice(65));
}
export function sourcePath(recordId:string,documentId:string,digest:string,mime:string,bytes:Buffer){return `cases/${recordId}/documents/${documentId}/${digest}.${extension(mime,bytes)}`;}
export function itemSourcePath(recordId:string,unitId:string,documentId:string,canonicalPath:string){
 const filename=canonicalPath.split('/').at(-1);
 if(!filename||!/^([0-9a-f]{64})\.[a-z0-9]+$/.test(filename))throw Error('Ruta de font invàlida');
 return `cases/${recordId}/items/${unitId}/documents/${documentId}/${filename}`;
}
async function objectExists(db:SupabaseClient,path:string){
 const separator=path.lastIndexOf('/');
 const directory=path.slice(0,separator),filename=path.slice(separator+1);
 const listed=await db.storage.from(SOURCE_BUCKET).list(directory,{limit:100,search:filename});
 if(listed.error)throw listed.error;
 return listed.data.some(item=>item.name===filename);
}
async function verifyStoredObject(db:SupabaseClient,path:string,expectedHash:string){
 const stored=await db.storage.from(SOURCE_BUCKET).download(path);
 if(stored.error||!stored.data)throw new ArchivedSourceUnavailableError('La còpia arxivada no està disponible a Storage');
 const bytes=Buffer.from(await stored.data.arrayBuffer());
 if(sha256(bytes)!==expectedHash)throw new ArchivedSourceUnavailableError('La còpia arxivada no supera la verificació d’integritat');
 return bytes;
}

/** Durable source bytes are written before a document is marked fetched. A retry is idempotent. */
export async function archiveSource(db:SupabaseClient,document:Source,input?:Bytes){
 if(document.storage_path&&document.storage_sha256&&validSourcePath(document)){
  if(await objectExists(db,document.storage_path)){
   await verifyStoredObject(db,document.storage_path,document.storage_sha256);
   return {path:document.storage_path,sha256:document.storage_sha256,mimeType:document.mime_type??mimeForPath(document.storage_path)};
  }
 }
 const fetched=input??await fetchOfficialDocument(document.url);
 const bytes=fetched.bytes;
 const digest=sha256(bytes);
 // Historical pipelines used both a byte hash and a base64-text hash.
 if(document.content_hash&&document.content_hash!==digest&&document.content_hash!==sha256(Buffer.from(bytes.toString('base64'))))
  throw new SourceContentChangedError('La font ha canviat des de l’extracció; cal tornar-la a processar');
 const path=sourcePath(document.source_record_id,document.id,digest,fetched.mimeType,bytes);
 if(!await objectExists(db,path)){
  const uploaded=await db.storage.from(SOURCE_BUCKET).upload(path,bytes,{contentType:fetched.mimeType,upsert:false});
  if(uploaded.error&&!await objectExists(db,path))throw uploaded.error;
 }
 await verifyStoredObject(db,path,digest);
 const updated=await db.from('source_documents').update({storage_path:path,storage_sha256:digest,storage_captured_at:new Date().toISOString(),mime_type:fetched.mimeType,byte_size:bytes.length})
  .eq('id',document.id).eq('source_record_id',document.source_record_id).select('id').single();
 if(updated.error)throw updated.error;
 return {path,sha256:digest,mimeType:fetched.mimeType};
}

/** Download a case source only after it is archived, and verify the bytes being served. */
export async function readSource(db:SupabaseClient,document:Source,input?:Bytes){
 const archived=await archiveSource(db,document,input);
 const bytes=await verifyStoredObject(db,archived.path,archived.sha256);
 return {...archived,bytes};
}

/** Every generated unit gets its own immutable object and a DB pointer to it. */
export async function archiveUnitSource(db:SupabaseClient,recordId:string,unitId:string){
 const unit=await db.from('record_units').select('id,source_record_id,document_id,storage_path,storage_sha256').eq('id',unitId).eq('source_record_id',recordId).single();
 if(unit.error||!unit.data?.document_id)throw unit.error??Error('Unitat sense document');
 const doc=await db.from('source_documents').select('id,source_record_id,url,content_hash,storage_path,storage_sha256,mime_type').eq('id',unit.data.document_id).eq('source_record_id',recordId).single();
 if(doc.error||!doc.data)throw doc.error??Error('Document no disponible');
 const source=await readSource(db,doc.data);
 const path=itemSourcePath(recordId,unitId,doc.data.id,source.path);
 const storage=db.storage.from(SOURCE_BUCKET);
 if(!await objectExists(db,path)){const copy=await storage.copy(source.path,path);if(copy.error)throw copy.error;}
 if(!await objectExists(db,path))throw Error('Còpia de la unitat absent');
 const copied=await storage.download(path);
 if(copied.error||!copied.data||sha256(Buffer.from(await copied.data.arrayBuffer()))!==source.sha256)
  throw new ArchivedSourceUnavailableError('La còpia de la unitat no supera la verificació d’integritat');
 const updated=await db.from('record_units').update({storage_path:path,storage_sha256:source.sha256}).eq('id',unitId).eq('source_record_id',recordId);
 if(updated.error)throw updated.error;
 return {path,sha256:source.sha256,documentId:doc.data.id};
}

/** An import run owns its workbook snapshot; rows identify the workbook through import_run_id. */
export async function archiveImportWorkbook(db:SupabaseClient,runId:string,fileName:string,bytes:Buffer){
 const digest=sha256(bytes),path=`imports/${runId}/${digest}.xlsx`;
 if(!await objectExists(db,path)){
  const uploaded=await db.storage.from(SOURCE_BUCKET).upload(path,bytes,{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',upsert:false});
  if(uploaded.error)throw uploaded.error;
 }
 await verifyStoredObject(db,path,digest);
 const run=await db.from('import_runs').select('storage_manifest').eq('id',runId).single();if(run.error)throw run.error;
 const manifest={...(run.data.storage_manifest??{}),[fileName]:{bucket:SOURCE_BUCKET,path,sha256:digest,byte_size:bytes.length}};
 const updated=await db.from('import_runs').update({storage_manifest:manifest}).eq('id',runId);if(updated.error)throw updated.error;
 return {path,sha256:digest};
}

export async function archiveImportedRow(db:SupabaseClient,recordId:string,runId:string,row:{source_dataset:string;source_record_id:string;source_file:string;source_sheet:string;source_row:number;source_payload:Record<string,unknown>;source_payload_hash:string},workbook:{path:string;sha256:string}){
 const bytes=Buffer.from(JSON.stringify({record_id:recordId,import_run_id:runId,workbook,source_dataset:row.source_dataset,source_record_id:row.source_record_id,source_file:row.source_file,source_sheet:row.source_sheet,source_row:row.source_row,source_payload:row.source_payload,source_payload_hash:row.source_payload_hash}));
 const digest=sha256(bytes),path=`cases/${recordId}/imports/${runId}/${digest}.json`;
 if(!await objectExists(db,path)){
  const uploaded=await db.storage.from(SOURCE_BUCKET).upload(path,bytes,{contentType:'application/json',upsert:false});
  if(uploaded.error)throw uploaded.error;
 }
 await verifyStoredObject(db,path,digest);
 const updated=await db.from('source_records').update({storage_path:path,storage_sha256:digest}).eq('id',recordId).eq('import_run_id',runId);
 if(updated.error)throw updated.error;
 return {path,sha256:digest};
}

/** Historical books can be verified and archived without inventing an import run. */
export async function archiveHistoricalWorkbook(db:SupabaseClient,bytes:Buffer){
 const digest=sha256(bytes),path=`imports/legacy/${digest}.xlsx`;
 if(!await objectExists(db,path)){
  const uploaded=await db.storage.from(SOURCE_BUCKET).upload(path,bytes,{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',upsert:false});
  if(uploaded.error)throw uploaded.error;
 }
 await verifyStoredObject(db,path,digest);
 return {path,sha256:digest};
}

export async function archiveHistoricalRow(db:SupabaseClient,row:{id:string;source_dataset:string;source_record_id:string;source_file:string;source_sheet:string;source_row:number;source_payload:Record<string,unknown>;source_payload_hash:string},workbook:{path:string;sha256:string}){
 if(workbook.path!==`imports/legacy/${workbook.sha256}.xlsx`)throw Error('Llibre històric invàlid');
 const bytes=Buffer.from(JSON.stringify({kind:'historical_reconciliation',record_id:row.id,workbook:{bucket:SOURCE_BUCKET,...workbook},source_dataset:row.source_dataset,source_record_id:row.source_record_id,source_file:row.source_file,source_sheet:row.source_sheet,source_row:row.source_row,source_payload:row.source_payload,source_payload_hash:row.source_payload_hash}));
 const digest=sha256(bytes),path=`cases/${row.id}/imports/legacy/${digest}.json`;
 if(!await objectExists(db,path)){
  const uploaded=await db.storage.from(SOURCE_BUCKET).upload(path,bytes,{contentType:'application/json',upsert:false});
  if(uploaded.error)throw uploaded.error;
 }
 await verifyStoredObject(db,path,digest);
 const updated=await db.from('source_records').update({storage_path:path,storage_sha256:digest}).eq('id',row.id).is('import_run_id',null).eq('source_payload_hash',row.source_payload_hash);
 if(updated.error)throw updated.error;
 return {path,sha256:digest};
}

export async function archiveHistoricalApiReport(db:SupabaseClient,bytes:Buffer){
 const digest=sha256(bytes),path=`imports/legacy/${digest}.json`;
 if(!await objectExists(db,path)){
  const uploaded=await db.storage.from(SOURCE_BUCKET).upload(path,bytes,{contentType:'application/json',upsert:false});
  if(uploaded.error)throw uploaded.error;
 }
 await verifyStoredObject(db,path,digest);
 return {path,sha256:digest};
}

export async function archiveHistoricalApiRow(db:SupabaseClient,row:{id:string;source_dataset:string;source_record_id:string;source_file:string;source_sheet:string;source_row:number;source_payload:Record<string,unknown>;source_payload_hash:string},report:{path:string;sha256:string}){
 if(report.path!==`imports/legacy/${report.sha256}.json`)throw Error('Informe de descoberta invàlid');
 const bytes=Buffer.from(JSON.stringify({kind:'historical_api_reconciliation',record_id:row.id,report:{bucket:SOURCE_BUCKET,...report},source_dataset:row.source_dataset,source_record_id:row.source_record_id,source_file:row.source_file,source_sheet:row.source_sheet,source_row:row.source_row,source_payload:row.source_payload,source_payload_hash:row.source_payload_hash}));
 const digest=sha256(bytes),path=`cases/${row.id}/imports/legacy/${digest}.json`;
 if(!await objectExists(db,path)){
  const uploaded=await db.storage.from(SOURCE_BUCKET).upload(path,bytes,{contentType:'application/json',upsert:false});
  if(uploaded.error)throw uploaded.error;
 }
 await verifyStoredObject(db,path,digest);
 const updated=await db.from('source_records').update({storage_path:path,storage_sha256:digest}).eq('id',row.id).eq('source_dataset','concerts').is('import_run_id',null).eq('source_payload_hash',row.source_payload_hash);
 if(updated.error)throw updated.error;
 return {path,sha256:digest};
}

export async function archiveHistoricalMasterRow(db:SupabaseClient,row:{id:string;source_file:string;source_sheet:string;source_row:number;source_payload:Record<string,unknown>;source_payload_hash:string},workbook:{path:string;sha256:string}){
 if(workbook.path!==`imports/legacy/${workbook.sha256}.xlsx`)throw Error('Llibre mestre històric invàlid');
 const bytes=Buffer.from(JSON.stringify({kind:'historical_master_reconciliation',master_id:row.id,workbook:{bucket:SOURCE_BUCKET,...workbook},source_file:row.source_file,source_sheet:row.source_sheet,source_row:row.source_row,source_payload:row.source_payload,source_payload_hash:row.source_payload_hash}));
 const digest=sha256(bytes),path=`references/master/items/${row.id}/source/${digest}.json`;
 if(!await objectExists(db,path)){
  const uploaded=await db.storage.from(SOURCE_BUCKET).upload(path,bytes,{contentType:'application/json',upsert:false});
  if(uploaded.error)throw uploaded.error;
 }
 await verifyStoredObject(db,path,digest);
 const updated=await db.from('master_services').update({storage_path:path,storage_sha256:digest}).eq('id',row.id).eq('source_payload_hash',row.source_payload_hash);
 if(updated.error)throw updated.error;
 return {path,sha256:digest};
}
