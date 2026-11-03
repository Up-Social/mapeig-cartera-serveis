import assert from 'node:assert/strict';
import test from 'node:test';
import {isAuxiliaryPortalPage} from '../lib/portal-text';

test('an e-TAULER landing page is auxiliary provenance, not evidence',()=>{
 assert.equal(isAuxiliaryPortalPage({documentType:'other',qualityFlags:['short_text','basic_html_extraction','generic_portal'],extractedText:'e-TAULER - Consorci Administració Oberta de Catalunya'}),true);
 assert.equal(isAuxiliaryPortalPage({documentType:'other',qualityFlags:[],textPreview:'e-TAULER - Consorci Administració Oberta de Catalunya'}),true);
});

test('publications and corrupt pages are not hidden as auxiliary',()=>{
 assert.equal(isAuxiliaryPortalPage({documentType:'publication',qualityFlags:['generic_portal'],extractedText:'e-TAULER'}),false);
 assert.equal(isAuxiliaryPortalPage({documentType:'other',qualityFlags:['corrupt_text','generic_portal'],extractedText:'x'}),false);
 assert.equal(isAuxiliaryPortalPage({documentType:'other',qualityFlags:['short_text'],extractedText:'RESOLUCIÓ de provisió'}),false);
});
