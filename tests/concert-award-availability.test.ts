import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ConcertAwardAvailability,readAwardAvailability} from '../components/concert-line-award';

test('availability distinguishes an explicit disabled feature from transport errors and malformed responses',async()=>{
 assert.deepEqual(await readAwardAvailability(Response.json({enabled:false})),{enabled:false,previousId:null});
 assert.deepEqual(await readAwardAvailability(Response.json({enabled:false,paused:true,reason:'Manteniment'})),{enabled:false,previousId:null,paused:true,reason:'Manteniment'});
 await assert.rejects(readAwardAvailability(Response.json({enabled:true,paused:true,previousId:null})));
 assert.deepEqual(await readAwardAvailability(Response.json({enabled:true,previousId:'decision'})),{enabled:true,previousId:'decision'});
 await assert.rejects(readAwardAvailability(Response.json({error:'private details'},{status:503})));
 await assert.rejects(readAwardAvailability(Response.json({enabled:'true'})));
 await assert.rejects(readAwardAvailability(Response.json({enabled:true})));
 await assert.rejects(readAwardAvailability(Response.json({enabled:true,previousId:{}})));
});

test('unavailable and uncertain availability explain the block separately',()=>{
 const html=(state:'loading'|'unavailable'|'paused'|'error')=>renderToStaticMarkup(createElement(ConcertAwardAvailability,{state,onRetry:()=>{}}));
 assert.match(html('paused'),/temporalment aturades/);
 assert.match(html('loading'),/Comprovant/);
 assert.match(html('unavailable'),/encara no està disponible/);
 assert.doesNotMatch(html('unavailable'),/Torna a comprovar/);
 assert.match(html('error'),/No s’ha pogut comprovar/);
 assert.match(html('error'),/Torna a comprovar/);
 assert.doesNotMatch(html('error'),/private details/);
});
