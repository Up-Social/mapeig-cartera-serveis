import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractS16Source,compareS16Sources} from '../lib/concerts/s16-geography-dry-run';
const source=`DOGC núm. 9409, de 09.05.2025 La provisió és pels següents serveis:<ol>
 <li><strong>Servei d'Equip de Valoració de Maltractaments Infantils (EVAMI)</strong><ul><li>Ubicació: dependències de l'entitat proveïdora a Barcelona.</li></ul></li>
 <li><strong>Servei social de diagnòstic d’Equip Tècnic de Centre d’Acolliment (ETCA)</strong><ul><li>Ubicació: dependències del Centre d’acolliment Els Llimoners a Barcelona</li></ul></li></ol>`;
const bytes=(s:string)=>new TextEncoder().encode(s);
test('source location is tied to the two explicit service sections and official correspondence',()=>{
 const result=extractS16Source(bytes(source));
 assert.match(result.quotes.EVAMI,/EVAMI.*a Barcelona/);assert.doesNotMatch(result.quotes.EVAMI,/ETCA/);
 assert.match(result.quotes.ETCA,/ETCA.*Els Llimoners a Barcelona/);assert.equal(result.reference.county,'Barcelonès');
});
test('changed or ambiguous source layouts cannot silently supply geography',()=>{
 for(const changed of [source.replace('9409','0000'),source.replace('a Barcelona.','a Reus.'),source.replace('(ETCA)','(ALTRE)'),source+source])
  assert.throws(()=>extractS16Source(bytes(changed)));
 assert.throws(()=>compareS16Sources(bytes(source),bytes(source)),/LOCAL_SNAPSHOT_HASH_CHANGED/);
});
