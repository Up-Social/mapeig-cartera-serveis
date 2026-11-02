import assert from 'node:assert/strict';
import test from 'node:test';
import {validateConveni,type ConveniAnalysis,type ConveniUnit} from '../lib/convenis/contract';

// Synthetic fragments exercise the contract; they are not a client-case replay.
test('a synthetic agreement preserves two forecasts and a shared ceiling without allocating the ceiling',()=>{
 const identity="Fundació de prova, identificada amb NIF G12345678, signa aquest conveni.";
 const food="Es preveuen 14.000,00 euros / catorze mil euros per a un programa d'aliments i higiene.";
 const homeless="Es preveuen 2.000,00 euros / dos mil euros per a un programa d'atenció a persones sense llar.";
 const ceiling="Les despeses de gestió es limiten a un 20 % de l'aportació, fins a un màxim de 4.000,00 euros / quatre mil euros.";
 const doc={id:'synthetic-agreement-fragments',storage_sha256:'synthetic',extracted_text:`## Pàgina 1\n${identity}\n## Pàgina 7\n${food}\n${homeless}\n${ceiling}`};
 const evidence=(page:number,quote:string)=>[{document_id:doc.id,page,quote}];
 const common:ConveniUnit={key:'',recipient:'Fundació de prova',recipient_nif:'G12345678',recipient_nature:'unknown',joint:false,period:'2025',year:2025,amount_cents:null,amount_state:'planned',mixed:false,financiers:['Ajuntament de prova'],territory:'Municipi de prova',classification:'insufficient_evidence',service_code:null,population:'Persones en situació de necessitat',description:'',explanation:'Proposta pendent de revisió documental',reason:null,evidence:evidence(7,food),blockers:[]};
 const units=[{...common,amount_cents:1400000,description:'Alimentació i higiene'},
  {...common,amount_cents:200000,description:'Atenció a persones sense llar',evidence:evidence(7,homeless)},
  {...common,amount_cents:null,mixed:true,description:'Límit de despeses de gestió compartides',evidence:evidence(7,ceiling)}];
 const analysis:ConveniAnalysis={actors:[{name:common.recipient,nif:common.recipient_nif,nature:'unknown',roles:['signatory'],evidence:evidence(1,identity)}],units,instrument_grant:true,coverage_complete:false,unallocated_cents:null,summary:'Fragments sintètics; cobertura i atribució pendents'};
 const result=validateConveni(analysis,{'Total aportacions previstes Generalitat':0,'Total aportacions previstes ens locals':20000},[doc],new Set());
 assert.equal(result.units.length,1);
 assert.deepEqual(result.units[0].concepts?.map(item=>item.amount_cents),[1400000,200000,null]);
 assert.equal(result.units[0].amount_cents,null);
 assert.ok(result.units[0].blockers.includes('incomplete'));
 assert.ok(result.units[0].blockers.includes('unknown_recipient'));
 assert.ok(result.units[0].concepts?.[2].evidence[0].quote.includes('màxim'));
});
