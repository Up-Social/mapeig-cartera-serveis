import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CONVENI_INSTRUCTIONS} from '../lib/convenis/process';
import {prepareProviderWireRequest} from '../lib/openai-model';
import {assertSafeRequestVersion} from '../lib/cloud/evidence-window';
import {CloudFailure} from '../lib/cloud/errors';

test('the active-ageing criterion proposes outside the portfolio, without relying on a name or missing NIF',()=>{
 assert.match(CONVENI_INSTRUCTIONS,/envelliment actiu d’associacions de gent gran o de jubilats tenen naturalesa social però no encaixen en cap fitxa: proposa out_of_portfolio amb status=social/);
 assert.match(CONVENI_INSTRUCTIONS,/llevat que el document acrediti les funcions d’una fitxa concreta/);
 assert.match(CONVENI_INSTRUCTIONS,/catàleg complet/);
 assert.match(CONVENI_INSTRUCTIONS,/NIF no localitzat no impedeix valorar/);
 assert.match(CONVENI_INSTRUCTIONS,/No dedueixis la naturalesa social del nom/);
});
test('request fingerprint changes and old received or uncertain requests cannot be replayed as the new prompt',()=>{
 const current=prepareProviderWireRequest({model:'synthetic',instructions:CONVENI_INSTRUCTIONS,input:'fixture'}).fingerprint;
 const old=prepareProviderWireRequest({model:'synthetic',instructions:CONVENI_INSTRUCTIONS.replace(/ Les activitats socioculturals, de lleure i d’envelliment actiu[\s\S]*?No dedueixis la naturalesa social del nom\./,''),input:'fixture'}).fingerprint;
 assert.notEqual(old,current);
 assert.throws(()=>assertSafeRequestVersion(old,current,'received'),(e:unknown)=>e instanceof CloudFailure&&e.diagnostic?.code==='NEW_ANALYSIS_REQUIRED');
 assert.throws(()=>assertSafeRequestVersion(old,current,'sending'),(e:unknown)=>e instanceof CloudFailure&&e.kind==='provider_unknown');
});

test('a public recipient does not by itself establish an interadministrative agreement',()=>{
 assert.match(CONVENI_INSTRUCTIONS,/naturalesa pública i el rol de receptor estiguin acreditats documentalment/);
 assert.match(CONVENI_INSTRUCTIONS,/interadministrative_agreement només si el caràcter interadministratiu del conveni està acreditat/);
 assert.match(CONVENI_INSTRUCTIONS,/un receptor públic no acredita per si sol la naturalesa dels altres signants/i);
 assert.match(CONVENI_INSTRUCTIONS,/Si no es coneix la naturalesa del possible receptor o no està acreditat el seu rol com a receptor, no proposis el descart per receptor públic/);
 assert.match(CONVENI_INSTRUCTIONS,/Un receptor privat amb naturalesa i rol acreditats pot classificar-se positivament/);
 const current=prepareProviderWireRequest({model:'synthetic',instructions:CONVENI_INSTRUCTIONS,input:'fixture'}).fingerprint;
 const old=prepareProviderWireRequest({model:'synthetic',instructions:CONVENI_INSTRUCTIONS.replace(/Conserva les assignacions a receptors públics per conciliar el total\.[\s\S]*?Si no es coneix la naturalesa del possible receptor o no està acreditat el seu rol com a receptor, no proposis el descart per receptor públic: deixa recipient_nature=unknown i classifica igualment el servei segons l’activitat i la població acreditades; la naturalesa del receptor queda pendent de revisió humana i mai és motiu d’insufficient_evidence\. Un receptor privat amb naturalesa i rol acreditats pot classificar-se positivament quan el servei, la població i la resta de condicions estan acreditats\./,'Conserva les assignacions a receptors públics per conciliar el total però classifica-les discarded amb reason=interadministrative_agreement.'),input:'fixture'}).fingerprint;
 assert.notEqual(old,current);
 assert.throws(()=>assertSafeRequestVersion(old,current,'received'),(e:unknown)=>e instanceof CloudFailure&&e.diagnostic?.code==='NEW_ANALYSIS_REQUIRED');
 assert.throws(()=>assertSafeRequestVersion(old,current,'sending'),(e:unknown)=>e instanceof CloudFailure&&e.kind==='provider_unknown');
});

test('insufficient evidence is reserved for not knowing what is financed; outside and 1.1.7 are reachable',()=>{
 assert.match(CONVENI_INSTRUCTIONS,/insufficient_evidence només quan el document no permet saber quines activitats es financen o a qui van dirigides/);
 assert.match(CONVENI_INSTRUCTIONS,/la manca d’encaix al catàleg mai és motiu de descart/);
 assert.match(CONVENI_INSTRUCTIONS,/l’explicació comença pel tipus d’activitat/);
 assert.match(CONVENI_INSTRUCTIONS,/són 1\.1\.7 quan el document acredita aquesta complementarietat/);
 assert.match(CONVENI_INSTRUCTIONS,/No proposis 1\.1\.4 sense àpats elaborats/);
 assert.doesNotMatch(CONVENI_INSTRUCTIONS,/insufficient_evidence si falten fets/);
 assert.match(CONVENI_INSTRUCTIONS,/la naturalesa del receptor queda pendent de revisió humana i mai és motiu d’insufficient_evidence/);
 assert.match(CONVENI_INSTRUCTIONS,/un període o la naturalesa del receptor no localitzats/);
 assert.doesNotMatch(CONVENI_INSTRUCTIONS,/si això impedeix classificar/);
});
