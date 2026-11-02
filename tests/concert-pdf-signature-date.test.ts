import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePdfSignatureDate} from '../lib/concerts/pdf-signature-date';

const valid = `Signature #1:
  - Signing Time: Feb 29 2024 15:02:19
  - Total document signed
  - Signature Validation: Signature is Valid.
  - Certificate Validation: Certificate issuer isn't Trusted.
`;

test('reports signed claimed time and local calendar date without asserting trust',()=>{
 assert.deepEqual(parsePdfSignatureDate(valid),{claimedUtc:'2024-02-29T15:02:19.000Z',localDate:'2024-02-29',certificateTrust:'untrusted'});
});

test('does not confuse UTC date with Madrid date near midnight',()=>{
 assert.equal(parsePdfSignatureDate(valid.replace('Feb 29 2024 15:02:19','Jun 30 2024 22:30:00'))?.localDate,'2024-07-01');
});

test('does not propose dates for altered, partial or ambiguous signature evidence',()=>{
 for(const input of [valid.replace('Signature is Valid.','Signature is Invalid.'),valid.replace('Total document signed','Not total document signed'),valid+'Signature #2:\n',valid.replace('Feb 29 2024','Feb 30 2024'),valid+valid.match(/  - Signing Time:.*\n/)![0]])assert.equal(parsePdfSignatureDate(input),null);
});

test('does not misclassify an unrecognized trust message as trusted',()=>{
 assert.equal(parsePdfSignatureDate(valid.replace("Certificate issuer isn't Trusted.",'Certificate validation unavailable.'))?.certificateTrust,'unknown');
});
