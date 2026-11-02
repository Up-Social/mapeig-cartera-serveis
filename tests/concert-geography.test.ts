import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractConcertChangeRows} from '../lib/concerts/change-extraction';
import {extractConcertChangeGeography} from '../lib/concerts/geography';
import {storeConcertChangeGeography} from '../lib/cloud/concert-geography';
import type {Context} from '../lib/cloud/context';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ConcertGeography} from '../components/concert-geography';

// Official S1-1 document 0f307266-c04e-4a84-a353-2f0d4d995674,
// PDF SHA256 7df035b4a1899f312db88d56d9e5ce16f56987ee8cb6ce2d9f9d35b1016514da.
const text=readFileSync('tests/fixtures/official/nen-deu-modification-2025.txt','utf8');
const row=extractConcertChangeRows(text)[0];
test('S1-1 stores separate municipality, county and province from named sources',()=>{
 const geo=extractConcertChangeGeography(text,row);
 assert.ok(geo);assert.equal(geo.municipality,'Tiana');assert.equal(geo.county,'Maresme');assert.equal(geo.province,'Barcelona');
 assert.equal(geo.reference?.municipalityCode,'082824');assert.equal(geo.page,4);
 assert.equal(geo.rawLine.slice(geo.columnStart,geo.columnEnd).trim(),'Tiana');
 assert.equal(row.amountCents,164016);assert.equal(row.quantityDelta,1);assert.equal(row.observedServiceCode,'1.2.6.2.3.2.4');
});
test('a footer address, missing header, duplicate row or truncated municipality cannot supply geography',()=>{
 for(const changed of [text.replace('Municipi','Territori'),text+'\n'+text]){
  const r=extractConcertChangeRows(changed)[0];assert.equal(extractConcertChangeGeography(changed,r),null);
 }
 const shifted=text.replace('Municipi','  Municipi');assert.equal(extractConcertChangeGeography(shifted,row),null);
 const otherPage={...row,page:1};assert.equal(extractConcertChangeGeography(text,otherPage),null);
});
test('an unknown literal municipality is retained without inventing county or province',()=>{
 const changed=text.replace('Tiana','Xiana');const geo=extractConcertChangeGeography(changed,extractConcertChangeRows(changed)[0]);
 assert.equal(geo?.municipality,'Xiana');assert.equal(geo?.county,null);assert.equal(geo?.province,null);assert.equal(geo?.reference,null);
});
test('storage is supplemental, scoped to the lease and carries documentary and reference hashes',async()=>{
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 const context={task:'task',owner:'owner',generation:2,db:{rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {data:'unit',error:null};}}} as unknown as Context;
 await storeConcertChangeGeography(context,'job','unit',{extracted_text:text,storage_sha256:'a'.repeat(64)},row);
 assert.equal(calls.length,1);assert.equal(calls[0].name,'cloud_store_concert_geography');assert.equal(calls[0].args.p_task,'task');assert.equal(calls[0].args.p_owner,'owner');assert.equal(calls[0].args.p_generation,2);assert.equal(calls[0].args.p_job,'job');assert.equal(calls[0].args.p_unit,'unit');
 const data=calls[0].args.p_geography as {extracted_text_hash:string;reference:{sha256:string}};
 assert.match(data.extracted_text_hash,/^[a-f0-9]{64}$/);assert.match(data.reference.sha256,/^[a-f0-9]{64}$/);
 await storeConcertChangeGeography(context,'job','unit',{extracted_text:'No municipality documented',storage_sha256:'a'.repeat(64)},row);assert.equal(calls.length,1);
});
test('the card shows all three levels and explains missing fields instead of hiding them',()=>{
 const geo=extractConcertChangeGeography(text,row)!;
 const html=renderToStaticMarkup(React.createElement(ConcertGeography,{municipality:null,geography:{...geo,evidence:{reference:geo.reference}}}));
 for(const label of ['Municipi','Tiana','Comarca','Maresme','Província','Barcelona','pàgina 4','Idescat'])assert.ok(html.includes(label),label);
 const pending=renderToStaticMarkup(React.createElement(ConcertGeography,{municipality:'Tiana',geography:null}));
 assert.ok(pending.includes('Tiana'));assert.ok(pending.includes('no s’ha pogut contrastar la comarca'));assert.ok(pending.includes('no s’ha pogut contrastar la província'));
});
test('failure to persist geography is explicit and does not claim success',async()=>{
 const context={task:'task',owner:'owner',generation:2,db:{rpc:async()=>({data:null,error:{message:'SOURCE_CHANGED'}})}} as unknown as Context;
 await assert.rejects(()=>storeConcertChangeGeography(context,'job','unit',{extracted_text:text,storage_sha256:'a'.repeat(64)},row),error=>{
  assert.ok(error instanceof Error);assert.ok(JSON.stringify(error).includes('CONCERT_GEOGRAPHY_SAVE_FAILED'));return true;
 });
});
test('supplementary location remains a review proposal even when a source names a municipality',()=>{
 const html=renderToStaticMarkup(React.createElement(ConcertGeography,{municipality:null,supplemental:{municipality:'Barcelona',county:'Barcelonès',province:'Barcelona',source_url:'https://example.org/convocatoria',source_quote:'Ubicació: dependències del centre a Barcelona.',source_captured_at:'2025-07-21T00:00:00Z',source_sha256:'a'.repeat(64),reference:{sourceUrl:'https://www.idescat.cat/codis/'}}}));
 assert.match(html,/Proposta d’ubicació de font complementària · pendent de revisió/);
 assert.match(html,/no identificat amb evidència suficient en aquesta línia/);
 assert.match(html,/No modifica el territori econòmic ni confirma finançament/);
 assert.match(html,/https:\/\/example.org\/convocatoria/);
 const unsafe=renderToStaticMarkup(React.createElement(ConcertGeography,{municipality:null,supplemental:{municipality:'Barcelona',county:null,province:null,source_url:'javascript:alert(1)',source_quote:'Centre a Barcelona',source_captured_at:'2025-07-21T00:00:00Z',source_sha256:'a'.repeat(64),reference:null}}));
 assert.doesNotMatch(unsafe,/href="javascript:/);
});
