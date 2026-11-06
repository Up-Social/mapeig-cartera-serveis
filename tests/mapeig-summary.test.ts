import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyOrgan,codeMatches} from '../lib/exports/mapeig/organ';
import {dominantMechanism,summarizeMapeig} from '../lib/exports/mapeig/summary';
import {distinctNifFormula,organExpression,organShareFormula} from '../lib/exports/mapeig/formulas';
import {mapeigFilename} from '../lib/exports/mapeig/filename';
import {periodLabel,provincesLabel,typesLabel} from '../lib/exports/mapeig/labels';
import {applyRowFilters,mapeigFiltersToSearchParams,parseMapeigFilters} from '../lib/exports/mapeig/filters';
import {MapeigFilterError,type DetallRegistresRow} from '../lib/exports/mapeig/types';

const row=(partial:Partial<DetallRegistresRow>):DetallRegistresRow=>({
 sourceUrl:null,sourceId:'x',providerName:null,providerNif:'G1',mechanism:'Concert',awardDate:'2025-01-01',amount:100,contractingBody:'Drets Socials',
 targetPopulation:null,province:'Barcelona',source:'e-Tauler',carteraCode:'1.1.2',extras:{},observations:[],...partial,
});

test('organ keywords follow the template: DSI first, then other Generalitat, then local/state',()=>{
 assert.equal(classifyOrgan('Departament de Drets Socials i Inclusió'),'dsi');
 assert.equal(classifyOrgan('ICASS'),'dsi');
 assert.equal(classifyOrgan('Departament de Salut'),'altresGeneralitat');
 assert.equal(classifyOrgan('Generalitat de Catalunya · Educació'),'altresGeneralitat');
 assert.equal(classifyOrgan('ajuntament de vic'),'noGeneralitat');
 assert.equal(classifyOrgan('Consell Comarcal del Vallès Oriental'),'noGeneralitat');
 assert.equal(classifyOrgan('Fundació Privada X'),null);
 assert.equal(classifyOrgan(null),null);
 assert.equal(classifyOrgan('Educacio sense accent'),'altresGeneralitat','the keyword «Educaci» has no accent');
});

test('code matching includes sublevels by prefix only',()=>{
 assert.ok(codeMatches('1.1.2','1.1.2'));assert.ok(codeMatches('1.1.2.1','1.1.2'));assert.ok(codeMatches('1.1.2.1.3','1.1.2'));
 assert.ok(!codeMatches('1.1.20','1.1.2'));assert.ok(!codeMatches('1.1.21','1.1.2'));assert.ok(!codeMatches(null,'1.1.2'));
 assert.ok(codeMatches('fora','FORA'));
});

test('aggregates reproduce the template cascade, control rows and counters',()=>{
 const rows=[
  row({amount:100}),row({carteraCode:'1.1.2.1',amount:50,providerNif:'G2',contractingBody:'Ajuntament de Vic',province:'Girona'}),
  row({carteraCode:'1.1.2.1',amount:null,providerNif:null,contractingBody:null,province:null,awardDate:null}),
  row({carteraCode:'1.1.20',amount:7,mechanism:'Subvenció'}),row({carteraCode:null,amount:3}),
 ];
 const codes=[{code:'1.1.2',row:5},{code:'1.1.2.1',row:6},{code:'1.1.20',row:7}];
 const summary=summarizeMapeig(rows,codes);
 const parent=summary.byCode[0],child=summary.byCode[1];
 assert.equal(parent.totalCents,15000);assert.equal(parent.byMechanism.Concert.count,3,'rows without amount still count');
 assert.equal(parent.ownLevelCents,10000);assert.equal(child.ownLevelCents,5000);assert.equal(parent.hasChildren,true);assert.equal(child.hasChildren,false);
 assert.equal(parent.level,3);assert.equal(child.level,4);
 assert.equal(parent.distinctNifs,2);assert.equal(child.distinctNifs,1);
 assert.equal(parent.share.dsi,10000/15000);assert.equal(parent.share.noGeneralitat,5000/15000);assert.equal(parent.share.altresGeneralitat,0);
 assert.equal(parent.byProvince.Barcelona,10000);assert.equal(parent.byProvince.Girona,5000);
 assert.equal(summary.total.totalCents,16000);assert.equal(summary.total.ownLevelSumCents,15700);assert.equal(summary.unmatchedCents,300);
 assert.equal(summary.unclassifiedOrganCents,0);
 assert.deepEqual(summary.counts,{withoutNif:1,withoutCode:1,withoutAmount:1,withoutDate:1,withoutProvince:1,withoutOrgan:1,unlistedCode:0});
 assert.equal(dominantMechanism({Concert:{amountCents:5,count:1},'Subvenció':{amountCents:5,count:1},Conveni:{amountCents:0,count:0},'Contractació':{amountCents:0,count:0}}),'Concert','ties go to the earlier mechanism');
 assert.equal(dominantMechanism({Concert:{amountCents:0,count:2},'Subvenció':{amountCents:0,count:0},Conveni:{amountCents:0,count:0},'Contractació':{amountCents:0,count:0}}),'Sense dades');
 assert.equal(summarizeMapeig([row({carteraCode:'FORA',amount:1})],[{code:'FORA',row:146}]).byCode[0].level,'-');
});

test('inline formulas replace the defined names with the same keyword logic',()=>{
 assert.equal(organExpression('dsi',10),'SIGN(ISNUMBER(SEARCH("Drets Socials",Detall_Registres!$G$2:$G$10))+ISNUMBER(SEARCH("ICASS",Detall_Registres!$G$2:$G$10)))');
 assert.ok(organExpression('noGeneralitat',10).startsWith('(1-SIGN(ISNUMBER(SEARCH("Drets Socials"'));
 assert.ok(organExpression('noGeneralitat',10).includes('ISNUMBER(SEARCH("Gobierno",Detall_Registres!$G$2:$G$10))'));
 assert.ok(organShareFormula(4,'dsi',1).includes('$G$2:$G$2'),'an empty sheet still yields a valid range');
 assert.ok(organShareFormula(4,'dsi',10).startsWith('IF(OR($A4="",M4=0),"",SUMPRODUCT(((Detall_Registres!$K$2:$K$10=$A4)+(LEFT(Detall_Registres!$K$2:$K$10,LEN($A4)+1)=$A4&"."))*'));
 assert.ok(distinctNifFormula(4,10).includes('COUNTIFS(Detall_Registres!$C$2:$C$10,Detall_Registres!$C$2:$C$10,Detall_Registres!$K$2:$K$10,$A4)'));
});

test('filters parse once for the page and the route, and never drop rows for missing data',()=>{
 const parsed=parseMapeigFilters(new URLSearchParams('type=concert&province=Barcelona&province=Girona&from=2025&to=2025'));
 assert.deepEqual(parsed,{financingTypes:['concert'],provinces:['Barcelona','Girona'],yearFrom:2025,yearTo:2025});
 assert.equal(mapeigFiltersToSearchParams(parsed).toString(),'type=concert&province=Barcelona&province=Girona&from=2025&to=2025');
 assert.deepEqual(parseMapeigFilters({type:'concert'}),{financingTypes:['concert'],provinces:null,yearFrom:null,yearTo:null});
 assert.throws(()=>parseMapeigFilters(new URLSearchParams('')),MapeigFilterError);
 assert.deepEqual(parseMapeigFilters(new URLSearchParams('type=concert&type=conveni')).financingTypes,['concert','conveni']);
 assert.throws(()=>parseMapeigFilters(new URLSearchParams('type=subvencio')),/encara no està disponible/);
 assert.throws(()=>parseMapeigFilters(new URLSearchParams('type=altres')),/Tipologia no vàlida/);
 assert.throws(()=>parseMapeigFilters(new URLSearchParams('type=concert&province=Madrid')),/Província no vàlida/);
 assert.throws(()=>parseMapeigFilters(new URLSearchParams('type=concert&from=2025-02-30')),/«des de»/);
 assert.throws(()=>parseMapeigFilters(new URLSearchParams('type=concert&to=abcd')),/«fins a»/);
 assert.throws(()=>parseMapeigFilters(new URLSearchParams('type=concert&from=2025&to=2024')),/posterior o igual/);
 const rows=[row({province:'Barcelona',awardDate:'2025-06-01'}),row({province:'Girona'}),row({province:null,awardDate:null}),row({awardDate:'2024-01-01'})];
 const filtered=applyRowFilters(rows,parsed);
 assert.equal(filtered.rows.length,3);assert.deepEqual(filtered.excluded,{province:0,dateRange:1});
 assert.deepEqual(filtered.rows[2].observations,['Província no identificada: no filtrada per territori','Data de concessió no identificada: no filtrada pel període']);
 const onlyBarcelona=applyRowFilters(rows,{...parsed,provinces:['Barcelona']});
 assert.equal(onlyBarcelona.excluded.province,1);
 const open=applyRowFilters(rows,{financingTypes:['concert'],provinces:null,yearFrom:null,yearTo:null});
 assert.equal(open.rows.length,4);assert.deepEqual(open.rows[2].observations,[]);
 assert.equal(applyRowFilters(rows,{...parsed,yearFrom:2024,yearTo:null}).excluded.dateRange,0);
});

test('file names say what they contain, in ASCII',()=>{
 assert.equal(mapeigFilename({financingTypes:['concert'],provinces:null,yearFrom:null,yearTo:null},'2026-11-03'),'Mapeig-Cartera_Concerts_Catalunya_tot-el-periode_2026-11-03.xlsx');
 assert.equal(mapeigFilename({financingTypes:['concert'],provinces:['Girona','Barcelona'],yearFrom:2024,yearTo:2025},'2026-11-03'),'Mapeig-Cartera_Concerts_Barcelona+Girona_2024-2025_2026-11-03.xlsx');
 assert.equal(mapeigFilename({financingTypes:['concert'],provinces:null,yearFrom:2025,yearTo:2025},'2026-11-03'),'Mapeig-Cartera_Concerts_Catalunya_2025_2026-11-03.xlsx');
 assert.equal(mapeigFilename({financingTypes:['concert','subvencio'],provinces:['Barcelona','Tarragona','Girona','Lleida'],yearFrom:2025,yearTo:null},'2026-11-03'),'Mapeig-Cartera_Concerts+Subvencions_Catalunya_des-de-2025_2026-11-03.xlsx');
 assert.match(mapeigFilename({financingTypes:['contractacio'],provinces:null,yearFrom:null,yearTo:2025},'2026-11-03'),/^[\x20-\x7e]+$/);
});

test('history labels share the wording of the filters',()=>{
 assert.equal(periodLabel({yearFrom:null,yearTo:null}),'tots els anys');
 assert.equal(periodLabel({yearFrom:2024,yearTo:2025}),'2024–2025');
 assert.equal(periodLabel({yearFrom:2025,yearTo:2025}),'2025');
 assert.equal(periodLabel({yearFrom:2024,yearTo:null}),'des de 2024');
 assert.equal(periodLabel({yearFrom:null,yearTo:2025}),'fins a 2025');
 assert.equal(provincesLabel(null),'Catalunya');
 assert.equal(provincesLabel(['Girona','Barcelona']),'Barcelona, Girona');
 assert.equal(provincesLabel(['Barcelona','Tarragona','Girona','Lleida']),'Catalunya');
 assert.equal(typesLabel(['concert','subvencio']),'Concerts, Subvencions');
});
