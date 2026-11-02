import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyArchivedConcertSignature} from '../lib/concerts/archived-signature-verification';

const bytes=Buffer.from('%PDF-test');
const hash=createHash('sha256').update(bytes).digest('hex');
const recordId='4e96594b-3582-4f4f-9a30-2d77884564ab',docId='bc7642d8-36b0-468f-82e4-ec098ce299de';
const source={id:docId,source_record_id:recordId,storage_path:`cases/${recordId}/documents/${docId}/${hash}.pdf`,storage_sha256:hash,status:'fetched',mime_type:'application/pdf'};
const signed='Signature #1:\n  - Signing Time: Feb 29 2024 15:02:19\n  - Total document signed\n  - Signature Validation: Signature is Valid.\n  - Certificate Validation: Certificate issuer isn\'t Trusted.\n';
test('checks the canonical archive and binds observation to its SHA',async()=>{
 const observed=await verifyArchivedConcertSignature(source,recordId,hash,async()=>bytes,async()=>signed);
 assert.equal(observed.documentSha256,hash);assert.equal(observed.localDate,'2024-02-29');assert.equal(observed.certificateTrust,'untrusted');
});
test('does not run pdfsig for the wrong path or different bytes',async()=>{
 let invoked=false;const sign=async()=>{invoked=true;return signed;};
 await assert.rejects(verifyArchivedConcertSignature({...source,storage_path:'wrong'},recordId,hash,async()=>bytes,sign),/ARCHIVE_IDENTITY_MISMATCH/);
 await assert.rejects(verifyArchivedConcertSignature(source,recordId,hash,async()=>Buffer.from('%PDF-other'),sign),/ARCHIVE_BYTES_MISMATCH/);
 assert.equal(invoked,false);
});
test('preserves ambiguity rather than producing a date',async()=>{
 await assert.rejects(verifyArchivedConcertSignature(source,recordId,hash,async()=>bytes,async()=>signed+'Signature #2:\n'),/SIGNATURE_NOT_UNAMBIGUOUS/);
});
