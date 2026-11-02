import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ConcertGeography,type SupplementalConcertGeography} from '../components/concert-geography';
const proposal:SupplementalConcertGeography={review_valid:true,review_id:'review',municipality:'Barcelona',county:'Barcelonès',province:'Barcelona',source_url:'https://example.org/official',source_quote:'Ubicació: dependències del centre a Barcelona.',source_captured_at:'2025-07-21T00:00:00Z',source_sha256:'a'.repeat(64),reference:null};
const render=(value:Partial<SupplementalConcertGeography>)=>renderToStaticMarkup(React.createElement(ConcertGeography,{municipality:null,supplemental:{...proposal,...value}}));
test('only a current confirmed decision without conflict supplies the location fields',()=>{
 const confirmed=render({decision:'confirmed',review_id:'review',reviewer:'Revisor',rationale:'Contrastat el servei i el període de la captura.',conflict:false});
 assert.match(confirmed,/<dd>Barcelona<\/dd>/);assert.match(confirmed,/<dd>Barcelonès<\/dd>/);assert.match(confirmed,/confirmada per revisió humana/);assert.match(confirmed,/Revisor/);
 for(const value of [{decision:'confirmed'},{decision:'confirmed',conflict:true},{decision:'confirmed',conflict:false,review_valid:false},{decision:'confirmed',conflict:false,review_id:null},{decision:'rejected',conflict:false},{decision:'revoked',conflict:false},{}]){
  assert.match(render(value),/<dd>Pendent: no identificat/);
 }
});
test('confirmed geography leaves financing and other economic validations independent',()=>{
 assert.match(render({decision:'confirmed',conflict:false}),/les altres validacions i el finançador continuen independents/);
});
test('documentary conflict and rejected or revoked decisions are visible',()=>{
 assert.match(render({decision:'confirmed',conflict:true}),/Conflicte amb la geografia documental vigent/);
 assert.match(render({decision:'rejected'}),/rebutjada/);assert.match(render({decision:'revoked'}),/confirmació revocada/);
});
test('documentary geography remains the primary display even after a supplementary confirmation',()=>{
 const html=renderToStaticMarkup(React.createElement(ConcertGeography,{municipality:null,geography:{municipality:'Tiana',county:'Maresme',province:'Barcelona',page:4,evidence:{}},supplemental:{...proposal,decision:'confirmed',conflict:true}}));
 assert.match(html,/<dd>Tiana<\/dd>/);assert.doesNotMatch(html,/<dd>Barcelonès<\/dd>/);
});
