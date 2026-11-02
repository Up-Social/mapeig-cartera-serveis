import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {UnverifiedCandidateObservations} from '../components/unverified-candidate-observations';
import type {UnverifiedCandidateObservation} from '../lib/workbench-types';

test('observations retain text and evidence but expose no selection, link or approval',()=>{
 const observation:UnverifiedCandidateObservation={id:'synthetic',targetCode:'1.2',targetName:'<script>maliciós</script>',catalogVersionId:'version-anterior',rationale:'Justificació guardada',evidence:[{ordinal:2,content:'Fragment de prova',explanation:'Explicació guardada'}]};
 const before=JSON.stringify(observation),html=renderToStaticMarkup(createElement(UnverifiedCandidateObservations,{observations:[observation]}));
 assert.match(html,/Propostes conservades pendents de contrast/);assert.match(html,/no es poden seleccionar aquí/);
 assert.match(html,/1\.2/);assert.match(html,/version-anterior/);assert.match(html,/Justificació guardada/);assert.match(html,/Fragment de prova/);assert.match(html,/Explicació guardada/);
 assert.match(html,/&lt;script&gt;maliciós&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>|<a\b|<button\b|<input\b|<select\b/);
 assert.equal(JSON.stringify(observation),before);
});

test('an empty or unavailable set renders no section',()=>{
 for(const observations of [undefined,[]])assert.equal(renderToStaticMarkup(createElement(UnverifiedCandidateObservations,{observations})), '');
});
