import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {aocLookupKey,cents,normalizeConveni,screenConveni,unitKey,validateConveni,type ConveniAnalysis,type ConveniUnit} from '../lib/convenis/contract';
import {createConveniExcel} from '../lib/convenis/export';
const payload={'Total aportacions previstes Generalitat':0,'Total aportacions previstes ens locals':1000,'Total aportacions previstes altres Organismes':1000,'Sumatori aportacions totals previstes':2000};
const docs=[{id:'doc',storage_sha256:'hash',extracted_text:'## Pàgina 1\n\nLa Fundació rep mil euros per prestar el servei a persones grans.'}];
const unit:ConveniUnit={key:'',recipient:'Fundació',recipient_nif:'G12345678',recipient_nature:'private',joint:false,period:'2025',year:2025,amount_cents:100000,amount_state:'conditional',mixed:false,financiers:['Ajuntament'],territory:'Vic',classification:'in_portfolio',service_code:'1.1',population:'Gent gran',description:'Servei acreditat',explanation:'Servei i població acreditats al conveni',reason:null,evidence:[{document_id:'doc',page:1,quote:'La Fundació rep mil euros per prestar el servei a persones grans.'}],blockers:[]};
const analysis=(units=[unit]):ConveniAnalysis=>({actors:[{name:'Fundació',nif:'G12345678',nature:'private',roles:['recipient'],evidence:unit.evidence}],units,instrument_grant:true,coverage_complete:true,unallocated_cents:0,summary:'Proposta de conveni revisable'});
const validate=(a:ConveniAnalysis)=>validateConveni(a,payload,docs,new Set(['1.1','1.2']));
test('public contributions only, unknown remains unknown, decimal cents exact',()=>{
 assert.equal(normalizeConveni(payload).publicCents,100000);assert.equal(normalizeConveni({...payload,'Total aportacions previstes Generalitat':null}).publicCents,null);
 assert.equal(cents('1.234,56 €'),123456);assert.equal(cents('0'),0);assert.equal(cents(''),null);assert.equal(cents(true),null);assert.equal(cents('1.001'),null);assert.equal(cents('509780.01'),50978001);
});
test('scope filters the current act, never an annual renewal or incidental cited amendment',()=>{
 assert.equal(screenConveni('Segona Addenda al conveni',payload)?.reason,'excluded_amendment');
 assert.equal(screenConveni('Pròrroga del conveni',payload)?.reason,'excluded_amendment');
 assert.equal(screenConveni('Conveni de col·laboració interadministrativa entre A i B',payload)?.reason,'interadministrative_agreement');
 for(const title of ['VII Conveni interadministratiu de col·laboració entre A i B','Conveni marc interadministratiu entre A i B','Conveni de col·laboració i cooperació interadministrativa entre A i B','Conveni de cooperació interadministrativa entre A i B'])assert.equal(screenConveni(title,payload)?.reason,'interadministrative_agreement');
 assert.equal(screenConveni('Conveni entre Vic i ASHES per al projecte 2025',payload),null);
 assert.equal(screenConveni('Conveni amb entitat en desenvolupament del conveni interadministratiu anterior',payload),null);
 assert.equal(screenConveni('Conveni que cita una addenda anterior',payload),null);
 assert.equal(screenConveni('Conveni',{'Total aportacions previstes Generalitat':0,'Total aportacions previstes ens locals':0})?.reason,'no_public_funding');
 assert.equal(screenConveni('Conveni',{}),null);
});
test('recipient and period identity ignores amount and NIF',()=>{assert.equal(validate(analysis()).units[0].key,unitKey('Fundació','2025'));assert.equal(unitKey(' Fundació ','2025'),unitKey('fundacio','2025'));assert.notEqual(unitKey('fundacio','2024'),unitKey('fundacio','2025'));});
test('joint, mixed, unknown NIF/nature and nonreconciled sums block approval',()=>{
 assert.deepEqual(validate(analysis()).units[0].blockers,[]);
 const a=validate(analysis([{...unit,joint:true,mixed:true,recipient_nif:null,recipient_nature:'unknown',amount_cents:100}]));
 assert.deepEqual(a.units[0].blockers,['joint','mixed','unknown_recipient','missing_nif','reconciliation']);
});
test('conditional annualities remain explicit; no division or parent+children',()=>{
 const a=validate(analysis([{...unit,amount_cents:40000},{...unit,period:'2026',year:2026,amount_cents:60000}]));assert.equal(a.units.length,2);assert.equal(a.units[1].amount_state,'conditional');assert.deepEqual(a.units[0].blockers,[]);
 assert.throws(()=>validate(analysis([unit,{...unit,period:'2025-2026',year:null}])) ,/duplicats/);
 assert.throws(()=>validate(analysis([unit,{...unit,amount_cents:5}])),/repetida/);
});
test('literal page evidence and eligible catalog are required',()=>{
 assert.throws(()=>validate(analysis([{...unit,evidence:[{document_id:'doc',page:2,quote:unit.evidence[0].quote}]}])),/evidència/);
 assert.throws(()=>validate(analysis([{...unit,service_code:'invented'}])),/Servei/);
 assert.throws(()=>validate(analysis([{...unit,classification:'out_of_portfolio'}])),/Codi/);
});
test('one principal per entity and public recipient exclusion',()=>{
 const a=validate(analysis([{...unit,amount_cents:40000},{...unit,period:'2026',year:2026,amount_cents:60000,service_code:'1.2'}]));assert.ok(a.units.every(u=>u.blockers.includes('multiple_services')));
 assert.ok(validate(analysis([{...unit,recipient_nature:'public'}])).units[0].blockers.includes('public_recipient'));
});
test('new and compatible exports use the same reviewed public amount and explicit status',async()=>{
 const rows=[{source_id:'2025/11/1006',call_url:null,regulatory_basis_url:null,provider_name:unit.recipient,provider_nif:unit.recipient_nif,mechanism:'Conveni',award_date:'2025-01-01',amount:1000,contracting_body:'Ajuntament',target_population:unit.population,source_reference:'Registre',service_code:'1.1',service_name:'Servei',data:unit,instrument_grant:true,related:[],annexes:[]}];
 for(const legacy of [false,true]){const bytes=await createConveniExcel(rows,['Una unitat pendent'],legacy);const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(bytes) as never);assert.equal(book.worksheets[0].name,legacy?'Detalle_Provisiones':'Detall_Registres');assert.equal(book.worksheets[0].getCell('H2').value,1000);if(!legacy)assert.equal(book.worksheets[0].getCell('R2').value,'Condicionat');}
});
test('Caritas reference amounts reconcile four documented years, retaining 2027–2028 and conditions',()=>{
 const amounts=[19200000,10080000,10585000,11113000];
 const a=validateConveni(analysis(amounts.map((amount_cents,i)=>({...unit,amount_cents,period:String(2025+i),year:2025+i,amount_state:i===0?'planned':'conditional'}))),{...payload,'Total aportacions previstes ens locals':509780},docs,new Set(['1.1']));
 assert.equal(a.units.reduce((sum,u)=>sum+u.amount_cents!,0),50978000);
 assert.deepEqual(a.units.map(u=>u.year),[2025,2026,2027,2028]);assert.ok(a.units.every(u=>!u.blockers.length));
});
test('a signer list cannot accredit a private recipient; public and mixed cases stay outside approved amounts',()=>{
 const a=analysis();a.actors=[];assert.ok(validate(a).units[0].blockers.includes('unknown_recipient'));
 // Nine public bodies in an "other signatories" column are still public bodies.
 for(let i=0;i<9;i++)assert.ok(validate(analysis([{...unit,recipient:`Organisme públic ${i}`,recipient_nature:'public'}])).units[0].blockers.includes('public_recipient'));
 const joint=validate(analysis([{...unit,recipient:'ALLEM i altres receptors (mostra sintètica)',joint:true,mixed:true}]));
 assert.equal(joint.units.length,1);assert.ok(joint.units[0].blockers.includes('joint'));assert.ok(joint.units[0].blockers.includes('mixed'));
});
test('table continuations require the cited page and incomplete coverage blocks consolidation',()=>{
 const continued=[{...docs[0],extracted_text:`## Pàgina 5\nCapçalera de taula.\n## Pàgina 6\n${unit.evidence[0].quote}`}];
 const a=analysis([{...unit,evidence:[{...unit.evidence[0],page:6}]}]);a.coverage_complete=false;a.actors[0].evidence=[{...unit.evidence[0],page:6}];
 assert.ok(validateConveni(a,payload,continued,new Set(['1.1'])).units[0].blockers.includes('incomplete'));
 assert.throws(()=>validateConveni(analysis([{...unit,evidence:[{...unit.evidence[0],page:5}]}]),payload,continued,new Set(['1.1'])),/evidència/);
});

test('AOC lookup preserves the source code and only restores an Excel-lost leading zero',()=>{
 const normalized=normalizeConveni({'Codi AOC organismes signants ens locals':825920002});
 assert.deepEqual(normalized.aocCodes,['825920002']);assert.equal(aocLookupKey(normalized.aocCodes[0]),'0825920002');
 assert.equal(aocLookupKey('8104020002'),'8104020002');assert.equal(aocLookupKey('unknown'),'unknown');
});
