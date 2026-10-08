import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CloudFailure,publicFailure} from '../lib/cloud/errors';
import {candidatesOnlySchema} from '../lib/pipeline/matching-schema';
import {splitText} from '../lib/pipeline/chunks';
test('runtime errors cannot expose private payloads',()=>{
 for(const error of [new Error('NIF-SECRET salary 999 URL private'),{message:'PRIVATE_DOCUMENT'},'PRIVATE_PROMPT']){
  const safe=publicFailure(error);assert.equal(safe.message,'internal');assert.equal(JSON.stringify(safe).includes('PRIVATE'),false);
 }
 assert.equal(publicFailure(new CloudFailure('provider_unknown')).kind,'provider_unknown');
});
test('remote matching keeps required classification schema',()=>{
 const schema=candidatesOnlySchema();assert.equal(schema.type,'object');assert.ok(schema.required.includes('classification'));assert.ok(schema.required.includes('candidates'));
});
test('chunking makes progress beyond fifty units',()=>{
 const result=splitText('A'.repeat(200000));assert.ok(result.length>50);assert.ok(result.every(x=>x.length>0));
});
test('chunking never splits a Unicode surrogate pair at the end or overlap',()=>{
 for(const text of ['A'.repeat(1199)+'😀'+'B'.repeat(1300),'A'.repeat(1019)+'😀'+'B'.repeat(3000)]){
  const chunks=splitText(text);
  assert.ok(chunks.length>1);
  assert.ok(chunks.some(chunk=>chunk.includes('😀')));
  assert.ok(chunks.every(chunk=>Buffer.from(chunk,'utf8').toString('utf8')===chunk));
 }
});
