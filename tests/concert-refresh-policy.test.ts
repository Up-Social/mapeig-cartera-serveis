import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isConcertRefreshNavigationDocument} from '../lib/concerts/refresh-policy';

test('identified generic navigation stays outside documentary evidence refresh', () => {
  for (const flag of ['generic_portal', 'javascript_shell']) {
    assert.equal(isConcertRefreshNavigationDocument({document_type:'other',quality_flags:[flag]}),true);
    assert.equal(isConcertRefreshNavigationDocument({document_type:'other',quality_flags:['incomplete_extraction',flag]}),true);
  }
});

test('substantive and unclassified documents cannot be skipped as navigation', () => {
  for (const document_type of ['publication','annex','resolution',null,undefined,'']) {
    assert.equal(isConcertRefreshNavigationDocument({document_type,quality_flags:['generic_portal','javascript_shell']}),false);
  }
});

test('missing fields, corruption and incomplete extraction never justify skipping a document', () => {
  for (const quality_flags of [null,undefined,[],['corrupt_text'],['incomplete_extraction'],['short_text'],['corrupt_text','incomplete_extraction']]) {
    assert.equal(isConcertRefreshNavigationDocument({document_type:'other',quality_flags}),false);
  }
});
