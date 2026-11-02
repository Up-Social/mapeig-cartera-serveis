import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historicalCanStart,historicalFeatureUnavailable,historicalProcessingPaused} from '../lib/concerts/historical-status-ui';
test('the disabled message reflects the server feature flag only before start',()=>{
 assert.equal(historicalFeatureUnavailable({state:'not_started',feature_enabled:false}),true);
 assert.equal(historicalFeatureUnavailable({state:'not_started',feature_enabled:true}),false);
 assert.equal(historicalFeatureUnavailable({state:'not_started'}),true);
 assert.equal(historicalFeatureUnavailable({state:'disabled',feature_enabled:false}),true);
 assert.equal(historicalFeatureUnavailable({state:'completed',feature_enabled:false}),false);
});
test('recovery progress describes imports rather than human review',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile('app/admin/concert-history-setting.tsx','utf8');
 assert.match(source,/Registres incorporats o ja existents:/);
 assert.doesNotMatch(source,/Registres revisats:/);
});

test('a stopped or unavailable processing switch cannot enable historical recovery',()=>{
 assert.equal(historicalCanStart({state:'not_started',featureEnabled:true,processingEnabled:false}),false);
 assert.equal(historicalCanStart({state:'not_started',featureEnabled:true,processingEnabled:true}),true);
 assert.equal(historicalCanStart({state:'completed',featureEnabled:true,processingEnabled:true}),false);
 assert.equal(historicalProcessingPaused({state:'not_started',feature_enabled:true,processing_enabled:false}),true);
 assert.equal(historicalProcessingPaused({state:'not_started',feature_enabled:true}),true);
 assert.equal(historicalProcessingPaused({state:'not_started',feature_enabled:false,processing_enabled:false}),false);
});

test('an uncertain recovery clearly requires technical review and never promises auto-resume',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile('app/admin/concert-history-setting.tsx','utf8');
 assert.match(source,/no es reprendrà automàticament/);
 assert.match(source,/cal una revisió tècnica abans de continuar/);
});
