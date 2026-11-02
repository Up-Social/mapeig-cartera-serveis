import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractResolcAward} from '../lib/concerts/resolc-extraction';

const text="## Pàgina 2\n\nRESOLC: 1. Assignar a l’entitat Fundació Prova, amb NIF G12345678, 4 places del Servei d’acompanyament de joves, en règim de concert social a la comarca del Segrià. Assignació del servei: Nom del servei social: Pis Prova Núm. Expedient: PROVIS-01 Preu: 97,07 euros al dia. 2. L’entitat consta inscrita amb el número S12345. 3. Autoritzar la despesa derivada.";
test('a single operative award produces a source-backed draft and never calculates a total from a tariff',()=>{
 const line=extractResolcAward(text);
 assert.ok(line);
 assert.equal(line.page,2);assert.equal(line.providerName,'Fundació Prova');assert.equal(line.nif,'G12345678');
 assert.equal(line.quantity,4);assert.equal(line.centre,'Pis Prova');assert.equal(line.resesCode,'S12345');
 assert.equal(line.territory,'Segrià');
 assert.ok(!('amount' in line));assert.ok(text.replace(/\s+/g,' ').includes(line.quote));
});
test('ambiguous acts and multiple beneficiaries are not silently turned into one unit',()=>{
 assert.equal(extractResolcAward(text.replace('RESOLC:','PROPOSO:')),null);
 assert.equal(extractResolcAward(text.replace('2. L’entitat','2. Assignar a l’entitat Fundació Segona i després L’entitat')),null);
 assert.equal(extractResolcAward(text.replace('4 places','4 places i 3 places')),null);
});
test('a missing NIF or registry number remains unknown',()=>{
 const line=extractResolcAward(text.replace(', amb NIF G12345678','').replace(' amb el número S12345',''));
 assert.ok(line);assert.equal(line.nif,null);assert.equal(line.resesCode,null);
});

test('multiple numbered operative awards retain separate literal clauses and pages',async()=>{
 const {extractResolcAwards}=await import('../lib/concerts/resolc-extraction');
 const first='1. Assignar a l’entitat Fundació Primera, amb NIF G12345678, 4 places del Servei d’acompanyament, en règim de concert social a la comarca del Segrià. Nom del servei social: Pis Primer Núm. Expedient: EXP-1. Número S12345.';
 const second='2. Assignar a l’entitat Fundació Segona, amb NIF G87654321, 3 places del Servei de suport, en règim de concert social a la comarca del Bages. Nom del servei social: Pis Segon Núm. Expedient: EXP-2. Número S54321.';
 const doc=`## Pàgina 1\nAntecedents: assignar a l’entitat és una expressió històrica.\nRESOLC: ${first}\n## Pàgina 2\n${second}\n3. Autoritzar la despesa.`;
 const acrossPages=extractResolcAwards(doc);assert.deepEqual(acrossPages.map(line=>line.page),[1,2]);
 assert.ok(acrossPages.every(line=>doc.replace(/\s+/g,' ').includes(line.quote)));
 // A page header inside a clause cannot be attributed to one page.
 assert.deepEqual(extractResolcAwards(doc.replace('Nom del servei social: Pis Primer','\n## Pàgina 8\nNom del servei social: Pis Primer')),[]);
 const samePage=`## Pàgina 1\nAntecedents: assignar a l’entitat és una expressió històrica.\nRESOLC: ${first} ${second} 3. Autoritzar la despesa.`;
 const lines=extractResolcAwards(samePage);assert.equal(lines.length,2);
 assert.deepEqual(lines.map(line=>[line.row,line.providerName,line.quantity,line.resesCode]),[[1,'Fundació Primera',4,'S12345'],[2,'Fundació Segona',3,'S54321']]);
 assert.ok(lines.every(line=>samePage.replace(/\s+/g,' ').includes(line.quote)));
 assert.ok(lines.every(line=>!('amount' in line)));
 assert.deepEqual(extractResolcAwards(samePage.replace('3 places del Servei','3 places i 2 places del Servei')),[]);
 assert.deepEqual(extractResolcAwards(`## Pàgina 1\nRESOLC: ${first} 2. Autoritzar la despesa. ${second}`),[]);
});

test('a single award spanning physical pages is not assigned to the first page alone',async()=>{
 const {extractResolcAwards}=await import('../lib/concerts/resolc-extraction');
 const split=text.replace('Nom del servei social:', '\n## Pàgina 3\nNom del servei social:');
 assert.ok(extractResolcAward(split)); // Legacy single-clause reader has no page boundary guard.
 assert.deepEqual(extractResolcAwards(split),[]);
});
