import test from 'node:test';
import assert from 'node:assert/strict';
import {proposedConcertAwardDate} from '../lib/concerts/proposed-award-date';

test('the printed original-signature date is the proposed award date, the digital one otherwise',()=>{
 assert.deepEqual(proposedConcertAwardDate(['2025-04-29'],['2025-04-30']),{date:'2025-04-29',source:'printed',other:'2025-04-30'});
 assert.deepEqual(proposedConcertAwardDate(['2025-12-30','2025-12-30'],['2025-12-30']),{date:'2025-12-30',source:'printed',other:null});
 assert.deepEqual(proposedConcertAwardDate([],['2025-11-18']),{date:'2025-11-18',source:'digital',other:null});
 assert.deepEqual(proposedConcertAwardDate(['2025-04-29'],['2025-04-30','2025-05-01']),{date:'2025-04-29',source:'printed',other:null});
});
test('ambiguous or invalid dates propose nothing',()=>{
 assert.equal(proposedConcertAwardDate(['2025-04-29','2025-04-30'],[]),null);
 assert.equal(proposedConcertAwardDate([],['2025-11-18','2025-11-19']),null);
 assert.equal(proposedConcertAwardDate([],[]),null);
 assert.equal(proposedConcertAwardDate(['29/04/2025'],['bad']),null);
});

test('the printed original date prevails over an extracted date (S1-9)',()=>{
 assert.deepEqual(proposedConcertAwardDate(['2025-04-29'],['2025-04-30'],'2025-04-30'),{date:'2025-04-29',source:'printed',other:'2025-04-30'});
 assert.deepEqual(proposedConcertAwardDate(['2025-04-29'],[],'2025-04-29'),{date:'2025-04-29',source:'printed',other:null});
 assert.deepEqual(proposedConcertAwardDate([],['2025-11-18'],'2025-12-01'),{date:'2025-12-01',source:'extracted',other:null});
 assert.deepEqual(proposedConcertAwardDate(['2025-04-29','2025-04-30'],[],'2025-04-30'),{date:'2025-04-30',source:'extracted',other:null});
});
