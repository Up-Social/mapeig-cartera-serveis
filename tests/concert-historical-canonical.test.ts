import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historicalCanonicalHash} from '../lib/concerts/historical-canonical';

test('canonical encoding is key-order independent, framed and Unicode-sensitive',()=>{
 assert.equal(historicalCanonicalHash({a:[null,true],b:'x'}),historicalCanonicalHash({b:'x',a:[null,true]}));
 assert.notEqual(historicalCanonicalHash('é'),historicalCanonicalHash('e\u0301'));
 assert.notEqual(historicalCanonicalHash(['a','bc']),historicalCanonicalHash(['ab','c']));
 assert.notEqual(historicalCanonicalHash({a:null}),historicalCanonicalHash({}));
});
test('non-JSON values, unsafe numbers, NUL and invalid surrogates fail closed',()=>{
 for(const value of [undefined,NaN,Infinity,1.5,9007199254740992,'\0','\uD800',{a:undefined},[undefined],new Date()])assert.throws(()=>historicalCanonicalHash(value));
 const sparse=Array(1);assert.throws(()=>historicalCanonicalHash(sparse));
 const circular:Record<string,unknown>={};circular.self=circular;assert.throws(()=>historicalCanonicalHash(circular));
});
