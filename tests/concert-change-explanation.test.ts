import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {ConcertChangeExplanation} from '../components/concert-change-explanation';
import {extractConcertChangeRows} from '../lib/concerts/change-extraction';
import {declaredGeneralAnnexMaximumEvidence} from '../lib/concerts/annex-extraction';

test('S1-1 explains the extra place and retains the actual reduction condition',()=>{
 const text=readFileSync('tests/fixtures/official/nen-deu-modification-2025.txt','utf8');
 const row=extractConcertChangeRows(text)[0];
 const html=renderToStaticMarkup(React.createElement(ConcertChangeExplanation,{actType:'modification',origin:'official-change-v1',quantityDelta:row.quantityDelta}));
 assert.match(html,/increment de 1 plaça/);assert.match(html,/no el total de places/);assert.match(html,/resolució original/);
 const maximum=declaredGeneralAnnexMaximumEvidence(text);
 assert.equal(maximum?.amountCents,164016);assert.match(maximum?.condition??'',/15 de desembre de 2025/);assert.match(maximum?.condition??'',/reduirà proporcionalment/);
});
test('other acts and missing or invalid quantities do not invent a change',()=>{
 for(const [actType,origin,quantityDelta] of [['award','official-change-v1',1],['modification','other',1],['modification','official-change-v1',null],['modification','official-change-v1',0]] as const)
  assert.equal(renderToStaticMarkup(React.createElement(ConcertChangeExplanation,{actType,origin,quantityDelta})), '');
 const decrease=renderToStaticMarkup(React.createElement(ConcertChangeExplanation,{actType:'modification',origin:'official-change-v1',quantityDelta:-2}));
 assert.match(decrease,/reducció de 2 places/);
});
