import {test} from 'node:test';
import assert from 'node:assert/strict';
import {candidatesOnlySchema} from '../lib/pipeline/matching-schema';
test('Production structured output only permits the supplied leaf service codes',()=>{
 const schema=candidatesOnlySchema(['1.1.2.1','1.1.2.2']);
 const data=JSON.parse(JSON.stringify(schema));
 assert.deepEqual(data.properties.candidates.items.properties.code.enum,['1.1.2.1','1.1.2.2']);
 assert.equal(data.properties.candidates.maxItems,3);
 assert.equal(JSON.parse(JSON.stringify(candidatesOnlySchema())).properties.candidates.items.properties.code.enum,undefined);
});
