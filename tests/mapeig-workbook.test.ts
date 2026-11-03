import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {buildMapeigWorkbook,dataValidationsOf,NOTES_SHEET,OBSERVATIONS_KEY} from '../lib/exports/mapeig/workbook';
import {summarizeMapeig} from '../lib/exports/mapeig/summary';
import {loadMapeigTemplate,readSummaryCodes} from '../lib/exports/mapeig/template';
import {MapeigTemplateError,type DetallRegistresRow,type MapeigFilters} from '../lib/exports/mapeig/types';

const filters:MapeigFilters={financingTypes:['concert'],provinces:null,awardDateFrom:null,awardDateTo:null};
const row=(partial:Partial<DetallRegistresRow>):DetallRegistresRow=>({
 sourceUrl:'https://tauler.example/edicte/1',sourceId:'etauler:1:1',providerName:'Entitat A',providerNif:'G11111111',mechanism:'Concert',awardDate:'2025-03-10',amount:1000,
 contractingBody:'Departament de Drets Socials i Inclusió',targetPopulation:'Infants',province:'Barcelona',source:'e-Tauler',carteraCode:'1.1.2',extras:{},observations:[],...partial,
});
const fixture:DetallRegistresRow[]=[
 row({}),
 row({sourceId:'etauler:1:2',carteraCode:'1.1.2.1',amount:500,contractingBody:'Departament de Salut',province:'Girona'}),
 row({sourceId:'etauler:1:3',providerNif:'G22222222',carteraCode:'1.1.2.1',amount:-200,contractingBody:'Ajuntament de Vic',province:'Lleida',observations:['Cessament']}),
 row({sourceId:'etauler:1:4',providerNif:null,carteraCode:'FORA',amount:300,contractingBody:'Fundació Privada',province:null,awardDate:null}),
 row({sourceId:'etauler:1:5',carteraCode:null,amount:null,sourceUrl:null}),
 row({sourceId:'etauler:1:6',carteraCode:'1.2.13.1',amount:50,contractingBody:null,province:'Tarragona'}),
];
const extras=[{key:'state',header:'Estat de la línia'},{key:OBSERVATIONS_KEY,header:'Observacions'}];
const options={filters,generatedAt:'2026-11-03T10:00:00Z',origin:'https://example.invalid',extraColumns:extras,catalogCodes:new Map([['1.2.1','Serveis per a infants i adolescents'],['1.2.13.1','Serveis de suport als serveis socials especialitzats']])};
const load=async(bytes:Uint8Array)=>{const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(bytes) as never);return book;};

test('the shipped template passes the structural check and lists the 143 client codes',async()=>{
 const workbook=await loadMapeigTemplate();
 const codes=readSummaryCodes(workbook.getWorksheet('Taula (resum)')!);
 assert.equal(codes.length,143);
 assert.equal(codes[0].code,'1.1.1');assert.equal(codes.at(-1)?.code,'FORA');
 assert.ok(workbook.getWorksheet('Detall_Registres')!.getCell('A1').note,'header notes survive loading');
 await assert.rejects(()=>loadMapeigTemplate(Buffer.from('not a workbook')),/./);
});

test('a manipulated template fails closed',async()=>{
 const workbook=await loadMapeigTemplate();
 workbook.removeWorksheet(workbook.getWorksheet('Llistes_Auxiliars')!.id);
 const bytes=new Uint8Array(await workbook.xlsx.writeBuffer());
 await assert.rejects(()=>buildMapeigWorkbook([],{...options,templateBytes:bytes}),MapeigTemplateError);
});

test('Detall_Registres holds the rows with the template columns, dates, links and extras',async()=>{
 const result=await buildMapeigWorkbook(fixture,{...options,extraColumns:extras,distinctEntities:'formula'});
 const book=await load(result.bytes);
 const detall=book.getWorksheet('Detall_Registres')!;
 assert.equal(result.rowCount,6);assert.equal(result.lastDataRow,7);
 assert.match(String(detall.getCell('A1').value),/Font/);
 assert.equal(detall.getCell('L1').value,'Estat de la línia');assert.equal(detall.getCell('M1').value,'Observacions');
 const link=detall.getCell('A2').value as {text:string;hyperlink:string};
 assert.equal(link.text,'etauler:1:1');assert.equal(link.hyperlink,'https://tauler.example/edicte/1');
 assert.equal(detall.getCell('A6').value,'etauler:1:5');
 assert.ok(detall.getCell('E2').value instanceof Date);assert.equal(detall.getCell('E2').numFmt,'yyyy-mm-dd');
 assert.equal(detall.getCell('E5').value,null);
 assert.equal(detall.getCell('F2').value,1000);assert.equal(detall.getCell('F2').numFmt,'#,##0" €"');
 assert.equal(detall.getCell('F6').value,null);
 assert.equal(detall.getCell('D2').value,'Concert');assert.equal(detall.getCell('J2').value,'e-Tauler');assert.equal(detall.getCell('K3').value,'1.1.2.1');
 assert.equal(detall.getCell('M4').value,'Cessament');
 assert.equal(detall.getCell('A8').value,null,'example rows and the «↑» note are gone');
 assert.equal(detall.autoFilter,'A1:M1');
 assert.equal((detall.views[0] as {ySplit?:number}|undefined)?.ySplit,1);
 const validations=dataValidationsOf(detall);
 assert.equal(validations.find('K2')?.formulae[0],'Lista_Codis_Cartera','K keeps the catalogue list');
 assert.equal(validations.find('K500')?.formulae[0],'Lista_Codis_Cartera');
 assert.equal(validations.find('D2')?.formulae[0],'"Concert,Subvenció,Conveni,Contractació"');
 assert.equal(validations.find('I2')?.formulae[0],'"Barcelona,Tarragona,Girona,Lleida"');
 assert.equal(validations.find('J2')?.formulae[0],'"RAISC,PSCP,Registre de Convenis,e-Tauler"');
 assert.equal(validations.find('E2'),undefined);
});

test('the summary keeps its formulas, loses the broken names and carries computed results',async()=>{
 const result=await buildMapeigWorkbook(fixture,{...options,distinctEntities:'formula'});
 const book=await load(result.bytes);
 const taula=book.getWorksheet('Taula (resum)')!;
 const names=book.definedNames.model.map(name=>name.name);
 assert.ok(names.includes('Lista_Codis_Cartera'));
 assert.ok(!names.some(name=>/^(Org_|Reg_)/.test(name)));
 const o4=taula.getCell('O4');
 assert.ok(o4.formula.includes('Detall_Registres!$G$2:$G$7'));assert.ok(!o4.formula.includes('Org_'));assert.ok(!o4.formula.includes('Reg_'));
 for(const address of ['O147','P160','Q132','R146','E150','M140','N140','Z160']){
  const value=taula.getCell(address).value as unknown as Record<string,unknown>;
  assert.ok(value&&typeof value==='object'&&'formula' in value&&!('sharedFormula' in value),`${address} is an explicit formula`);
 }
 const zip=await JSZip.loadAsync(result.bytes);
 const workbookXml=await zip.file('xl/workbook.xml')!.async('string');
 assert.match(workbookXml,/<calcPr[^>]*fullCalcOnLoad="1"/,'Excel recalculates on open');
 assert.ok(!workbookXml.includes('Org_DSI'));
 const codes=readSummaryCodes(taula);
 const summary=summarizeMapeig(fixture,codes);
 const aggregate=summary.byCode.find(c=>c.code==='1.1.2')!,child=summary.byCode.find(c=>c.code==='1.1.2.1')!;
 assert.equal(aggregate.row,5);
 assert.equal(taula.getCell('E5').result,1300);assert.equal(taula.getCell('F5').result,3);
 assert.equal(taula.getCell('M5').result,1300);assert.equal(taula.getCell('N5').result,'Concert');
 assert.equal(taula.getCell('Z5').result,1000);assert.equal(taula.getCell('Y5').result,'Sí');assert.equal(taula.getCell('X5').result,3);
 assert.equal(taula.getCell('R5').result,2);assert.equal(child.distinctNifs,2);
 assert.equal(taula.getCell('T5').result,1000);assert.equal(taula.getCell('V5').result,500);assert.equal(taula.getCell('W5').result,-200);
 assert.equal(taula.getCell('O5').result,1000/1300);assert.equal(taula.getCell('P5').result,500/1300);assert.equal(taula.getCell('Q5').result,-200/1300);
 assert.equal(taula.getCell('E162').result,1650);assert.equal(taula.getCell('F162').result,6);assert.equal(taula.getCell('M162').result,1650);
 assert.equal(taula.getCell('U162').result,50);
 assert.equal(taula.getCell('M163').result,0,'every code exists once the catalogue code is placed');
 assert.equal(taula.getCell('M164').result,350,'Fundació + blank organ');
 assert.equal(taula.getCell('O162').result,1000/1650);
 assert.equal(taula.getCell('S5').value,null,'column S stays manual');
 assert.equal((taula as unknown as {conditionalFormattings:unknown[]}).conditionalFormattings.length,1);
 assert.ok(taula.model.merges.includes('T1:W2'));
});

test('codes known only to the catalogue are placed in the yellow rows; unknown codes are reported',async()=>{
 const rows=[...fixture,row({sourceId:'etauler:1:7',carteraCode:'9.9.9',amount:10}),row({sourceId:'etauler:1:8',carteraCode:'1.2.1',amount:20})];
 const result=await buildMapeigWorkbook(rows,options);
 const book=await load(result.bytes);
 const taula=book.getWorksheet('Taula (resum)')!;
 assert.deepEqual(result.placedCodes,['1.2.1']);assert.deepEqual(result.unlistedCodes,['9.9.9']);
 assert.equal(taula.getCell('A147').value,'1.2.1');assert.equal(taula.getCell('D147').value,'Dins');
 assert.equal(taula.getCell('E147').result,20);assert.equal(taula.getCell('Y147').result,'Sí','1.2.1.x codes of the Taula are its sublevels');
 assert.equal(taula.getCell('M163').result,10);
 assert.equal(result.summary.counts.unlistedCode,1);
 assert.match(String(book.getWorksheet(NOTES_SHEET)!.getCell('A7').value),/9\.9\.9/);
});

test('an empty export and the value mode for column R do not break the workbook',async()=>{
 const empty=await buildMapeigWorkbook([],options);
 const book=await load(empty.bytes);
 const taula=book.getWorksheet('Taula (resum)')!;
 assert.ok(taula.getCell('O4').formula.includes('$G$2:$G$2'));
 assert.equal(taula.getCell('E162').result,0);
 const valued=await buildMapeigWorkbook(fixture,{...options,distinctEntities:'value'});
 const valuedTaula=(await load(valued.bytes)).getWorksheet('Taula (resum)')!;
 assert.equal(valuedTaula.getCell('R5').value,2);assert.equal(valuedTaula.getCell('R162').value,2);
 const big=Array.from({length:1501},(_,i)=>row({sourceId:`etauler:1:${i}`}));
 const auto=await buildMapeigWorkbook(big,options);
 const autoDetall=(await load(auto.bytes)).getWorksheet('Detall_Registres')!;
 assert.equal((await load(auto.bytes)).getWorksheet('Taula (resum)')!.getCell('R5').value,1);
 assert.equal((autoDetall.getCell('A1502').value as {text:string}).text,'etauler:1:1500');
 assert.equal(dataValidationsOf(autoDetall).find('K1700')?.formulae[0],'Lista_Codis_Cartera','validations grow with the data');
});
