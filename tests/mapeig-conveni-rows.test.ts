import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {ConveniUnit} from '../lib/convenis/contract';
import {CONVENI_OUT_OF_PORTFOLIO_CODE,conveniRowsFromData,conveniUnitAmount,localBodyProvince,type ConveniCurrentUnitRow,type ConveniMapeigData} from '../lib/exports/mapeig/providers/conveni-rows';
import {providersFor} from '../lib/exports/mapeig/providers';

const unit=(partial:Partial<ConveniUnit>):ConveniUnit=>({key:'k',recipient:'Fundació A',recipient_nif:'G11111111',recipient_nature:'private',joint:false,period:'2025',year:2025,
 amount_cents:1_000_000,amount_state:'planned',mixed:false,financiers:['Ajuntament de Vic'],territory:null,classification:'in_portfolio',service_code:'1.1.7',
 population:'Famílies vulnerables',description:'Lots d’aliments',explanation:'',reason:null,evidence:[],blockers:[],...partial});
const current=(partial:Partial<ConveniCurrentUnitRow>&{data?:ConveniUnit}):ConveniCurrentUnitRow=>({unit_id:'u1',job_id:'j1',source_record_id:'r1',data:unit({}),payload:{instrument_grant:true},
 outcome:null,reviewed_code:null,reviewed_job:null,review_note:null,...partial});
const payload={'Número conveni definitiu':'2025/11/0001','Document conveni':'https://documents.example/c.pdf','Data signatura':'2025-03-10T00:00:00.000Z','Organismes signants ens locals':'Ajuntament de Vic','Convenis relacionats':'2024/11/0009','Títol conveni':'Conveni de subvenció'};
const data=(partial:Partial<ConveniMapeigData>):ConveniMapeigData=>({units:[current({})],records:[{id:'r1',source_record_id:'2025/11/0001',title:'Conveni de subvenció',source_payload:payload}],provisions:[],...partial});
const options={origin:'https://app.example',catalogCodes:new Map([['1.1.7','Serveis de suport als serveis socials bàsics']])};

test('a proposal inside the Cartera is exported with its amount, code, province and state',()=>{
 const {rows}=conveniRowsFromData(data({}),options);
 assert.equal(rows.length,1);const row=rows[0];
 assert.equal(row.mechanism,'Conveni');assert.equal(row.source,'Registre de Convenis');assert.equal(row.sourceId,'2025/11/0001');assert.equal(row.sourceUrl,'https://documents.example/c.pdf');
 assert.equal(row.amount,10000);assert.equal(row.carteraCode,'1.1.7');assert.equal(row.awardDate,'2025-03-10');assert.equal(row.province,'Barcelona');
 assert.equal(row.contractingBody,'Ajuntament de Vic');assert.equal(row.targetPopulation,'Famílies vulnerables');
 assert.equal(row.extras.lineState,'Pendent de revisió');assert.equal(row.extras.instrumentGrant,'Sí');assert.equal(row.extras.relatedConvenis,'2024/11/0009');
 assert.equal(row.extras.serviceName,'Serveis de suport als serveis socials bàsics');assert.equal(row.extras.appLink,'https://app.example/records/r1');
});

test('out-of-portfolio financing goes to FORA with its activity, never to a Cartera code',()=>{
 const {rows}=conveniRowsFromData(data({units:[current({data:unit({classification:'out_of_portfolio',service_code:'1.1.7',description:'Activitats per a gent gran',mixed:true,blockers:['mixed','missing_nif'],recipient_nif:null})})]}),options);
 const row=rows[0];
 assert.equal(row.carteraCode,CONVENI_OUT_OF_PORTFOLIO_CODE);assert.equal(row.amount,10000);assert.equal(row.extras.activity,'Activitats per a gent gran');
 assert.equal(row.providerNif,null);assert.ok(row.observations.some(o=>o.startsWith('NIF no localitzat')));
 assert.ok(row.observations.some(o=>o.startsWith('Import mixt')));assert.equal(row.observations.filter(o=>o.startsWith('Import mixt')).length,1);
});

test('a group of concepts exports each classified concept; discards and insufficient units are counted, not exported',()=>{
 const group=unit({classification:'insufficient_evidence',amount_cents:null,concepts:[unit({amount_cents:1_400_000}),unit({classification:'out_of_portfolio',amount_cents:200_000}),unit({classification:'insufficient_evidence',amount_cents:400_000})]});
 const result=conveniRowsFromData(data({units:[current({data:group}),current({unit_id:'u2',data:unit({classification:'discarded'})}),current({unit_id:'u3',data:unit({classification:'insufficient_evidence'})})]}),options);
 assert.deepEqual(result.rows.map(r=>[r.extras.unitId,r.amount,r.carteraCode]),[['u1#1',14000,'1.1.7'],['u1#2',2000,'FORA']]);
 assert.ok(result.notes.some(n=>n.includes('1 unitats amb proposta de descart, 1 amb evidència insuficient')));
});

test('the amount: an approved provision prevails; a joint amount is shown but not added up',()=>{
 assert.equal(conveniUnitAmount(unit({}),{source_record_id:'r1',unit_id:'u1',provider_name:null,provider_nif:null,amount:'7500.00',service_code:'1.1.7',award_date:null,contracting_body:null,target_population:null,period:null}).amount,7500);
 const joint=conveniUnitAmount(unit({joint:true}),undefined);assert.equal(joint.amount,null);assert.equal(joint.documented,10000);
 assert.equal(conveniUnitAmount(unit({amount_cents:null}),undefined).amount,null);
});

test('an approved unit and a record approved before unit proposals are exported as approved',()=>{
 const provision={source_record_id:'r1',unit_id:'u1',provider_name:'Fundació A',provider_nif:'G11111111',amount:9000,service_code:'1.1.6.1',award_date:'2025-04-01',contracting_body:'Ajuntament de Vic',target_population:'Infants',period:'2025'};
 const approved=conveniRowsFromData(data({units:[current({outcome:'select',reviewed_job:'j1',reviewed_code:'1.1.6.1'})],provisions:[provision]}),options).rows[0];
 assert.equal(approved.extras.lineState,'Aprovada');assert.equal(approved.amount,9000);assert.equal(approved.carteraCode,'1.1.6.1');assert.equal(approved.awardDate,'2025-04-01');
 const legacy=conveniRowsFromData(data({units:[],provisions:[{...provision,unit_id:'p0'}]}),options);
 assert.equal(legacy.rows.length,1);assert.equal(legacy.rows[0].amount,9000);assert.equal(legacy.rows[0].extras.lineState,'Aprovada');
 const stale=conveniRowsFromData(data({units:[current({outcome:'select',reviewed_job:'old-job'})]}),options).rows[0];
 assert.equal(stale.extras.lineState,'Pendent de revisió','a review of an earlier job does not approve the current proposal');
 assert.equal(conveniRowsFromData(data({units:[current({outcome:'reject',reviewed_job:'j1'})]}),options).rows.length,0);
});

test('province of the signing local body: municipality, county or Diputació; otherwise pending, never dropped',()=>{
 assert.equal(localBodyProvince('Ajuntament de Sitges').province,'Barcelona');
 assert.equal(localBodyProvince('Ajuntament del Vendrell').province,'Tarragona');
 assert.equal(localBodyProvince('Diputació de Lleida').province,'Lleida');
 assert.equal(localBodyProvince('Consell Comarcal del Baix Penedès').province,'Tarragona');
 assert.equal(localBodyProvince('Consell Comarcal del Berguedà').province,null,'a county split across provinces stays pending');
 assert.equal(localBodyProvince('Ajuntament de l’Hospitalet de Llobregat').province,'Barcelona');
 assert.match(localBodyProvince('Ajuntament de Nolloc').note!,/Província no resolta/);
 assert.equal(localBodyProvince(null).province,null);
 const row=conveniRowsFromData(data({records:[{id:'r1',source_record_id:'2025/11/0001',title:null,source_payload:{...payload,'Organismes signants ens locals':'Ajuntament de Nolloc'}}]}),options).rows[0];
 assert.equal(row.province,null);assert.ok(row.observations.some(o=>o.startsWith('Província no resolta')));
});

test('Concerts and Convenis can be exported together',()=>{
 assert.deepEqual(providersFor(['concert','conveni']).map(p=>p.financingType),['concert','conveni']);
});
