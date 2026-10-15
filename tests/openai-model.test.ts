import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareOpenAIRequest,openAIInputTokenCeiling,responseModel} from '../lib/openai-model';

test('Luna preserves structured output and token caps with an explicit non-reasoning Standard baseline',()=>{
 const body={model:'gpt-6-luna',input:'Resolució en català',max_output_tokens:2400,text:{format:{type:'json_schema',strict:true,schema:{type:'object'}}}};
 const request=prepareOpenAIRequest(body);
 assert.deepEqual(request,{...body,reasoning:{effort:'none'},service_tier:'default'});
 assert.equal(request.text,body.text);
 assert.equal(openAIInputTokenCeiling(request),Buffer.byteLength(JSON.stringify(request),'utf8')+4096);
 assert.equal('reasoning' in body,false);
});
test('rollback requests stay byte-identical and replayed receipts keep their actual model',()=>{
 const body={model:'gpt-4o-mini',input:'Fixture',max_output_tokens:2400};
 assert.equal(prepareOpenAIRequest(body),body);
 assert.equal(responseModel({model:'gpt-4o-mini-2024-07-18'},'gpt-6-luna'),'gpt-4o-mini-2024-07-18');
 assert.equal(responseModel({},'gpt-6-luna'),'gpt-6-luna');
});
test('text reservation bound refuses invisible context, tools and excessive input',()=>{
 for(const body of [{input:[{type:'input_image'}]},{input:'text',tools:[]},{input:'text',previous_response_id:'id'},{input:'text',conversation:'id'}])
  assert.throws(()=>openAIInputTokenCeiling(body),/TEXT_REQUEST_REQUIRED/);
 assert.throws(()=>openAIInputTokenCeiling({input:'x'.repeat(1_050_000)}),/INPUT_TOO_LARGE/);
});
