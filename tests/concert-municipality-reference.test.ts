import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {municipalityReference} from '../lib/concerts/geography';
import {ConcertGeography} from '../components/concert-geography';

test('a recorded municipality resolves its county and province from Idescat',()=>{
 assert.deepEqual(municipalityReference(' ripoll ')&&{county:municipalityReference('Ripoll')!.county,province:municipalityReference('Ripoll')!.province},{county:'Ripollès',province:'Girona'});
 assert.equal(municipalityReference('Lleida')?.county,'Segrià');
 assert.equal(municipalityReference(null),null);
 assert.equal(municipalityReference('Demarcació de Tarragona'),null);
});

test('the line shows the derived county, or the registered territory as pending',()=>{
 const derived=renderToStaticMarkup(createElement(ConcertGeography,{municipality:'Reus',reference:municipalityReference('Reus'),territory:'Baix Camp'}));
 assert.match(derived,/Baix Camp/);assert.match(derived,/Municipi registrat a la línia/);
 const pending=renderToStaticMarkup(createElement(ConcertGeography,{municipality:null,reference:null,territory:'Tarragona'}));
 assert.match(pending,/territori registrat a la línia: Tarragona/);
});
