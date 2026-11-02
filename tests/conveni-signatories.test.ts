import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ConveniSignatories} from '../components/conveni-signatories';
import {normalizeConveni} from '../lib/convenis/contract';

test('an empty other signatories field remains unknown and does not imply an interadministrative conclusion',()=>{
 const source=normalizeConveni({'Organismes signants ens locals':'Ajuntament sintètic','Altres Organismes Signants':''});
 const html=renderToStaticMarkup(createElement(ConveniSignatories,{source}));
 assert.match(html,/Ajuntament sintètic/);assert.match(html,/dada no informada a l’Excel/);
 assert.match(html,/camp buit no acredita que no hi hagi altres signants/);
 assert.match(html,/signant no és necessàriament el receptor/);assert.doesNotMatch(html,/Conveni interadministratiu/);
});

test('listed signatories are attributed to the source and remain potentially incomplete',()=>{
 const source=normalizeConveni({'Altres Organismes Signants':'Associació A; Entitat B'});
 const html=renderToStaticMarkup(createElement(ConveniSignatories,{source}));
 assert.match(html,/Associació A; Entitat B/);assert.match(html,/no acredita que hi constin tots els signants/);
 assert.match(html,/no informats a l’Excel/);assert.doesNotMatch(html,/dada no informada a l’Excel/);
});
