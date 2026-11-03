import assert from 'node:assert/strict';
import test from 'node:test';
import {concertQuantityCoverage} from '../lib/concerts/quantity-coverage';

test('missing quantities remain pending rather than becoming one or zero',()=>{
 assert.equal(concertQuantityCoverage([{quantity:null,extraction_origin:null}],null),'Quantitat pendent de contrast · 1 línia amb quantitat pendent');
 assert.equal(concertQuantityCoverage([{quantity:0,extraction_origin:null},{quantity:null,extraction_origin:null}],4),'Suma de quantitats identificades: 0 · 1 línia amb quantitat pendent · títol: 4 serveis anunciats');
});

test('a program subtotal declares its scope and preserves missing places',()=>{
 const rows=[{quantity:4,extraction_origin:'program-columns-v2'},{quantity:null,extraction_origin:'program-columns-v2'},{quantity:3,extraction_origin:'official-resolc'}];
 assert.equal(concertQuantityCoverage(rows,null),'Suma de places identificades: 4 · 1 línia amb quantitat pendent · 2 línies de programa (no inclou 1 altra línia)');
 assert.equal(concertQuantityCoverage([{quantity:null,extraction_origin:'program-columns-v2'}],null),'Places pendents de contrast · 1 línia amb quantitat pendent · 1 línia de programa');
});

test('unsafe aggregate is not displayed as a partial sum or a missing line, regardless of order',()=>{
 const a={quantity:Number.MAX_SAFE_INTEGER,extraction_origin:null},b={quantity:1,extraction_origin:null};
 assert.equal(concertQuantityCoverage([a,b],null),'Suma de quantitats identificades no calculable');
 assert.equal(concertQuantityCoverage([b,a],null),'Suma de quantitats identificades no calculable');
});

test('empty and invalid quantities are not counted as known values',()=>{
 assert.equal(concertQuantityCoverage([],null),'Cap línia identificada');
 assert.equal(concertQuantityCoverage([{quantity:-1,extraction_origin:null},{quantity:1.5,extraction_origin:null}],null),'Quantitat pendent de contrast · 2 línies amb quantitat pendent');
});

test('a modification annex shows its change of places, not a pending quantity',()=>{
 const change=(quantity_delta:number|null)=>({quantity:null,extraction_origin:'official-change-v1',quantity_delta});
 assert.equal(concertQuantityCoverage([change(5),change(5),change(5)],null),'Canvi de places identificat: +15');
 assert.equal(concertQuantityCoverage([change(-2)],3),'Canvi de places identificat: -2 · títol: 3 serveis anunciats');
 assert.match(concertQuantityCoverage([change(5),change(null)],null),/Quantitat pendent de contrast · 2 línies amb quantitat pendent/);
});
