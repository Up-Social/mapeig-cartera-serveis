import {test} from 'node:test';
import assert from 'node:assert/strict';
import {providerRequest} from '../lib/cloud/provider';
import type {Context} from '../lib/cloud/context';
function fakeContext(){
 const journal=new Map<string,unknown>();
 const db={rpc:async(name:string,args:Record<string,unknown>)=>{if(name==='cloud_checkpoint')journal.set(String(args.p_key),args.p_value);return {data:true,error:null};},from:()=>{let key='';const query={select:()=>query,eq:(name:string,value:string)=>{if(name==='item_key')key=value;return query;},maybeSingle:async()=>({data:journal.has(key)?{value:journal.get(key)}:null,error:null})};return query;}};
 return {journal,c:{db,task:'test',owner:'owner',generation:1} as unknown as Context};
}
test('persisted response reused without another provider call',async()=>{
 const {c,journal}=fakeContext();const original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;return Response.json({id:'mock',output_text:'SENSITIVE_SENTINEL'});};
 try {await providerRequest(c,'key',{});await providerRequest(c,'key',{});assert.equal(calls,1);assert.ok(journal.has('key'));}finally{global.fetch=original;}
});
test('uncertain response pauses and cannot be silently repeated',async()=>{
 const {c}=fakeContext();const original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;throw Error('SENSITIVE_SENTINEL');};
 try {await assert.rejects(providerRequest(c,'key',{}),/provider_unknown/);await assert.rejects(providerRequest(c,'key',{}),/provider_unknown/);assert.equal(calls,1);}finally{global.fetch=original;}
});
test('rate limiting permits at most three confirmed attempts',async()=>{
 const {c}=fakeContext();const original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;return Response.json({error:{code:'rate_limit_exceeded'}},{status:429,headers:{'retry-after':'10'}});};
 try {for(let i=0;i<3;i++)await assert.rejects(providerRequest(c,'key',{}),/transient/);await assert.rejects(providerRequest(c,'key',{}),/validation/);assert.equal(calls,3);}finally{global.fetch=original;}
});
