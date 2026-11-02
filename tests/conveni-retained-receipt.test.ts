import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {retainedConveniProposals} from '../lib/convenis/retained-receipt';
import {RetainedProposal} from '../components/conveni-study';

const unit={recipient:'Entitat fictícia',period:'2025',classification:'discarded',reason:'missing_population',explanation:'No s’ha identificat població.',description:'Servei',population:''};
const envelope=(units:unknown)=>({status:'received',response:{status:'completed',output_text:JSON.stringify({units})}});
test('a retained model response is displayed solely as an unverified proposal',()=>{
 const projected=retainedConveniProposals(envelope([unit]));
 assert.ok(projected);assert.equal(projected[0].classification,'Descart proposat');
 const html=renderToStaticMarkup(createElement(RetainedProposal,{units:projected}));
 assert.match(html,/no una anàlisi validada ni una decisió/);
 assert.match(html,/no se n’ha autenticat l’origen/);assert.match(html,/ni s’ha verificat de manera independent la integritat de la resposta/);assert.match(html,/Les cites, les fonts i la seva vigència no s’han comprovat/);
 assert.match(html,/Aquesta resposta no aprova ni descarta cap unitat/);
 assert.match(html,/No es pot decidir ni atribuir finançament des d’aquesta resposta/);
 assert.match(html,/missing_population/);assert.match(html,/no s’ha identificat la població destinatària/);assert.match(html,/No és motiu de descart; queda pendent de contrast/);assert.doesNotMatch(html,/<form|<button/);
});
test('a missing NIF in a retained discard proposal is explained as pending, never a decision',()=>{
 const projected=retainedConveniProposals(envelope([{...unit,reason:'missing_nif'}]));assert.ok(projected);
 const html=renderToStaticMarkup(createElement(RetainedProposal,{units:projected}));
 assert.match(html,/no s’ha identificat el NIF del receptor/);assert.match(html,/No és motiu de descart; queda pendent de contrast/);
 assert.match(html,/Aquesta resposta no aprova ni descarta cap unitat/);assert.doesNotMatch(html,/<form|<button/);
});
test('unknown, ambiguous, incomplete, malformed and oversized responses are withheld',()=>{
 for(const value of [{status:'unavailable'},envelope([]),envelope(Array(101).fill(unit)),envelope([{...unit,classification:'unknown'}]),envelope([{...unit,recipient:'x'.repeat(501)}]),...['incomplete','queued','in_progress','cancelled','failed','unknown'].map(status=>({status:'received',response:{status,output_text:JSON.stringify({units:[unit]})}})),{status:'received',response:{output_text:JSON.stringify({units:[unit]})}},{status:'received',response:{status:'completed',output_text:'not json'}}])assert.equal(retainedConveniProposals(value),null);
});
test('only the supported projection leaves the server and React escapes untrusted strings',()=>{
 const projected=retainedConveniProposals(envelope([{...unit,recipient:'<script>evil</script>',secret:'private'}]));assert.ok(projected);
 assert.equal(Object.hasOwn(projected[0],'secret'),false);
 const html=renderToStaticMarkup(createElement(RetainedProposal,{units:projected}));
 assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
});
