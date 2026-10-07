/** Sprint 1 annex: act types and overlapping attributes stay separate. */
export type ConcertCaseKey='denial'|'termination'|'modification'|'proposal'|'call'|'appeal'|'amendment'|'unspecified'|'vacant'|'territorial'|'mixed'|'program_renewal'|'emergency'|'other_funder'|'spending'|'multiyear'|'cession'|'validation'|'award'|'renewal';
export const concertCase:Record<ConcertCaseKey,{label:string;description:string;tone:'blue'|'amber'|'red'|'violet'}>={
 denial:{label:'Denegació',description:'La sol·licitud es denega; no acredita nou finançament.',tone:'red'},
 termination:{label:'Cessament o minoració',description:'Redueix o extingeix un concert existent. Cal vincular la línia original i acreditar l’efecte econòmic.',tone:'red'},
 modification:{label:'Modificació',description:'Canvia places, import, servei o condicions. Només es compta la diferència econòmica acreditada.',tone:'amber'},
 proposal:{label:'Proposta prèvia',description:'Acte no definitiu. Es contrasta amb la resolució final abans de comptar finançament.',tone:'amber'},
 call:{label:'Convocatòria',description:'Obre el procediment; encara no adjudica places ni import a cap entitat.',tone:'blue'},
 appeal:{label:'Recurs',description:'Revisió d’una decisió. Només crea adjudicació si la resolució acredita finançament nou.',tone:'amber'},
 amendment:{label:'Esmena o rectificació',description:'Corregeix una resolució o publicació. Cal comprovar què canvia; no es duplica l’import original.',tone:'violet'},
 unspecified:{label:'Acte per precisar',description:'El títol no permet saber el tipus d’acte; cal llegir el document.',tone:'amber'},
 vacant:{label:'Places desertes',description:'Places sense adjudicar, llevat que el document assigni una entitat i un import.',tone:'amber'},
 territorial:{label:'Expedient territorial',description:'Un mateix expedient té resolucions territorials diferents; cadascuna conserva les seves línies.',tone:'blue'},
 mixed:{label:'Concert i gestió delegada',description:'El document reuneix dues modalitats. Les línies es revisen individualment.',tone:'blue'},
 program_renewal:{label:'Pròrroga de programa',description:'Un annex prorroga diversos serveis i entitats. Cal evitar sumar imports repetits per disposició.',tone:'blue'},
 emergency:{label:'Provisió d’emergència',description:'Adjudicació urgent. Si l’import és un màxim, no representa necessàriament la despesa real.',tone:'amber'},
 other_funder:{label:'Altres òrgans finançadors',description:'Cal conservar l’òrgan que consta al document; no atribuir la despesa al Departament per defecte.',tone:'blue'},
 spending:{label:'Autorització de despesa',description:'Tràmit comptable; per si sol no adjudica un concert nou.',tone:'amber'},
 multiyear:{label:'Import plurianual',description:'Cobreix més d’un any. Només es reparteix per anualitats quan el document les desglossa.',tone:'blue'},
 cession:{label:'Cessió',description:'Canvia l’entitat prestadora; sense un import nou acreditat, no es crea una altra adjudicació.',tone:'violet'},
 validation:{label:'Convalidació',description:'Confirma la validesa d’un acte anterior; es revisen només els camps que canviïn.',tone:'violet'},
 award:{label:'Provisió',description:'Adjudicació inicial o nova provisió. Cada línia de l’annex es contrasta abans de comptar-la.',tone:'blue'},
 renewal:{label:'Pròrroga',description:'Allarga la vigència del concert. S’enllaça amb l’origen i es revisa el finançament del nou període.',tone:'violet'},
};

export function concertCaseKeys(title:string,unitActs:string[]):ConcertCaseKey[]{
 const t=title.toLocaleLowerCase('ca');let primary:ConcertCaseKey;
 if(/denegaci[oó]|denegad/.test(t))primary='denial';
 else if(/cessament|minoraci[oó]|resoluci[oó] anticipada/.test(t))primary='termination';
 else if(/cessi[oó] del concert|cessi[oó] de la/.test(t))primary='cession';
 else if(/convalid/.test(t))primary='validation';
 else if(/recurs de reposici[oó]|resoluci[oó] del recurs/.test(t))primary='appeal';
 else if(/esmena|rectificaci[oó]/.test(t))primary='amendment';
 else if(/proposta|acord de proposta/.test(t))primary='proposal';
 else if(/convocat[oò]ria/.test(t)&&!/pr[oò]rroga/.test(t))primary='call';
 else if(/places desertes/.test(t))primary='vacant';
 else if(/autoritzaci[oó] de la despesa|autoritzaci[oó] de despesa/.test(t)&&!/pr[oò]rroga|provisi[oó]/.test(t))primary='spending';
 else if(/emerg[eè]ncia/.test(t))primary='emergency';
 else if(/pr[oò]rroga/.test(t)||unitActs.includes('renewal'))primary='renewal';
 else if(/modificaci[oó]|ampliaci[oó]/.test(t)||unitActs.includes('modification'))primary='modification';
 else if(/provisi[oó]|adjudicaci[oó]/.test(t)||unitActs.includes('award'))primary='award';
 else primary='unspecified';
 const keys:ConcertCaseKey[]=[primary];
 if(/exp\.?\s*\d[\d-]+[^)]*\([^)]+\)/.test(t)||/\([^)]*(barcelona|lleida|girona|tarragona)[^)]*\)/.test(t))keys.push('territorial');
 if(/concert social i gesti[oó] delegada|concert social.*gesti[oó] delegada/.test(t))keys.push('mixed');
 if(primary==='renewal'&&/programa\s*\d+/.test(t))keys.push('program_renewal');
 if(/emerg[eè]ncia/.test(t))keys.push('emergency');
 if(/consorci|igualtat i feminismes|\bife\//.test(t))keys.push('other_funder');
 if(/plurianual|\b20\d\d[-–]20\d\d\b/.test(t))keys.push('multiyear');
 return keys;
}
