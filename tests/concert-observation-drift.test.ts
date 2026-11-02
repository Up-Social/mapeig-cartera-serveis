import {test} from 'node:test';
import assert from 'node:assert/strict';
import {annexAnchorDrift,annexDraftDrift} from '../lib/concerts/observation-drift';

test('an ordinal reused for a different source line is rejected even when a unit was reviewed',()=>{
 const old={reses_code:'S10844',page:5,evidence_quote:'Cita de la línia original'};
 assert.deepEqual(annexAnchorDrift(old,{resesCode:'S10844',page:5,quote:'Cita  de la línia original'}),[]);
 assert.deepEqual(annexAnchorDrift(old,{resesCode:'S03707',page:5,quote:'Cita d’una altra línia'}),['reses_code','evidence']);
 assert.deepEqual(annexAnchorDrift(old,{resesCode:'S10844',page:6,quote:'Cita de la línia original'}),['page']);
});

test('a changed draft fact is diagnosed rather than silently retained or overwritten',()=>{
 const existing={observed_service_code:'1.2.3',provider_nif:'G12345678',municipality:'eus',quantity:5,amount:13923.80,observed_provider_name:'Fundació Prova',reses_code:'S12345',page:2,evidence_quote:'Cita literal acreditada de la línia'};
 const proposed={observedServiceCode:'1.2.3',nif:'G12345678',municipality:'Reus',quantity:5,amountCents:1392380,observedProviderName:'FUNDACIÓ PROVA',resesCode:'S12345',page:2,quote:'Cita literal acreditada de la línia'};
 assert.deepEqual(annexDraftDrift(existing,proposed),['municipality']);
 assert.deepEqual(annexDraftDrift({...existing,municipality:'REUS'},proposed),[]);
 assert.deepEqual(annexDraftDrift({...existing,municipality:'Reus',amount:null},proposed),['amount']);
 assert.deepEqual(annexDraftDrift({...existing,municipality:'Reus',quantity:4},proposed),['quantity']);
 assert.deepEqual(annexDraftDrift({...existing,municipality:'Reus',amount:2**45},proposed),['amount']);
 assert.deepEqual(annexDraftDrift({...existing,municipality:'Reus',reses_code:'S99999',page:3,evidence_quote:'Altra cita',observed_provider_name:'Altra entitat'},proposed),['provider_name','reses_code','page','evidence']);
});
