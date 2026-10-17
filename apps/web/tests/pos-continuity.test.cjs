const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/pos-continuity.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  fileName: 'pos-continuity.ts',
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
});
assert.equal(compiled.diagnostics.length, 0);
const moduleUnderTest = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputText)(
  (name) => {
    if (name === '@/lib/api') return { api: () => { throw Error('Unexpected HTTP call'); }, ApiError: class ApiError extends Error {} };
    throw Error(`Unexpected import: ${name}`);
  },
  moduleUnderTest,
  moduleUnderTest.exports,
);
const { calculateOfflineQuote, validateSyncActor, reservedBaseUnits, isCorrectableRejection } = moduleUnderTest.exports;

const tax = {
  enabled: true,
  default_rate_bps: 500,
  default_mode: 'exclusive',
  rules: [],
  default_product_discount_bps: 1000,
  version: 7,
};
const line = (id, price, quantity = 1) => ({
  product_id: id, quantity, expected_price_minor: price,
  expected_unit_price_minor: price, expected_base_units: 1,
});

test('offline prices use the workspace default discount with VAT after discount', () => {
  const q = calculateOfflineQuote([line('a', 100000)], tax, 'none', 0);
  assert.deepEqual([q.subtotal_minor, q.discount_minor, q.vat_minor, q.total_minor], [100000, 10000, 4500, 94500]);
  assert.equal(q.settings_version, 7);
});

test('inclusive VAT does not increase payable total', () => {
  const q = calculateOfflineQuote([line('a', 10000)], {
    ...tax, default_mode: 'inclusive', default_product_discount_bps: 0,
  }, 'none', 0);
  assert.equal(q.vat_minor, 476);
  assert.equal(q.total_minor, 10000);
});

test('allocation rounds one paisa deterministically', () => {
  const q = calculateOfflineQuote([line('a', 1), line('b', 1)], {
    ...tax, enabled: false, default_product_discount_bps: 5000,
  }, 'none', 0);
  assert.equal(q.discount_minor, 1);
  assert.deepEqual(q.lines.map((x) => x.discount_minor), [1, 0]);
});

test('custom discount, duplicates and packaged units fail closed offline', () => {
  assert.throws(() => calculateOfflineQuote([line('a', 1000)], tax, 'fixed', 100), /online manager/);
  assert.throws(() => calculateOfflineQuote([line('a', 1), line('a', 1)], tax, 'none', 0), /Duplicate/);
  assert.throws(() => calculateOfflineQuote([{ ...line('a', 100), unit_id: 'box' }], tax, 'none', 0), /Packaged/);
});

test('queued and review stock remain reserved until sync', () => {
  const payload = { lines: [line('a', 10, 2)], payment_method: 'cash' };
  const used = reservedBaseUnits([
    { status: 'queued', payload },
    { status: 'needs_review', payload },
    { status: 'synced', payload },
    { status: 'superseded', payload },
  ]);
  assert.equal(used.a, 4);
});

test('only definitive rejected checkouts can be corrected', () => {
  const sale = { status: 'needs_review', errorCode: 'price_changed' };
  assert.equal(isCorrectableRejection(sale), true);
  assert.equal(isCorrectableRejection({ ...sale, errorCode: 'unit_changed' }), true);
  assert.equal(isCorrectableRejection({ ...sale, status: 'queued' }), false);
  assert.equal(isCorrectableRejection({ ...sale, errorCode: 'idempotency_conflict' }), false);
  assert.equal(isCorrectableRejection({ ...sale, errorCode: undefined }), false);
});

test('sync requires original authenticated actor, tenant, branch, role and MFA', () => {
  const good = {
    authenticated: true,
    user: { id: 'c1' }, tenant: { id: 't1' },
    branches: [{ id: 'b1' }], memberships: [{ branch_id: 'b1', role: 'cashier' }],
    mfa: { required: false },
  };
  assert.doesNotThrow(() => validateSyncActor('t1:c1', 'b1', good));
  assert.throws(() => validateSyncActor('t1:c2', 'b1', good), /original cashier/);
  assert.throws(() => validateSyncActor('t2:c1', 'b1', good), /original cashier/);
  assert.throws(() => validateSyncActor('t1:c1', 'b2', good), /original cashier/);
  assert.throws(() => validateSyncActor('t1:c1', 'b1', { ...good, mfa: { required: true } }), /original cashier/);
  assert.throws(() => validateSyncActor('t1:c1', 'b1', { ...good, memberships: [{ branch_id: 'b1', role: 'auditor' }] }), /original cashier/);
});
