import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifiedGeographyCapture,requireExpectedGeographyCapture} from '../lib/concerts/supplemental-geography-capture';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const bytes='<html>Ubicació: Barcelona</html>',text='Ubicació: Barcelona';
const saved={source_bytes:'\\x'+Buffer.from(bytes).toString('hex'),source_text:text,source_sha256:hash(bytes),source_text_sha256:hash(text)};
test('captured bytes and transcription must independently match their stored hashes and current proposal',()=>{
 const result=verifiedGeographyCapture(saved,hash(bytes));assert.equal(result.raw.toString(),bytes);assert.equal(result.source_text,text);
 for(const changed of [{source_bytes:'\\x00'},{source_text:'Changed transcript'},{source_sha256:'a'.repeat(64)},{source_text_sha256:'a'.repeat(64)},{source_bytes:'not-hex'}])assert.throws(()=>verifiedGeographyCapture({...saved,...changed},hash(bytes)));
 assert.throws(()=>verifiedGeographyCapture(saved,'b'.repeat(64)));
});

test('capture download refuses an absent, changed or unpinned proposal even if the current source is valid',()=>{
 const current={id:7,source_sha256:hash(bytes)};
 assert.doesNotThrow(()=>requireExpectedGeographyCapture(current,'7',hash(bytes)));
 for(const [proposalId,sha] of [['6',hash(bytes)],['7','a'.repeat(64)],[null,hash(bytes)],['7',null]])assert.throws(()=>requireExpectedGeographyCapture(current,proposalId,sha));
 assert.throws(()=>requireExpectedGeographyCapture(null,'7',hash(bytes)));
});
