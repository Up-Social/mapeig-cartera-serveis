import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {aocLookupKey,cents,CONVENI_NORMALIZATION_VERSION,normalizeConveni,unitKey,validateConveni,type ConveniAnalysis,type ConveniUnit} from '../lib/convenis/contract';
import {createConveniExcel} from '../lib/convenis/export';
import {screenConveni} from '../lib/convenis/scope';
const payload={'Total aportacions previstes Generalitat':0,'Total aportacions previstes ens locals':1000,'Total aportacions previstes altres Organismes':1000,'Sumatori aportacions totals previstes':2000};
const docs=[{id:'doc',storage_sha256:'hash',extracted_text:'## Pàgina 1\n\nLa Fundació amb NIF G12345678 rep mil euros per prestar el servei a persones grans.'}];
const unit:ConveniUnit={key:'',recipient:'Fundació',recipient_nif:'G12345678',recipient_nature:'private',joint:false,period:'2025',year:2025,amount_cents:100000,amount_state:'conditional',mixed:false,financiers:['Ajuntament'],territory:'Vic',classification:'in_portfolio',service_code:'1.1',population:'Gent gran',description:'Servei acreditat',explanation:'Servei i població acreditats al conveni',reason:null,evidence:[{document_id:'doc',page:1,quote:'La Fundació amb NIF G12345678 rep mil euros per prestar el servei a persones grans.'}],blockers:[]};
const analysis=(units=[unit]):ConveniAnalysis=>({actors:[{name:'Fundació',nif:'G12345678',nature:'private',roles:['recipient'],evidence:unit.evidence}],units,instrument_grant:true,coverage_complete:true,unallocated_cents:0,summary:'Proposta de conveni revisable'});
const validate=(a:ConveniAnalysis)=>validateConveni(a,payload,docs,new Set(['1.1','1.2']));
test('public contributions only, unknown remains unknown, decimal cents exact',()=>{
 assert.equal(normalizeConveni(payload).publicCents,100000);assert.equal(normalizeConveni({...payload,'Total aportacions previstes Generalitat':null}).publicCents,null);
 assert.equal(cents('1.234,56 €'),123456);assert.equal(cents('0'),0);assert.equal(cents(''),null);assert.equal(cents(true),null);assert.equal(cents('1.001'),null);assert.equal(cents('509780.01'),50978001);
});

test('a blank signatory column only proposes an interadministrative discard, never an automatic one',()=>{
 const title="Conveni entre el Consell Comarcal del Vallès Oriental i l'Ajuntament de la Roca del Vallès";
 const parties={'Altres Organismes Signants':null,'Organismes signants ens locals':'Consell Comarcal del Vallès Oriental; Ajuntament de la Roca del Vallès',...payload};
 const proposal=screenConveni(title,parties);
 assert.equal(proposal?.reason,'interadministrative_agreement');assert.equal(proposal?.mode,'proposal');assert.equal(proposal?.rule,'interadministrative_signatories');
 assert.match(proposal!.explanation,/pot ser incompleta/);
 assert.equal(screenConveni(title,{...parties,'Altres Organismes Signants':'Fundació de prova'}),null);
 const missing:Record<string,unknown>={...parties};delete missing['Altres Organismes Signants'];
 assert.equal(screenConveni(title,missing)?.mode,'proposal');
 // Any private-looking party in the row keeps the case for documentary analysis.
 assert.equal(screenConveni(title,{...parties,'Organismes signants ens locals':'Consell Comarcal del Vallès Oriental; Fundació de prova'}),null);
 assert.equal(screenConveni(title+' i la Fundació de prova',parties),null);
 assert.equal(screenConveni('Conveni per a un servei social',parties)?.mode,'proposal');
});
test('scope filters the current act, never an annual renewal or incidental cited amendment',()=>{
 const withEntity={...payload,'Altres Organismes Signants':'Associació de prova'};
 assert.equal(screenConveni('Segona Addenda al conveni',payload)?.reason,'excluded_amendment');
 assert.equal(screenConveni('Segona Addenda al conveni',withEntity),null);
 assert.equal(screenConveni('Pròrroga del conveni',payload)?.reason,'excluded_amendment');
 assert.equal(screenConveni('Conveni de col·laboració interadministrativa entre A i B',payload)?.reason,'interadministrative_agreement');
 for(const title of ['VII Conveni interadministratiu de col·laboració entre A i B','Conveni marc interadministratiu entre A i B','Conveni de col·laboració i cooperació interadministrativa entre A i B','Conveni de cooperació interadministrativa entre A i B'])assert.equal(screenConveni(title,payload)?.reason,'interadministrative_agreement');
 assert.equal(screenConveni('Conveni entre Vic i ASHES per al projecte 2025',withEntity),null);
 assert.equal(screenConveni('Conveni amb entitat en desenvolupament del conveni interadministratiu anterior',withEntity),null);
 assert.equal(screenConveni('Conveni que cita una addenda anterior',withEntity),null);
 const zero=screenConveni('Conveni',{'Total aportacions previstes Generalitat':0,'Total aportacions previstes ens locals':0,'Total aportacions previstes altres Organismes':500});
 assert.equal(zero?.reason,'no_public_funding');assert.match(zero!.label,/Generalitat i els ens locals: 0/);assert.doesNotMatch(zero!.label,/Sense aportació pública/);
 assert.equal(screenConveni('Conveni',withEntity),null);
 assert.equal(screenConveni('Conveni',{})?.mode,'proposal');
});
test('recipient and period identity ignores amount and NIF',()=>{assert.equal(validate(analysis()).units[0].key,unitKey('Fundació','2025'));assert.equal(unitKey(' Fundació ','2025'),unitKey('fundacio','2025'));assert.notEqual(unitKey('fundacio','2024'),unitKey('fundacio','2025'));});
test('joint, mixed, unknown NIF/nature and nonreconciled sums block approval',()=>{
 assert.deepEqual(validate(analysis()).units[0].blockers,[]);
 const a=validate(analysis([{...unit,joint:true,mixed:true,recipient_nif:null,recipient_nature:'unknown',amount_cents:100}]));
 assert.deepEqual(a.units[0].blockers,['joint','mixed','unknown_recipient','missing_nif','reconciliation']);
});
test('conditional annualities remain explicit; no division or parent+children',()=>{
 const a=validate(analysis([{...unit,amount_cents:40000},{...unit,period:'2026',year:2026,amount_cents:60000}]));assert.equal(a.units.length,2);assert.equal(a.units[1].amount_state,'conditional');assert.deepEqual(a.units[0].blockers,[]);
 // A total next to its annualities keeps the annualities and reports the total.
 const total=validate(analysis([unit,{...unit,period:'2025-2026',year:null}]));
 assert.deepEqual(total.units.map(u=>u.period),['2025']);assert.ok(total.diagnostics?.some(d=>d.code==='CONVENI_TOTAL_AND_ANNUALITIES'));
 const mixed=validate(analysis([unit,{...unit,amount_cents:5}]));
 assert.equal(mixed.units.length,1);assert.equal(mixed.units[0].amount_cents,null);
 assert.deepEqual(mixed.units[0].concepts?.map(c=>c.amount_cents),[100000,5]);
 assert.ok(mixed.units[0].blockers.includes('mixed'));assert.ok(mixed.units[0].blockers.includes('reconciliation'));
});
test('repeated recipient concepts preserve each amount without guessing attribution or accepting conflicting identities',()=>{
 const proposals=[{...unit,amount_cents:1400000,description:'Primer concepte'}, {...unit,amount_cents:200000,description:'Segon concepte'}, {...unit,amount_cents:400000,description:'Despesa compartida'}];
 const result=validate(analysis(proposals));
 assert.equal(result.normalization_version,CONVENI_NORMALIZATION_VERSION);
 assert.equal(result.units.length,1);assert.equal(result.units[0].classification,'insufficient_evidence');assert.equal(result.units[0].service_code,null);
 assert.deepEqual(result.units[0].concepts?.map(c=>c.amount_cents),[1400000,200000,400000]);
 // Conflicting identities are grouped for review, never resolved by guessing.
 const conflict=validate(analysis([unit,{...unit,recipient_nif:'G87654321'}]));
 assert.equal(conflict.units.length,1);assert.equal(conflict.units[0].recipient_nif,null);assert.ok(conflict.units[0].blockers.includes('duplicate'));
 assert.deepEqual(conflict.units[0].concepts?.map(c=>c.recipient_nif),[unit.recipient_nif,'G87654321']);
});
test('literal page evidence and eligible catalog are required',()=>{
 assert.throws(()=>validate(analysis([{...unit,evidence:[{document_id:'doc',page:2,quote:unit.evidence[0].quote}]}])),/cita verificable/);
 const invented=validate(analysis([{...unit,service_code:'invented'}]));
 assert.equal(invented.units[0].classification,'insufficient_evidence');assert.equal(invented.units[0].service_code,null);assert.ok(invented.diagnostics?.some(d=>d.code==='CONVENI_SERVICE_UNVERIFIED'));
 const outside=validate(analysis([{...unit,classification:'out_of_portfolio'}]));
 assert.equal(outside.units[0].service_code,null);assert.ok(outside.diagnostics?.some(d=>d.code==='CONVENI_CODE_CLASSIFICATION_CONFLICT'));
});
test('one principal per entity and public recipient exclusion',()=>{
 const a=validate(analysis([{...unit,amount_cents:40000},{...unit,period:'2026',year:2026,amount_cents:60000,service_code:'1.2'}]));assert.ok(a.units.every(u=>u.blockers.includes('multiple_services')));
 assert.ok(validate(analysis([{...unit,recipient_nature:'public'}])).units[0].blockers.includes('public_recipient'));
});
test('new and compatible exports use the same reviewed public amount and explicit status',async()=>{
 const rows=[{source_id:'2025/11/1006',call_url:null,regulatory_basis_url:null,provider_name:unit.recipient,provider_nif:unit.recipient_nif,mechanism:'Conveni',award_date:'2025-01-01',amount:1000,contracting_body:'Ajuntament',target_population:unit.population,source_reference:'Registre',service_code:'1.1',service_name:'Servei',data:unit,instrument_grant:true,related:[],annexes:[]}];
 for(const legacy of [false,true]){const bytes=await createConveniExcel(rows,['Una unitat pendent'],legacy);const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(bytes) as never);assert.equal(book.worksheets[0].name,legacy?'Detalle_Provisiones':'Detall_Registres');assert.equal(book.worksheets[0].getCell('H2').value,1000);if(!legacy)assert.equal(book.worksheets[0].getCell('R2').value,'Condicionat');}
});
test('both Conveni formats preserve the calendar date and reject an invalid date',async()=>{
 const rows=[{source_id:'2025/11/1006',call_url:null,regulatory_basis_url:null,provider_name:unit.recipient,provider_nif:unit.recipient_nif,mechanism:'Conveni',award_date:'2026-09-30',amount:0,contracting_body:'Ajuntament',target_population:unit.population,source_reference:'Registre',service_code:'1.1',service_name:'Servei',data:unit,instrument_grant:true,related:[],annexes:[]}];
 const original=process.env.TZ;process.env.TZ='Europe/Madrid';
 try{
  for(const legacy of [false,true]){
   const bytes=await createConveniExcel(rows,[],legacy);const book=new ExcelJS.Workbook();await book.xlsx.load(Uint8Array.from(bytes).buffer);
   assert.equal((book.worksheets[0].getCell('G2').value as Date).toISOString(),'2026-09-30T00:00:00.000Z');
   assert.equal(book.worksheets[0].getCell('H2').value,0);
   await assert.rejects(createConveniExcel([{...rows[0],award_date:'2025-02-29'}],[],legacy),/Data de concessió no vàlida del registre 2025\/11\/1006/);
  }
 }finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
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
 assert.throws(()=>validateConveni(analysis([{...unit,evidence:[{...unit.evidence[0],page:5}]}]),payload,continued,new Set(['1.1'])),/cita verificable/);
});

test('AOC lookup preserves the source code and only restores an Excel-lost leading zero',()=>{
 const normalized=normalizeConveni({'Codi AOC organismes signants ens locals':825920002});
 assert.deepEqual(normalized.aocCodes,['825920002']);assert.equal(aocLookupKey(normalized.aocCodes[0]),'0825920002');
 assert.equal(aocLookupKey('8104020002'),'8104020002');assert.equal(aocLookupKey('unknown'),'unknown');
});

test('an empty other-signatories field is unknown, not evidence that no signatory exists',()=>{
 for(const value of [undefined,null,'','  ',' ; '])assert.equal(normalizeConveni({'Altres Organismes Signants':value}).signatoriesState,'unknown');
 const known=normalizeConveni({'Altres Organismes Signants':'Entitat A; Entitat B'});
 assert.equal(known.signatoriesState,'listed');assert.deepEqual(known.signatories,['Entitat A','Entitat B']);
});
