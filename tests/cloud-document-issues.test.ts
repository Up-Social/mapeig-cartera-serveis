import assert from 'node:assert/strict';
import test from 'node:test';
import {CloudFailure} from '../lib/cloud/errors';
import {documentIssueKind} from '../lib/cloud/document-issue';
import {ArchivedSourceUnavailableError,SourceContentChangedError} from '../lib/source-storage';

test('changed or unavailable archived sources are isolated as document issues',()=>{
 assert.equal(documentIssueKind(new SourceContentChangedError('changed')),'source_changed');
 assert.equal(documentIssueKind(new ArchivedSourceUnavailableError('missing')),'archive_unavailable');
 assert.equal(documentIssueKind(new CloudFailure('document')),'document');
 assert.equal(documentIssueKind(new CloudFailure('credentials')),null);
 assert.equal(documentIssueKind(new Error('unknown')),null);
});
