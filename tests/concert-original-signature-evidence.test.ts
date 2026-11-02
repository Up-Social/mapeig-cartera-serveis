import test from 'node:test';
import assert from 'node:assert/strict';
import {originalSignatureEvidence,unambiguousOriginalSignature} from '../lib/concerts/original-signature-evidence';
const footer=(date='29/04/2025')=>`    Doc.original signat per: Document electrònic garantit\n    Signant web csv.gencat.cat fins al 30/04/2028\n    ${date}\n                                               Data creació còpia:\n                                               30/04/2025 10:20:00`;
test('keeps original and authentic copy dates separate with page evidence',()=>{
 const result=originalSignatureEvidence(`## Pàgina 2\n${footer()}`);
 assert.equal(result.length,1);assert.equal(result[0].date,'2025-04-29');assert.equal(result[0].copyDate,'2025-04-30');assert.equal(result[0].page,2);
 assert.match(result[0].quote,/Doc.original signat per:/);
});
test('does not infer signer dates from expiry, copy, invalid dates or another column',()=>{
 assert.deepEqual(originalSignatureEvidence('Data creació còpia: 30/04/2025'),[]);
 assert.deepEqual(originalSignatureEvidence(footer('31/02/2025')),[]);
 assert.deepEqual(originalSignatureEvidence(footer().replace('    29/04/2025','                                             29/04/2025')),[]);
});
test('retains repeated pages but requires review for conflicting original dates',()=>{
 assert.equal(unambiguousOriginalSignature(`## Pàgina 1\n${footer()}\n## Pàgina 2\n${footer()}`)?.length,2);
 assert.equal(unambiguousOriginalSignature(`## Pàgina 1\n${footer()}\n## Pàgina 2\n${footer('28/04/2025')}`),null);
 assert.equal(originalSignatureEvidence(footer())[0].page,null);
 const ambiguousFooter=footer().replace('    29/04/2025','    29/04/2025\n    30/04/2025');
 assert.equal(unambiguousOriginalSignature(`## Pàgina 1\n${ambiguousFooter}\n## Pàgina 2\n${footer()}`),null);
});

test('copy date survives layout text on its row and form-feed pages are explicit',()=>{
 const text=footer().replace('                                               30/04/2025','Original electrònic / Còpia electrònica autèntica 30/04/2025');
 assert.equal(originalSignatureEvidence(text)[0].copyDate,'2025-04-30');
 assert.deepEqual(originalSignatureEvidence(`${text}\f${text}`).map(item=>item.page),[1,2]);
});
