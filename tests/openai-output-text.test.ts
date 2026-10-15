import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractOutputText} from '../lib/pipeline/enrichment-contract';
const message=(phase:string|null,text:string)=>({type:'message',role:'assistant',phase,status:'completed',content:[{type:'output_text',text}]});

test('a valid final JSON wins over a malformed intermediate message and aggregated text',()=>{
 const final='{"checks":[{"role":"final_population","state":"unknown"}]}';
 const response={status:'completed',output_text:'preamble plus JSON',output:[message('commentary','Intermediate, not JSON'),message('final_answer',final)]};
 assert.equal(extractOutputText(response),final);
 assert.deepEqual(JSON.parse(extractOutputText(response)),JSON.parse(final));
});
test('intermediate-only output, ambiguous finals and final refusals cannot become analysis',()=>{
 assert.throws(()=>extractOutputText({output_text:'{"ok":true}',output:[message('commentary','{"ok":true}')]}));
 assert.throws(()=>extractOutputText({output:[message('final_answer','{}'),message('final_answer','{}')]}));
 assert.throws(()=>extractOutputText({output:[message('commentary','{}'),{phase:'final_answer',content:[{type:'refusal',refusal:'Declined'}]}]}));
});
test('incomplete replies stay invalid even if their text is syntactically JSON',()=>{
 assert.throws(()=>extractOutputText({status:'incomplete',output:[message('final_answer','{}')]}));
 assert.throws(()=>extractOutputText({output:[{...message('final_answer','{}'),status:'incomplete'}]}));
});
test('legacy responses without phases and SDK text-only envelopes remain supported',()=>{
 assert.equal(extractOutputText({output:[message(null,'{"legacy":true}')]}),'{"legacy":true}');
 assert.equal(extractOutputText({output_text:'{"sdk":true}'}),'{"sdk":true}');
});
