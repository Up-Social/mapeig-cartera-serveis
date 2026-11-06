import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MAX_PDF_BYTES,DocumentTooLargeError} from '../lib/pipeline/document-input';
import {ARCHIVE_DOCUMENT_MAX_BYTES,ARCHIVE_REQUEST_MAX_BYTES} from '../lib/convenis/archive-verification';
import {CloudFailure,failureMessage} from '../lib/cloud/errors';
import {documentIssueKind} from '../lib/cloud/document-issue';

test('a scanned official PDF of 28 MB fits the download and archive caps',()=>{
 assert.equal(MAX_PDF_BYTES,40*1024*1024);
 assert.ok(28_095_042<MAX_PDF_BYTES);
 assert.equal(ARCHIVE_DOCUMENT_MAX_BYTES,MAX_PDF_BYTES);
 assert.ok(ARCHIVE_REQUEST_MAX_BYTES>=2*ARCHIVE_DOCUMENT_MAX_BYTES,'a request verifies a source and its copy');
});

test('an oversized PDF is explained instead of «Document no processable»',()=>{
 const error=new DocumentTooLargeError(MAX_PDF_BYTES);
 assert.ok(error instanceof Error);assert.equal(error.limitBytes,MAX_PDF_BYTES);
 const failure=new CloudFailure('document',5,{operation:'document_download',code:'DOCUMENT_TOO_LARGE'});
 assert.equal(documentIssueKind(failure),'document');
 const message=failureMessage(failure);
 assert.match(message,/40 MB/);
 assert.notEqual(message,failureMessage(new CloudFailure('document')));
});
