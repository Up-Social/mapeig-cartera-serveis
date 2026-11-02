import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {fetchOfficialDocument} from './pipeline/official-resolution';
import {retryDeduplicationTransaction} from './pipeline/import-source-upsert';

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

/** Reuse the bytes read for integrity verification; do not download the same object again to serve it. */
async function archiveAndReadSource(db:SupabaseClient,document:Source,input?:Bytes){
 // Bind the archive and compare-and-swap to the caller's values before any
 // asynchronous I/O. Buffers and plain objects remain mutable across awaits.
 document={...document};
 if(input)input={bytes:Buffer.from(input.bytes),mimeType:input.mimeType};
 // Older callers may pass only identity and URL. Resolve the current pointer
 // first so their upload cannot overwrite an archive created concurrently.
 if(document.storage_path===undefined||document.storage_sha256===undefined){
  const current=await db.from('source_documents').select('storage_path,storage_sha256,content_hash').eq('id',document.id).eq('source_record_id',document.source_record_id).single();
  if(current.error||!current.data)throw current.error??Error('Document no disponible');
  if(!('storage_path' in current.data)||!('storage_sha256' in current.data))throw new ArchivedSourceUnavailableError('No es pot verificar la referència arxivada del document');
  document={...document,storage_path:current.data.storage_path,storage_sha256:current.data.storage_sha256,content_hash:current.data.content_hash??document.content_hash};
 }
 // Any existing pointer must be a complete, canonical identity. A legacy or
 // malformed pointer cannot be replaced by a fresh download merely because a
 // separate extraction hash happens to match; reconcile it explicitly first.
 if((document.storage_path!==null||document.storage_sha256!==null)&&!validSourcePath(document))
  throw new ArchivedSourceUnavailableError('La referència arxivada és incompleta o no verificable; cal revisar-la abans de substituir-la');
 if(document.storage_path&&document.storage_sha256&&validSourcePath(document)){
  if(await objectExists(db,document.storage_path)){
   const bytes=await verifyStoredObject(db,document.storage_path,document.storage_sha256);
   if(input&&sha256(input.bytes)!==document.storage_sha256)throw new SourceContentChangedError('La font descarregada no coincideix amb la còpia arxivada; cal revisar-la abans d’extreure dades');
   if(document.content_hash&&document.content_hash!==document.storage_sha256&&document.content_hash!==sha256(Buffer.from(bytes.toString('base64'))))throw new SourceContentChangedError('La identitat de l’extracció no coincideix amb la còpia arxivada; cal revisar-la');
   return {path:document.storage_path,sha256:document.storage_sha256,mimeType:document.mime_type??mimeForPath(document.storage_path),bytes};
  }
 }
 const fetched=input??await fetchOfficialDocument(document.url);
 const bytes=fetched.bytes;
 const digest=sha256(bytes);
 // A missing archived object may be recovered, but its original byte identity must not change.
 if(validSourcePath(document)&&digest!==document.storage_sha256)
  throw new SourceContentChangedError('La font ha canviat respecte de la còpia arxivada; cal tornar-la a processar');
 // Historical pipelines used both a byte hash and a base64-text hash.
 if(document.content_hash&&document.content_hash!==digest&&document.content_hash!==sha256(Buffer.from(bytes.toString('base64'))))
  throw new SourceContentChangedError('La font ha canviat des de l’extracció; cal tornar-la a processar');
 const path=sourcePath(document.source_record_id,document.id,digest,fetched.mimeType,bytes);
 if(!await objectExists(db,path)){
  const uploaded=await db.storage.from(SOURCE_BUCKET).upload(path,bytes,{contentType:fetched.mimeType,upsert:false});
  if(uploaded.error&&!await objectExists(db,path))throw uploaded.error;
 }
 const storedBytes=await verifyStoredObject(db,path,digest);
 let update=db.from('source_documents').update({storage_path:path,storage_sha256:digest,storage_captured_at:new Date().toISOString(),mime_type:fetched.mimeType,byte_size:bytes.length})
  .eq('id',document.id).eq('source_record_id',document.source_record_id).eq('url',document.url);
 if(document.storage_path!==undefined)update=document.storage_path===null?update.is('storage_path',null):update.eq('storage_path',document.storage_path);
 if(document.storage_sha256!==undefined)update=document.storage_sha256===null?update.is('storage_sha256',null):update.eq('storage_sha256',document.storage_sha256);
 if(document.content_hash!==undefined)update=document.content_hash===null?update.is('content_hash',null):update.eq('content_hash',document.content_hash);
 const updated=await update.select('id').single();
 if(updated.error||!updated.data)throw updated.error??Error('No s’ha pogut vincular la còpia al document');
 return {path,sha256:digest,mimeType:fetched.mimeType,bytes:storedBytes};
}

/** Durable source bytes are written before a document is marked fetched. A retry is idempotent. */
export async function archiveSource(db:SupabaseClient,document:Source,input?:Bytes){
 const {path,sha256,mimeType}=await archiveAndReadSource(db,document,input);
 return {path,sha256,mimeType};
}

/** Download a case source only after it is archived, and verify the bytes being served. */
export async function readSource(db:SupabaseClient,document:Source,input?:Bytes){
 return archiveAndReadSource(db,document,input);
}

/** Scoped to one bounded processing pass; never share across tasks or resumes. */
export function createUnitSourceVerificationCache(){return new Set<string>();}

/** Every generated unit gets its own immutable object and a DB pointer to it. */
export async function archiveUnitSource(db:SupabaseClient,recordId:string,unitId:string,verifiedSources?:Set<string>){
 const unit=await db.from('record_units').select('id,source_record_id,document_id,storage_path,storage_sha256').eq('id',unitId).eq('source_record_id',recordId).single();
 if(unit.error||!unit.data?.document_id)throw unit.error??Error('Unitat sense document');
 const doc=await db.from('source_documents').select('id,source_record_id,url,content_hash,storage_path,storage_sha256,mime_type').eq('id',unit.data.document_id).eq('source_record_id',recordId).single();
 if(doc.error||!doc.data)throw doc.error??Error('Document no disponible');
 const identity=JSON.stringify([doc.data.id,doc.data.source_record_id,doc.data.url,doc.data.storage_path,doc.data.storage_sha256,doc.data.content_hash??null]);
 let source:{path:string;sha256:string};
 if(verifiedSources?.has(identity)&&validSourcePath(doc.data))source={path:doc.data.storage_path!,sha256:doc.data.storage_sha256!};
 else {
  source=await readSource(db,doc.data);
  // Do not cache recovery from a missing pointer under its old identity.
  if(validSourcePath(doc.data)&&doc.data.storage_path===source.path&&doc.data.storage_sha256===source.sha256)verifiedSources?.add(identity);
 }
 const path=itemSourcePath(recordId,unitId,doc.data.id,source.path);
 if((unit.data.storage_path&&unit.data.storage_path!==path)||(unit.data.storage_sha256&&unit.data.storage_sha256!==source.sha256))
  throw new SourceContentChangedError('La unitat ja conserva una còpia diferent; cal revisar la nova font abans de substituir-la');
 const storage=db.storage.from(SOURCE_BUCKET);
 if(!await objectExists(db,path)){
  const copy=await storage.copy(source.path,path);
  // A concurrent attempt may have created the same content-addressed target,
  // or the response may have been lost. Do not discard that object: verify its
  // bytes below and let publish_unit_source compare the current DB pointers.
  if(copy.error&&!await objectExists(db,path))throw copy.error;
 }
 if(!await objectExists(db,path))throw Error('Còpia de la unitat absent');
 const copied=await storage.download(path);
 if(copied.error||!copied.data||sha256(Buffer.from(await copied.data.arrayBuffer()))!==source.sha256)
  throw new ArchivedSourceUnavailableError('La còpia de la unitat no supera la verificació d’integritat');
 const updated=await db.rpc('publish_unit_source',{p_record:recordId,p_unit:unitId,p_document:doc.data.id,
  p_source_url:doc.data.url,p_source_path:source.path,p_source_sha256:source.sha256,p_content_hash:doc.data.content_hash??null,
  p_previous_path:unit.data.storage_path??null,p_previous_sha256:unit.data.storage_sha256??null,p_new_path:path,p_new_sha256:source.sha256});
 if(updated.error||updated.data!==unitId)throw updated.error??Error('No s’ha pogut vincular la còpia a la unitat');
 return {path,sha256:source.sha256,documentId:doc.data.id};
}

type ImportedSourceRow={source_dataset:string;source_record_id:string;source_file:string;source_sheet:string;source_row:number;source_payload:Record<string,unknown>;source_payload_hash:string};
async function importedSourcePrevious(db:SupabaseClient,id:string,runId:string|null){
 let query=db.from('source_records').select('storage_path,storage_sha256').eq('id',id);
 query=runId===null?query.is('import_run_id',null):query.eq('import_run_id',runId);
 const current=await query.maybeSingle();
 if(current.error||!current.data)throw current.error??new SourceContentChangedError('La fila importada ha canviat abans d’arxivar la font');
 return {storage_path:current.data.storage_path??null,storage_sha256:current.data.storage_sha256??null};
}
async function publishImportedSource(db:SupabaseClient,id:string,runId:string|null,row:ImportedSourceRow,previous:{storage_path:string|null;storage_sha256:string|null},archive:{path:string;sha256:string},path:string,digest:string){
 const expected={source_dataset:row.source_dataset,source_record_id:row.source_record_id,source_file:row.source_file,source_sheet:row.source_sheet,source_row:row.source_row,source_payload:row.source_payload,source_payload_hash:row.source_payload_hash,import_run_id:runId};
 let result;
 try {result=await retryDeduplicationTransaction(()=>db.rpc('publish_import_source',{p_record:id,p_expected:expected,p_previous:previous,p_archive:archive,p_path:path,p_sha256:digest}));}
 catch(error){const e=error as {code?:unknown;message?:unknown};if(e?.code==='55P03'&&e.message==='IMPORT_SOURCE_BUSY')throw Error('La referència de la font està en modificació; torna-ho a provar.');throw error;}
 if(result.data!==true)throw new SourceContentChangedError('La fila o la còpia arxivada han canviat; no s’ha modificat la referència');
}

function assertPreviousImportSource(id:string,runId:string|null,previous:{storage_path:string|null;storage_sha256:string|null},path:string,digest:string){
 if(previous.storage_path===null&&previous.storage_sha256===null)return;
 if(previous.storage_path===path&&previous.storage_sha256===digest)return;
 if(runId===null||!previous.storage_path||!previous.storage_sha256||!/^[0-9a-f]{64}$/.test(previous.storage_sha256))throw new SourceContentChangedError('La font ja conserva una còpia diferent; cal revisar-la');
 const prefix=`cases/${id}/imports/`,parts=previous.storage_path.slice(prefix.length).split('/');
 if(!previous.storage_path.startsWith(prefix)||parts.length!==2||parts[0]===runId||!(parts[0]==='legacy'||/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(parts[0]))||parts[1]!==`${previous.storage_sha256}.json`)
  throw new SourceContentChangedError('La font ja conserva una còpia diferent; cal revisar-la');
}

/** An import run owns its workbook snapshot; rows identify the workbook through import_run_id. */
export async function archiveImportWorkbook(db:SupabaseClient,runId:string,fileName:string,bytes:Buffer){
 bytes=Buffer.from(bytes);
 const digest=sha256(bytes),path=`imports/${runId}/${digest}.xlsx`;
 const run=await db.from('import_runs').select('storage_manifest').eq('id',runId).single();if(run.error||!run.data)throw run.error??Error('Importació no disponible');
 const manifest=run.data.storage_manifest;
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))throw Error('Manifest d’importació invàlid');
 const present=Object.prototype.hasOwnProperty.call(manifest,fileName);const existing=present?manifest[fileName]:null;
 if(present&&(!existing||typeof existing!=='object'||existing.bucket!==SOURCE_BUCKET||existing.path!==path||existing.sha256!==digest||existing.byte_size!==bytes.length))throw new SourceContentChangedError('El llibre ja està arxivat amb una altra identitat; cal revisar-lo');
 if(!await objectExists(db,path)){
  const uploaded=await db.storage.from(SOURCE_BUCKET).upload(path,bytes,{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',upsert:false});
  if(uploaded.error&&!await objectExists(db,path))throw uploaded.error;
 }
 await verifyStoredObject(db,path,digest);
 if(!present){
  const published=await db.rpc('publish_import_workbook',{p_run:runId,p_file:fileName,p_path:path,p_sha256:digest,p_size:bytes.length});
  if(published.error){if(published.error.code==='55P03'&&published.error.message==='IMPORT_WORKBOOK_BUSY')throw Error('El manifest del llibre està en modificació; torna-ho a provar.');throw published.error;}
  if(published.data!==true)throw new SourceContentChangedError('El manifest del llibre ha canviat; no s’ha modificat la referència');
 }
 return {path,sha256:digest};
}

export async function archiveImportedRow(db:SupabaseClient,recordId:string,runId:string,row:{source_dataset:string;source_record_id:string;source_file:string;source_sheet:string;source_row:number;source_payload:Record<string,unknown>;source_payload_hash:string},workbook:{path:string;sha256:string}){
 // The archived JSON and the CAS must describe the same immutable row, even
 // when the caller reuses or mutates the original payload during storage I/O.
 row=structuredClone(row);workbook={...workbook};
 const previous=await importedSourcePrevious(db,recordId,runId);
 const bytes=Buffer.from(JSON.stringify({record_id:recordId,import_run_id:runId,workbook,source_dataset:row.source_dataset,source_record_id:row.source_record_id,source_file:row.source_file,source_sheet:row.source_sheet,source_row:row.source_row,source_payload:row.source_payload,source_payload_hash:row.source_payload_hash}));
 const digest=sha256(bytes),path=`cases/${recordId}/imports/${runId}/${digest}.json`;
 assertPreviousImportSource(recordId,runId,previous,path,digest);
 if(!await objectExists(db,path)){
  const uploaded=await db.storage.from(SOURCE_BUCKET).upload(path,bytes,{contentType:'application/json',upsert:false});
  if(uploaded.error&&!await objectExists(db,path))throw uploaded.error;
 }
 await verifyStoredObject(db,path,digest);
 await publishImportedSource(db,recordId,runId,row,previous,workbook,path,digest);
 return {path,sha256:digest};
}

/** Historical books can be verified and archived without inventing an import run. */
export async function archiveHistoricalWorkbook(db:SupabaseClient,bytes:Buffer){
 bytes=Buffer.from(bytes);
 const digest=sha256(bytes),path=`imports/legacy/${digest}.xlsx`;
 if(!await objectExists(db,path)){
  const uploaded=await db.storage.from(SOURCE_BUCKET).upload(path,bytes,{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',upsert:false});
  if(uploaded.error&&!await objectExists(db,path))throw uploaded.error;
 }
 await verifyStoredObject(db,path,digest);
 return {path,sha256:digest};
}

export async function archiveHistoricalRow(db:SupabaseClient,row:{id:string;source_dataset:string;source_record_id:string;source_file:string;source_sheet:string;source_row:number;source_payload:Record<string,unknown>;source_payload_hash:string},workbook:{path:string;sha256:string}){
 row=structuredClone(row);workbook={...workbook};
 if(workbook.path!==`imports/legacy/${workbook.sha256}.xlsx`)throw Error('Llibre històric invàlid');
 const previous=await importedSourcePrevious(db,row.id,null);
 const bytes=Buffer.from(JSON.stringify({kind:'historical_reconciliation',record_id:row.id,workbook:{bucket:SOURCE_BUCKET,...workbook},source_dataset:row.source_dataset,source_record_id:row.source_record_id,source_file:row.source_file,source_sheet:row.source_sheet,source_row:row.source_row,source_payload:row.source_payload,source_payload_hash:row.source_payload_hash}));
 const digest=sha256(bytes),path=`cases/${row.id}/imports/legacy/${digest}.json`;
 assertPreviousImportSource(row.id,null,previous,path,digest);
 if(!await objectExists(db,path)){
  const uploaded=await db.storage.from(SOURCE_BUCKET).upload(path,bytes,{contentType:'application/json',upsert:false});
  if(uploaded.error&&!await objectExists(db,path))throw uploaded.error;
 }
 await verifyStoredObject(db,path,digest);
 await publishImportedSource(db,row.id,null,row,previous,workbook,path,digest);
 return {path,sha256:digest};
}

export async function archiveHistoricalApiReport(db:SupabaseClient,bytes:Buffer){
 bytes=Buffer.from(bytes);
 const digest=sha256(bytes),path=`imports/legacy/${digest}.json`;
 if(!await objectExists(db,path)){
  const uploaded=await db.storage.from(SOURCE_BUCKET).upload(path,bytes,{contentType:'application/json',upsert:false});
  if(uploaded.error&&!await objectExists(db,path))throw uploaded.error;
 }
 await verifyStoredObject(db,path,digest);
 return {path,sha256:digest};
}

export async function archiveHistoricalApiRow(db:SupabaseClient,row:{id:string;source_dataset:string;source_record_id:string;source_file:string;source_sheet:string;source_row:number;source_payload:Record<string,unknown>;source_payload_hash:string},report:{path:string;sha256:string}){
 row=structuredClone(row);report={...report};
 if(report.path!==`imports/legacy/${report.sha256}.json`||row.source_dataset!=='concerts')throw Error('Informe de descoberta invàlid');
 const previous=await importedSourcePrevious(db,row.id,null);
 const bytes=Buffer.from(JSON.stringify({kind:'historical_api_reconciliation',record_id:row.id,report:{bucket:SOURCE_BUCKET,...report},source_dataset:row.source_dataset,source_record_id:row.source_record_id,source_file:row.source_file,source_sheet:row.source_sheet,source_row:row.source_row,source_payload:row.source_payload,source_payload_hash:row.source_payload_hash}));
 const digest=sha256(bytes),path=`cases/${row.id}/imports/legacy/${digest}.json`;
 assertPreviousImportSource(row.id,null,previous,path,digest);
 if(!await objectExists(db,path)){
  const uploaded=await db.storage.from(SOURCE_BUCKET).upload(path,bytes,{contentType:'application/json',upsert:false});
  if(uploaded.error&&!await objectExists(db,path))throw uploaded.error;
 }
 await verifyStoredObject(db,path,digest);
 await publishImportedSource(db,row.id,null,row,previous,report,path,digest);
 return {path,sha256:digest};
}

export async function archiveHistoricalMasterRow(db:SupabaseClient,row:{id:string;source_file:string;source_sheet:string;source_row:number;source_payload:Record<string,unknown>;source_payload_hash:string},workbook:{path:string;sha256:string}){
 row=structuredClone(row);workbook={...workbook};
 if(workbook.path!==`imports/legacy/${workbook.sha256}.xlsx`)throw Error('Llibre mestre històric invàlid');
 const current=await db.from('master_services').select('storage_path,storage_sha256').eq('id',row.id).maybeSingle();
 if(current.error||!current.data)throw current.error??new SourceContentChangedError('La fila del Master ja no està disponible');
 const previous={storage_path:current.data.storage_path??null,storage_sha256:current.data.storage_sha256??null};
 const bytes=Buffer.from(JSON.stringify({kind:'historical_master_reconciliation',master_id:row.id,workbook:{bucket:SOURCE_BUCKET,...workbook},source_file:row.source_file,source_sheet:row.source_sheet,source_row:row.source_row,source_payload:row.source_payload,source_payload_hash:row.source_payload_hash}));
 const digest=sha256(bytes),path=`references/master/items/${row.id}/source/${digest}.json`;
 if((previous.storage_path!==null||previous.storage_sha256!==null)&&(previous.storage_path!==path||previous.storage_sha256!==digest))
  throw new SourceContentChangedError('La fila del Master ja conserva una còpia diferent; cal revisar-la');
 // The referenced workbook is part of this provenance; a plausible path alone
 // is not proof that its archived bytes exist and match the declared digest.
 await verifyStoredObject(db,workbook.path,workbook.sha256);
 if(!await objectExists(db,path)){
  const uploaded=await db.storage.from(SOURCE_BUCKET).upload(path,bytes,{contentType:'application/json',upsert:false});
  if(uploaded.error&&!await objectExists(db,path))throw uploaded.error;
 }
 await verifyStoredObject(db,path,digest);
 const expected={source_file:row.source_file,source_sheet:row.source_sheet,source_row:row.source_row,source_payload:row.source_payload,source_payload_hash:row.source_payload_hash};
 const updated=await db.rpc('publish_historical_master_source',{p_master:row.id,p_expected:expected,p_previous:previous,p_archive:workbook,p_path:path,p_sha256:digest});
 if(updated.error){if(updated.error.code==='55P03'&&updated.error.message==='MASTER_SOURCE_BUSY')throw Error('La fila del Master està en modificació; torna-ho a provar.');throw updated.error;}
 if(updated.data!==true)throw new SourceContentChangedError('La fila del Master o la seva còpia han canviat; no s’ha modificat la referència');
 return {path,sha256:digest};
}
