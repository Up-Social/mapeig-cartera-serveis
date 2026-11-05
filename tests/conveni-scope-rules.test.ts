import {test} from 'node:test';
import assert from 'node:assert/strict';
import {screenRecord,type ScopeRule} from '../lib/scope-screening';
import {isPublicBodyName,screenConveniScope} from '../lib/convenis/scope';

// Synthetic rows following the ten Sprint 2 casuistries; no real record IDs.
const row=(others:string|null,fields:Record<string,unknown>={})=>({'Altres Organismes Signants':others,'Organismes signants ens locals':'Ajuntament de Prova','Total aportacions previstes Generalitat':0,'Total aportacions previstes ens locals':1000,'Total aportacions previstes altres Organismes':0,...fields});

test('generic screening keeps rule order and stamps rule, version and mode',()=>{
 const rules:ScopeRule[]=[{id:'first',mode:'proposal',evaluate:()=>null},{id:'second',mode:'auto',evaluate:()=>({reason:'r',label:'l',explanation:'e'})},{id:'third',mode:'proposal',evaluate:()=>({reason:'x',label:'x',explanation:'x'})}];
 assert.deepEqual(screenRecord(rules,'v1',{title:'',payload:{}}),{reason:'r',label:'l',explanation:'e',rule:'second',version:'v1',mode:'auto'});
 assert.equal(screenRecord([],'v1',{title:'',payload:{}}),null);
});

test('casuistry 1: interadministrative agreements are screened from the Excel row before any document',()=>{
 const byTitle=screenConveniScope('Conveni de col·laboració interadministrativa entre el Departament de Drets Socials i l’Ajuntament d’Olost per a la prestació del SAIAR',row(null));
 assert.equal(byTitle?.rule,'interadministrative_agreement');assert.equal(byTitle?.mode,'auto');
 const bySignatories=screenConveniScope('Conveni per a la prestació del servei d’ajuda a domicili del Consell Comarcal amb l’Ajuntament de Prova',row(null,{'Organismes signants ens locals':'Consell Comarcal de Prova; Ajuntament de Prova'}));
 assert.equal(bySignatories?.reason,'interadministrative_agreement');assert.equal(bySignatories?.mode,'proposal');
 assert.match(bySignatories!.explanation,/Consell Comarcal de Prova; Ajuntament de Prova/);
 assert.equal(screenConveniScope('Conveni amb el Consell Comarcal',row('   ;  '))?.rule,'interadministrative_signatories');
});

test('instrumental public bodies listed as other signatories are proposed, private or ambiguous ones are not',()=>{
 for(const name of ['Universitat de Barcelona','Fundació Pública Municipal de Serveis','Consorci de Serveis Socials','SUMAR, Serveis Públics d’Acció Social','Badalona Serveis Assistencials, SA','Institut Municipal de Serveis Socials','l’Ajuntament de Prova'])assert.equal(isPublicBodyName(name),true,name);
 for(const name of ['Universitat de Vic - Universitat Central de Catalunya','Fundació Privada Prova','Consell Esportiu del Baix Camp','Escola Vedruna','Creu Roja','Associació de veïns','Col·legi Sant Josep'])assert.equal(isPublicBodyName(name),false,name);
 const proposal=screenConveniScope('Conveni entre l’Ajuntament i la Universitat',row('Universitat de Barcelona'));
 assert.equal(proposal?.rule,'interadministrative_public_others');assert.equal(proposal?.mode,'proposal');
 assert.equal(screenConveniScope('Conveni entre l’Ajuntament i la Universitat',row('Universitat de Barcelona; Fundació Privada Prova')),null);
});

test('casuistries 2, 3, 5, 7, 8, 9 and 10: a private signatory always goes to documentary analysis',()=>{
 const cases:[string,string,Record<string,unknown>?][]=[
  ['Conveni entre l’Ajuntament de Prova i l’Associació per a la Sostenibilitat per al projecte Vida i dignitat','Associació per a la Sostenibilitat'],
  ['Conveni d’atorgament d’una subvenció nominativa de l’Ajuntament de Prova a Càritas Diocesana','Càritas Diocesana'],
  ['Conveni de col·laboració entre la Diputació de Prova i Càritas Diocesana 2025-2028','Càritas Diocesana',{'Total aportacions previstes ens locals':509780}],
  ['Conveni entre la Diputació, la Federació i les entitats associades','Federació; Entitat A; Entitat B'],
  ['Conveni entre el Consell Comarcal i l’Escola Vedruna en relació amb el servei de menjador escolar','Escola Vedruna'],
  ['Conveni entre l’Ajuntament i l’Associació de Gent Gran','Associació de Gent Gran',{'Total aportacions previstes altres Organismes':1000}],
 ];
 for(const [title,others,fields] of cases)assert.equal(screenConveniScope(title,row(others,fields)),null,title);
});

test('a private-looking party in the title or public columns blocks the signatory proposal',()=>{
 assert.equal(screenConveniScope('Conveni entre l’Ajuntament de Prova i la Fundació Prova',row(null)),null);
 assert.equal(screenConveniScope('Conveni entre l’Ajuntament i Cruz Roja Española',row(null)),null);
 assert.equal(screenConveniScope('Conveni amb el Club de Prova',row(null)),null);
 assert.equal(screenConveniScope('Conveni de servei',row(null,{'Organismes signants ens locals':'Ajuntament de Prova; Associació Prova'})),null);
});

test('casuistry 4: inverse flow is an automatic no-public-funding exclusion that names the flow',()=>{
 const inverse=screenConveniScope('Conveni de col·laboració empresarial entre una empresa i l’Ajuntament per al finançament d’activitats',row('Empresa Prova SAU',{'Total aportacions previstes ens locals':0,'Total aportacions previstes altres Organismes':5000}));
 assert.equal(inverse?.reason,'no_public_funding');assert.equal(inverse?.mode,'auto');assert.match(inverse!.explanation,/flux invers/);
 const zero=screenConveniScope('Conveni',row('Associació',{'Total aportacions previstes ens locals':0}));
 assert.equal(zero?.reason,'no_public_funding');assert.doesNotMatch(zero!.explanation,/flux invers/);
});

test('casuistry 6: an addendum is excluded only when it brings no public funding to a private signatory',()=>{
 assert.equal(screenConveniScope('Segona Addenda al Conveni regulador de la subvenció nominativa a Hermanitas',row(null))?.reason,'excluded_amendment');
 assert.equal(screenConveniScope('Pròrroga del conveni interadministratiu',row('Consell Comarcal de Prova'))?.reason,'excluded_amendment');
 // With a private signatory and public amount it is a new record linked to the original.
 assert.equal(screenConveniScope('Segona Addenda al Conveni regulador de la subvenció nominativa a Hermanitas',row('Hermanitas')),null);
 assert.equal(screenConveniScope('Addenda al conveni',row('Associació Prova',{'Total aportacions previstes ens locals':null})),null);
 assert.equal(screenConveniScope('Addenda al conveni',row('Associació Prova',{'Total aportacions previstes ens locals':0}))?.reason,'excluded_amendment');
 assert.equal(screenConveniScope('Conveni que modifica la segona addenda',row('Associació Prova')),null);
});
