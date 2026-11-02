import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {prepareS16GeographySql} from '../lib/concerts/s16-geography-sql';
import {S16_DOCUMENT_SHA,S16_SOURCE_URL,sha} from '../lib/concerts/s16-geography-dry-run';

const path='docs/local/concert-e2e-2026-11-02/S1-6-convocatoria-geografia.html';
const html=existsSync(path)?readFileSync(path):Buffer.alloc(0);
const preflight={mode:'dry-run-read-only',project:'vvzxlevbfjvzygorbpxn',record:'cf3e157d-d29b-4c01-96ab-42f6e4a04e18',document:'0566ccec-3205-4871-8001-3abee31fd070',documentSha256:S16_DOCUMENT_SHA,sourceUrl:S16_SOURCE_URL,sourceSha256:sha(html),proposals:[
 {unit:'45fd04f2-500a-42c6-a0ac-89037b0cd839',service:'EVAMI',economicSourceFingerprint:'a'.repeat(32)},
 {unit:'f17be3d5-98dc-4ca7-8645-e4f1a007e82f',service:'ETCA',economicSourceFingerprint:'b'.repeat(32)}]};
test('prepara una transacció única amb ambdues fonts i comprovació de les dues petjades',{skip:!html.length},()=>{
 const sql=prepareS16GeographySql(preflight,html,html,'2026-11-02T12:00:00.000Z');
 assert.match(sql,/begin;[\s\S]+for update;[\s\S]+commit;/);
 assert.equal((sql.match(/perform public\.propose_concert_supplemental_geography/g)??[]).length,2);
 assert.match(sql,/md5\(to_jsonb\(u\)::text\)/);assert.match(sql,/md5\(jsonb_build_array/);
 assert.match(sql,/CANDIDATO NO EJECUTADO/);
});
test('no prepara si canvia la font, el projecte o la identitat revisada',{skip:!html.length},()=>{
 assert.throws(()=>prepareS16GeographySql({...preflight,project:'another'},html,html,'2026-11-02T12:00:00.000Z'));
 assert.throws(()=>prepareS16GeographySql({...preflight,proposals:[preflight.proposals[0],preflight.proposals[0]]},html,html,'2026-11-02T12:00:00.000Z'));
 assert.throws(()=>prepareS16GeographySql(preflight,html,Buffer.from('changed'),'2026-11-02T12:00:00.000Z'));
});
