import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {eurFromUsd,formatAiCost} from '../lib/currency';
import {parseEcbDollarRate} from '../lib/ecb-rate';

test('ECB USD reference rate converts recorded USD costs without losing small averages',()=>{
  const rate=parseEcbDollarRate("<Cube time='2026-10-07'><Cube currency='USD' rate='1.1177'/></Cube>",new Date('2026-10-08T12:00:00Z'));
  assert.deepEqual(rate,{date:'2026-10-07',usdPerEuro:1.1177});
  assert.ok(rate);
  assert.equal(eurFromUsd(1.1177,rate),1);
  assert.match(formatAiCost(0.0191470875,rate),/0,01713/);
});

test('missing, invalid or stale ECB data cannot masquerade as a current EUR rate',()=>{
  assert.equal(parseEcbDollarRate("<Cube time='2026-10-07'><Cube currency='USD' rate='0'/></Cube>",new Date('2026-10-08T12:00:00Z')),null);
  assert.equal(parseEcbDollarRate("<Cube time='2026-09-01'><Cube currency='USD' rate='1.1'/></Cube>",new Date('2026-10-08T12:00:00Z')),null);
  assert.equal(parseEcbDollarRate('<html>unavailable</html>'),null);
});
