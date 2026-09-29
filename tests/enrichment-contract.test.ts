import test from 'node:test';
import assert from 'node:assert/strict';
import {bindEnrichmentRoles,type Enrichment} from '../lib/pipeline/enrichment-contract';

const role=(value:string,kind:string,ordinal=1)=>({value,state:'known' as const,kind,evidence_ordinals:[ordinal],quotes:['Cita literal suficient per al contracte.']});
const enrichment={
 scope_facts:{roles:{
  financed_object:role('25 places','service_financing'),financier:role('Generalitat de Catalunya','administration'),economic_recipient:role('Colisée Care, SL','entity',2),direct_beneficiary:role('gent gran','population'),service_provider:role('Colisée Care, SL','entity',2),final_population:role('gent gran','population'),final_service:role('residència assistida','yes'),financial_instrument:role('concert social','service_financing'),
 }},title:null,provider_name:'GENERALITAT DE CATALUNYA',provider_nif:null,mechanism:'concert social',award_date:null,amount:428428,contracting_body:'Departament de Drets Socials',target_population:'gent gran',summary:'Provisió de places.',confidence:1,evidence_ordinals:[1,2],
} as Enrichment;

test('the evidenced service provider replaces the financing administration',()=>{
 const result=bindEnrichmentRoles(enrichment,[{content:'Resolució del Departament.'},{content:'Colisée D/2510002 La Saleta B966485 temporal 260034126 Care, SL. Servei de residència assistida.'}]);
 assert.equal(result.provider_name,'Colisée Care, SL');
});

test('an unsupported role value cannot replace the extracted provider',()=>{
 const result=bindEnrichmentRoles(enrichment,[{content:'Resolució del Departament.'},{content:'Annex sense identificació de cap entitat.'}]);
 assert.equal(result.provider_name,'GENERALITAT DE CATALUNYA');
});
