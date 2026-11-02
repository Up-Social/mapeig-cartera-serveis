import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CONVENI_INSTRUCTIONS} from '../lib/convenis/process';
import {prepareProviderWireRequest} from '../lib/openai-model';
import {assertSafeRequestVersion} from '../lib/cloud/evidence-window';
import {CloudFailure} from '../lib/cloud/errors';

test('the active-ageing criterion asks for documentary and full catalog review, without relying on a name or missing NIF',()=>{
 assert.match(CONVENI_INSTRUCTIONS,/envelliment actiu/);
 assert.match(CONVENI_INSTRUCTIONS,/activitats i destinataris documentats/);
 assert.match(CONVENI_INSTRUCTIONS,/catàleg complet/);
 assert.match(CONVENI_INSTRUCTIONS,/NIF no localitzat no impedeix valorar/);
 assert.match(CONVENI_INSTRUCTIONS,/No dedueixis la naturalesa social del nom/);
});
test('request fingerprint changes and old received or uncertain requests cannot be replayed as the new prompt',()=>{
 const current=prepareProviderWireRequest({model:'synthetic',instructions:CONVENI_INSTRUCTIONS,input:'fixture'}).fingerprint;
 const old=prepareProviderWireRequest({model:'synthetic',instructions:CONVENI_INSTRUCTIONS.replace(/ Els programes d’envelliment actiu[\s\S]*?No dedueixis la naturalesa social del nom\./,''),input:'fixture'}).fingerprint;
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
 const old=prepareProviderWireRequest({model:'synthetic',instructions:CONVENI_INSTRUCTIONS.replace(/Conserva les assignacions a receptors públics per conciliar el total\.[\s\S]*?Si no es coneix la naturalesa del possible receptor o no està acreditat el seu rol com a receptor, no proposis el descart per receptor públic; si això impedeix classificar i no hi ha cap altre motiu independent acreditat, indica insufficient_evidence\. Un receptor privat amb naturalesa i rol acreditats pot classificar-se positivament quan el servei, la població i la resta de condicions estan acreditats\./,'Conserva les assignacions a receptors públics per conciliar el total però classifica-les discarded amb reason=interadministrative_agreement.'),input:'fixture'}).fingerprint;
 assert.notEqual(old,current);
 assert.throws(()=>assertSafeRequestVersion(old,current,'received'),(e:unknown)=>e instanceof CloudFailure&&e.diagnostic?.code==='NEW_ANALYSIS_REQUIRED');
 assert.throws(()=>assertSafeRequestVersion(old,current,'sending'),(e:unknown)=>e instanceof CloudFailure&&e.kind==='provider_unknown');
});
