import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createVisualOpen,type PdfSource} from '../lib/convenis/visual-open';
import {ConveniVisualReview} from '../components/conveni-visual-review';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const data=Buffer.from('%PDF-1.4 synthetic-only');const digest=createHash('sha256').update(data).digest('hex');
const snapshot:PdfSource={recordId:id(1),documentId:id(2),document_state:{status:'fetched'},source:{path:`cases/${id(1)}/documents/${id(2)}/${digest}.pdf`,sha256:digest,object_id:id(3),version:id(4)}};
test('visual open returns exactly the verified bytes and saves only a server snapshot',async()=>{
 let requests=0;let writes=0;
 const open=createVisualOpen({storageUrl:'http://127.0.0.1:1234',serviceKey:'synthetic',snapshot:async()=>snapshot,fetcher:async(input)=>{requests++;assert.equal(new URL(String(input)).searchParams.get('versionId'),id(4));return new Response(Uint8Array.from(data));},saveRead:async(event_id,document_id,s)=>{writes++;assert.deepEqual(s,snapshot);return {event_id,document_id,snapshot:s};}});
 const result=await open({documentId:id(2),eventId:id(5)});assert.deepEqual(result.bytes,new Uint8Array(data));assert.equal(requests,1);assert.equal(writes,1);
 await assert.rejects(()=>open({documentId:id(2),eventId:id(5),source:snapshot.source}));assert.equal(requests,1);
});
test('visual open with modified bytes or stale snapshot returns no PDF',async()=>{
 let writes=0;
 const input={documentId:id(2),eventId:id(5)};
 const bad=createVisualOpen({storageUrl:'http://127.0.0.1:1234',serviceKey:'synthetic',snapshot:async()=>snapshot,fetcher:async()=>new Response('different'),saveRead:async(event_id,document_id,s)=>{writes++;return {event_id,document_id,snapshot:s};}});
 await assert.rejects(()=>bad(input));assert.equal(writes,0);
 const stale=createVisualOpen({storageUrl:'http://127.0.0.1:1234',serviceKey:'synthetic',snapshot:async()=>snapshot,fetcher:async()=>new Response(Uint8Array.from(data)),saveRead:async()=>{throw Error('stale');}});
 await assert.rejects(()=>stale(input),/stale/);
});
test('visual preparation is explicit about scope and does not present an approval action',()=>{
 const html=renderToStaticMarkup(createElement(ConveniVisualReview,{recordId:id(1),documents:[]}));
 assert.match(html,/La declaració no aprova el conveni/);assert.match(html,/ni certifica la identitat/);assert.doesNotMatch(html,/Desa l’observació/);
});
