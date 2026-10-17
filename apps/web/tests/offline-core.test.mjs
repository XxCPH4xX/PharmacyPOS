import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProvisional, decimalToMinor, validateActor, buildQuoteLines } from '../public/offline-core.mjs';
const base = { enabled: true, default_rate_bps: 1500, default_mode: 'exclusive', rules: [] };
const lines = [ { product_id:'p', quantity: 2, price_minor: 10000 } ];
test('exclusive tax and percentage discount use integer paisa', () => {
  const result = calculateProvisional(lines, base, 'percent', 1000);
  assert.equal(result.subtotal_minor, 20000);
  assert.equal(result.discount_minor, 2000);
  assert.equal(result.vat_minor, 2700);
  assert.equal(result.total_minor, 20700);
});
test('inclusive VAT does not increase the payable amount', () => {
  const result = calculateProvisional(lines, {...base, default_mode: 'inclusive'}, 'none', 0);
  assert.equal(result.vat_minor, 2609);
  assert.equal(result.total_minor, 20000);
});
test('exempt medicine and fixed discount', () => {
  const result = calculateProvisional(lines, {...base, rules:[{product_id:'p', treatment:'exempt'}]}, 'fixed', 3000);
  assert.equal(result.vat_minor, 0);
  assert.equal(result.total_minor, 17000);
});
test('discount allocation handles one paisa and mixed rates deterministically', () => {
  const result = calculateProvisional([
    { product_id:'a', quantity:1, price_minor:100 },
    { product_id:'b', quantity:1, price_minor:100 }
  ], { ...base, rules:[{ product_id:'b', treatment:'exempt' }]}, 'fixed', 1);
  assert.equal(result.lines[0].discount_minor, 1);
  assert.equal(result.lines[1].discount_minor, 0);
  assert.equal(result.total_minor, 214);
});
test('invalid discount/amount fails closed', () => {
  assert.throws(() => calculateProvisional(lines, base, 'percent', 10001));
  assert.throws(() => decimalToMinor('12.999'));
  assert.equal(decimalToMinor('100.05'), 10005);
});
test('strict actor matching for sync', () => {
  const snap = { userId:7, tenantId:'tenant', branchId:'b' };
  const session = { authenticated:true, user:{id:7}, tenant:{id:'tenant'}, mfa:{required:false},
    branches:[{id:'b'}], memberships:[{role:'cashier',branch_id:'b'}]};
  assert.doesNotThrow(() => validateActor(snap, session));
  assert.throws(() => validateActor(snap, {...session, user:{id:8}}));
  assert.throws(() => validateActor(snap, {...session, mfa:{required:true}}));
  assert.throws(() => validateActor(snap, {...session, memberships:[{role:'auditor',branch_id:'b'}]}));
});
test('sale payload carries server price checks', () => {
  assert.deepEqual(buildQuoteLines({items:[{product_id:'p', quantity:2, base_price_minor:10, price_minor:10, base_units:1}]}),
    [{product_id:'p', quantity:2, expected_price_minor:10, expected_unit_price_minor:10, expected_base_units:1}]);
});
test('workspace default discount is applied when order has no per-sale override', () => {
  const result = calculateProvisional(lines, { ...base, default_product_discount_bps: 1000 }, 'none', 0);
  assert.equal(result.discount_minor, 2000);
  assert.equal(result.total_minor, 20700);
});
