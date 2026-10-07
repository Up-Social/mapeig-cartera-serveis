import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {assessConcertAct} from '../lib/concerts/act-assessment';

const file=fileURLToPath(new URL('./fixtures/official/25-000163-AP-barcelona-etauler-605700.pdf',import.meta.url));

test('official Barcelona resolution is complete and its act is not confused with appeal instructions',()=>{
 const pdf=readFileSync(file);
 assert.equal(createHash('sha256').update(pdf).digest('hex'),'31e7df4eb6babe1ccc68c94323a19234bd0c1f489a8331b8149fe0f314752683');
 const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8',maxBuffer:2_000_000});
 const result=assessConcertAct('Resolució de l’expedient: 25-000163-AP (Barcelona)',text);
 assert.equal(result.primaryCase,10);
 assert.equal(result.effect,'possible_award');
 assert.equal(result.source,'document');
 assert.ok(!result.overlappingCases.includes(11),'the decree title in legal background is not a mixed award');
 assert.match(text,/RESOLC:/);
 assert.match(text,/Total\s+general[\s\S]{0,250}44\s+113\.340,81\s*€/);
 const amounts=[...text.matchAll(/\b(\d[\d.]*,\d{2})\s*€/g)].map(match=>Number(match[1].replaceAll('.','').replace(',','.')));
 assert.equal(amounts[0],113340.81);
 assert.equal(amounts.at(-1),113340.81);
 assert.equal((amounts.length-2)/2,42,'annex monetary lines; monthly price and line commitment per row');
 assert.equal(Math.round(amounts.slice(2,-1).filter((_,index)=>index%2===0).reduce((sum,value)=>sum+value,0)*100),11334081);
});
