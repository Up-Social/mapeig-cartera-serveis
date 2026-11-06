import {createHash} from 'node:crypto';
import {parsePdfSignatureDate} from './pdf-signature-date';
import {isUuid} from '../uuid';
import {MAX_PDF_BYTES} from '../pipeline/document-input';

export type ArchivedSignatureSource={id:string;source_record_id:string;storage_path:string|null;storage_sha256:string|null;status:string;mime_type:string|null};

/** Verify only bytes already retrieved from the exact canonical archive.
 * Never fetch a public URL, recover a missing archive, or change a record. */
export async function verifyArchivedConcertSignature(
 source:ArchivedSignatureSource, recordId:string, expectedSha:string,
 read:(path:string)=>Promise<Uint8Array>, pdfsig:(bytes:Uint8Array)=>Promise<string>,
){
 if(!isUuid(recordId)||!isUuid(source.id)||source.source_record_id!==recordId||source.status!=='fetched'||source.mime_type!=='application/pdf'||
  !/^[a-f0-9]{64}$/.test(expectedSha)||source.storage_sha256!==expectedSha||
  source.storage_path!==`cases/${recordId}/documents/${source.id}/${expectedSha}.pdf`)
  throw Error('ARCHIVE_IDENTITY_MISMATCH');
 const bytes=await read(source.storage_path);
 if(bytes.byteLength<5||bytes.byteLength>MAX_PDF_BYTES||Buffer.from(bytes.subarray(0,5)).toString()!=='%PDF-'||
  createHash('sha256').update(bytes).digest('hex')!==expectedSha)throw Error('ARCHIVE_BYTES_MISMATCH');
 const observation=parsePdfSignatureDate(await pdfsig(bytes));
 if(!observation)throw Error('SIGNATURE_NOT_UNAMBIGUOUS');
 return {recordId,documentId:source.id,documentSha256:expectedSha,verificationMethod:'pdfsig-full-document-v1',...observation};
}
