import { calculateProvisional, decimalToMinor, money, validateActor, buildQuoteLines } from '/offline-core.mjs';

const $ = (id) => document.getElementById(id);
const DB_NAME = 'pharmacore-offline-register-v1';
const STORE = 'encrypted-vault';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const state = { vault: null, key: null, salt: null, cart: [], preparing: false, syncing: false, saving: false, hasStoredVault: false };

function message(text, kind = 'success') {
  $('message').replaceChildren();
  if (!text) return;
  const element = document.createElement('div');
  element.className = kind;
  element.textContent = text;
  $('message').append(element);
}
function connectionStatus() {
  $('connection').textContent = navigator.onLine ? 'Network appears online' : 'Offline / no connection';
  $('connection').className = `pill${navigator.onLine ? '' : ' off'}`;
}
const moneyInput = (minor) => (minor / 100).toFixed(2);
const randomBytes = (count) => crypto.getRandomValues(new Uint8Array(count));
const encode64 = (bytes) => btoa(String.fromCharCode(...bytes));
const decode64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const doc = (tag, text, className) => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
};
const safeButton = (label, fn, className = '') => {
  const button = doc('button', label, className);
  button.type = 'button';
  button.addEventListener('click', fn);
  return button;
};

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function readBlob() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get('vault');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}
async function writeBlob(value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(value, 'vault');
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}
async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
async function seal() {
  if (!state.key || !state.vault || !state.salt) throw new Error('Offline register is locked.');
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, state.key, encoder.encode(JSON.stringify(state.vault)));
  await writeBlob({ salt: encode64(state.salt), iv: encode64(iv), payload: encode64(new Uint8Array(ciphertext)) });
}
async function api(path, options = {}, branch = '') {
  const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrftoken='))?.slice(10);
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(csrf ? { 'X-CSRFToken': decodeURIComponent(csrf) } : {}),
    ...(branch ? { 'X-Branch-ID': branch } : {}),
    ...(options.headers || {}) };
  const response = await fetch(`/api/v1/${path}`, {
    method: options.method || 'GET', credentials: 'same-origin', cache: 'no-store',
    headers, ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) {
    let detail = `Server returned HTTP ${response.status}.`;
    try { const data = await response.json(); detail = data.error?.message || detail; } catch { /* use status */ }
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
async function fetchCatalog(branch) {
  const records = [];
  let count = 1;
  while (records.length < count) {
    const result = await api(`catalog/?limit=200&offset=${records.length}`, {}, branch);
    if (!result.results?.length && records.length < count) throw new Error('Could not download full medicine catalog.');
    records.push(...result.results);
    count = result.count;
    if (count > 5000) throw new Error('Offline catalog is too large for this register.');
  }
  return records.filter((p) => p.active && !p.prescription_required && p.base_available > 0)
    .map((p) => ({ id: p.id, name: p.name, strength: p.strength, generic: p.generic,
      sku: p.sku, barcode: p.barcode, price_minor: p.price_minor, base_available: p.base_available }));
}
async function fetchSnapshot(session, branch) {
  if (!session.authenticated || session.mfa?.required) throw new Error('Sign in and complete MFA before preparing offline access.');
  const snapshot = { userId: session.user.id, tenantId: session.tenant.id, branchId: branch,
    branchName: session.branches.find((b) => b.id === branch)?.name || branch };
  validateActor(snapshot, session);
  const catalog = await fetchCatalog(branch);
  const tax = await api('settings/tax/', {}, branch);
  const capturedAt = new Date().toISOString();
  return { ...snapshot, capturedAt, expiresAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
    catalog, tax };
}
async function loadBranches() {
  try {
    const session = await api('auth/session/');
    if (!session.authenticated || session.mfa?.required) throw new Error('Log in and complete MFA in the main POS first.');
    $('branch').replaceChildren();
    for (const branch of session.branches || []) {
      if (session.memberships?.some((m) => (!m.branch_id || m.branch_id === branch.id) &&
          ['owner', 'manager', 'cashier'].includes(m.role))) {
        const opt = doc('option', branch.name);
        opt.value = branch.id;
        $('branch').append(opt);
      }
    }
  } catch (error) {
    $('branch').replaceChildren(doc('option', 'Sign in to PharmaCore first'));
    message(error.message, 'error');
  }
}
async function prepare() {
  if (state.preparing) return;
  state.preparing = true;
  $('prepare').disabled = true;
  try {
    if (await readBlob()) throw new Error('A vault already exists. Unlock it, sync all pending orders, then refresh the snapshot instead.');
    const password = $('newPass').value;
    if (password.length < 12) throw new Error('Use a passphrase of at least 12 characters.');
    if (!$('branch').value) throw new Error('Select a branch.');
    const session = await api('auth/session/');
    const snapshot = await fetchSnapshot(session, $('branch').value);
    if (!snapshot.catalog.length) throw new Error('No eligible medicines with stock were found.');
    state.salt = randomBytes(16);
    state.key = await deriveKey(password, state.salt);
    state.vault = { schema: 1, snapshot, orders: [] };
    setDefaultDiscount();
    await seal();
    state.hasStoredVault = true;
    $('newPass').value = '';
    $('setup').classList.add('hidden');
    $('unlock').classList.remove('hidden');
    render();
    message('Encrypted offline register prepared. Keep your passphrase safe and open this page once before going offline.');
  } catch (error) {
    message(error.message, 'error');
  } finally {
    state.preparing = false;
    $('prepare').disabled = false;
  }
}
async function unlock() {
  try {
    const record = await readBlob();
    if (!record) throw new Error('No offline snapshot on this device. Prepare while online.');
    const salt = decode64(record.salt);
    const key = await deriveKey($('pass').value, salt);
    let decoded;
    try {
      decoded = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: decode64(record.iv) }, key, decode64(record.payload));
    } catch { throw new Error('Incorrect passphrase or damaged offline register.'); }
    const vault = JSON.parse(decoder.decode(decoded));
    if (vault.schema !== 1 || !Array.isArray(vault.orders)) throw new Error('Unsupported offline register format.');
    state.key = key;
    state.salt = salt;
    state.vault = vault;
    setDefaultDiscount();
    $('pass').value = '';
    render();
    message('Offline register unlocked. Only server-confirmed orders are completed sales.');
    if (navigator.onLine) void sync();
  } catch (error) { message(error.message, 'error'); }
}
function lock() {
  state.key = null;
  state.salt = null;
  state.vault = null;
  state.cart = [];
  render();
  message('Offline register locked.');
}
function setDefaultDiscount() {
  const bps = state.vault?.snapshot?.tax?.default_product_discount_bps || 0;
  $('discountType').value = bps > 0 ? 'percent' : 'none';
  $('discount').value = bps > 0 ? moneyInput(bps) : '0';
}
function isExpired() { return state.vault && Date.now() > Date.parse(state.vault.snapshot.expiresAt); }
function usedStock(productId) {
  const snapshotAt = state.vault.snapshot.capturedAt;
  return state.vault.orders.filter((o) => o.snapshotAt === snapshotAt && o.status !== 'discarded')
    .flatMap((o) => o.items).filter((item) => item.product_id === productId)
    .reduce((sum, item) => sum + item.quantity, 0);
}
function remainingStock(product) {
  const cartQuantity = state.cart.find((item) => item.product_id === product.id)?.quantity || 0;
  return Math.max(0, product.base_available - usedStock(product.id) - cartQuantity);
}
function cartTotal() {
  const items = state.cart.map((item) => {
    const product = state.vault.snapshot.catalog.find((p) => p.id === item.product_id);
    if (!product) throw new Error('Medicine no longer in offline snapshot.');
    return { ...item, price_minor: product.price_minor };
  });
  const kind = $('discountType').value;
  const amount = kind === 'none' ? 0 : decimalToMinor($('discount').value || '0');
  const quote = calculateProvisional(items, state.vault.snapshot.tax, kind, amount);
  return { items, kind, amount, quote };
}
function renderCatalog() {
  const results = $('results'); results.replaceChildren();
  const search = $('search').value.trim().toLowerCase();
  const products = state.vault.snapshot.catalog.filter((p) =>
    [p.name, p.generic, p.strength, p.sku, p.barcode].some((value) => (value || '').toLowerCase().includes(search)))
    .slice(0, 40);
  for (const p of products) {
    const row = doc('div', '', 'item');
    const left = doc('div', ''); left.append(doc('b', `${p.name} ${p.strength || ''}`),
      doc('small', `${p.sku} · ${money(p.price_minor)} · available ${remainingStock(p)}`));
    const add = safeButton('+ Add', () => {
      if (isExpired()) return message('Offline snapshot expired. Reconnect and refresh before new orders.', 'error');
      if (remainingStock(p) < 1) return message('Cached eligible stock exhausted. Reconnect to refresh.', 'error');
      const existing = state.cart.find((line) => line.product_id === p.id);
      if (existing) existing.quantity += 1;
      else state.cart.push({ product_id: p.id, quantity: 1 });
      render();
    });
    add.disabled = remainingStock(p) < 1 || isExpired();
    row.append(left, add); results.append(row);
  }
  if (!products.length) results.append(doc('p', 'No matching medicines.', 'muted'));
}
function renderCart() {
  const lines = $('lines'); lines.replaceChildren();
  for (const item of state.cart) {
    const p = state.vault.snapshot.catalog.find((record) => record.id === item.product_id);
    const row = doc('div', '', 'item');
    const left = doc('div', ''); left.append(doc('b', p.name), doc('small', `${money(p.price_minor)} × ${item.quantity}`));
    const controls = doc('div', '', 'selection');
    controls.append(safeButton('−', () => { item.quantity -= 1; if (!item.quantity) state.cart = state.cart.filter((x) => x !== item); render(); }));
    controls.append(doc('span', String(item.quantity)));
    controls.append(safeButton('+', () => { if (remainingStock(p) > 0) item.quantity++; else message('Cached eligible stock exhausted.', 'error'); render(); }));
    row.append(left, controls); lines.append(row);
  }
  if (!state.cart.length) lines.append(doc('p', 'No medicines selected.', 'muted'));
  const totals = $('totals'); totals.replaceChildren();
  if (!state.cart.length) return;
  try {
    const { quote } = cartTotal();
    for (const [label, value] of [['Subtotal', quote.subtotal_minor], ['Discount', -quote.discount_minor], ['VAT', quote.vat_minor]]) {
      const row = doc('div', '', 'total'); row.append(doc('span', label), doc('span', `${value < 0 ? '−' : ''}${money(Math.abs(value))}`)); totals.append(row);
    }
    const last = doc('div', '', 'total grand');
    last.append(doc('span', 'Estimated payable'), doc('span', money(quote.total_minor))); totals.append(last);
    try {
      const received = decimalToMinor($('tendered').value);
      const change = doc('div', '', 'total');
      change.append(doc('span', received >= quote.total_minor ? 'Change to return' : 'Still due'),
        doc('span', money(Math.abs(received - quote.total_minor))));
      totals.append(change);
    } catch { /* No cash amount entered yet. */ }
  } catch (error) { totals.append(doc('p', error.message, 'error')); }
}
function renderQueue() {
  const panel = $('orders'); panel.replaceChildren();
  for (const order of [...state.vault.orders].reverse()) {
    const row = doc('article', '');
    const label = order.status === 'synced' ? `Synced · ${order.receipt_number}` :
      order.status === 'needs_review' ? 'Requires review — not synced' :
      order.status === 'reviewed' ? 'Manually reconciled (not posted by offline register)' :
      'Pending sync — not a final sale';
    row.append(doc('b', `${money(order.total_minor)} · ${label}`),
      doc('small', `${new Date(order.createdAt).toLocaleString()} · ${order.items.length} medicines · ${order.key.slice(0, 8)}`));
    if (order.error) row.append(doc('small', order.error, 'conflict'));
    if (order.status === 'queued') row.append(safeButton('Print provisional slip', () => printProvisional(order)));
    if (order.status === 'needs_review') row.append(safeButton('Mark manually reconciled', async () => {
      if (prompt('Verify against the live server ledger and enter RECONCILED to close this local order:') !== 'RECONCILED') return;
      const previous = order.status; order.status = 'reviewed';
      try { await seal(); message('Marked as manually reconciled. No sale was recorded by this action.'); render(); }
      catch (error) { order.status = previous; message(error.message, 'error'); }
    }, 'danger'));
    panel.append(row);
  }
  if (!state.vault.orders.length) panel.append(doc('p', 'No offline orders.', 'muted'));
}
function render() {
  const active = !!state.vault;
  $('setup').classList.toggle('hidden', active || state.hasStoredVault);
  $('unlock').classList.toggle('hidden', active || !state.hasStoredVault);
  $('register').classList.toggle('hidden', !active);
  $('lockButton').classList.toggle('hidden', !active);
  if (!active) { $('snapshotLabel').textContent = state.hasStoredVault ? 'Offline register locked' : 'No offline snapshot loaded'; return; }
  const snap = state.vault.snapshot;
  $('snapshotLabel').textContent = `${snap.branchName} · ${snap.catalog.length} medicines · snapshot ${new Date(snap.capturedAt).toLocaleString()}${isExpired() ? ' · EXPIRED' : ''}`;
  $('queueButton').disabled = isExpired() || state.syncing || state.saving || state.cart.length === 0;
  $('syncButton').disabled = state.syncing || !state.vault.orders.some((o) => o.status === 'queued');
  $('refreshStock').disabled = state.syncing || state.vault.orders.some((o) => o.status === 'queued' || o.status === 'needs_review');
  renderCatalog(); renderCart(); renderQueue();
}
function printProvisional(order) {
  const pane = window.open('', '_blank', 'width=580,height=650');
  if (!pane) return message('Allow the browser print popup for a provisional slip.', 'error');
  const escaped = (v) => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  pane.document.write(`<html><head><title>Provisional order</title><style>body{font-family:Arial;padding:30px}h2{color:#a32121}li{margin:9px 0}</style></head><body><h2>PROVISIONAL — NOT A TAX INVOICE</h2><p>Offline order ${escaped(order.key)}</p><p>Recorded ${escaped(new Date(order.createdAt).toLocaleString())}</p><ul>${order.items.map((i) => `<li>${escaped(i.name)} × ${i.quantity}: ${money(i.quantity * i.price_minor)}</li>`).join('')}</ul><p>Estimated subtotal: ${money(order.subtotal_minor)}</p><p>Discount: ${money(order.discount_minor)}</p><p>VAT: ${money(order.vat_minor)}</p><h3>Estimated total ${money(order.total_minor)}</h3><p>Cash received ${money(order.tendered_minor)}</p><strong>Pending server confirmation. This is not proof of a completed transaction.</strong></body></html>`);
  pane.document.close();
  pane.focus(); pane.print();
}
async function queueOrder() {
  if (state.saving) return;
  state.saving = true;
  $('queueButton').disabled = true;
  try {
    if (isExpired()) throw new Error('Offline snapshot expired. Reconnect and refresh before new orders.');
    if (state.vault.orders.filter((o) => o.status !== 'synced').length >= 100) throw new Error('100 unresolved orders reached. Sync or review them first.');
    const { items, kind, amount, quote } = cartTotal();
    const cash = decimalToMinor($('tendered').value);
    if (cash < quote.total_minor) throw new Error('Cash received does not cover the provisional amount.');
    const order = {
      key: crypto.randomUUID(), createdAt: new Date().toISOString(), snapshotAt: state.vault.snapshot.capturedAt,
      items: items.map((item) => ({ product_id: item.product_id, name: state.vault.snapshot.catalog.find((p) => p.id === item.product_id).name,
        quantity: item.quantity, base_price_minor: item.price_minor, price_minor: item.price_minor, base_units: 1 })),
      discount_type: kind, discount_value: amount, expected_tax_version: state.vault.snapshot.tax.version,
      subtotal_minor: quote.subtotal_minor, discount_minor: quote.discount_minor, vat_minor: quote.vat_minor,
      total_minor: quote.total_minor, tendered_minor: cash, status: 'queued', error: '',
    };
    // Encrypt to persistent storage before clearing the cart or acknowledging the queued order.
    state.vault.orders.push(order);
    try { await seal(); } catch (error) { state.vault.orders.pop(); throw error; }
    state.cart = []; $('tendered').value = ''; setDefaultDiscount();
    render();
    message(`Provisional order ${order.key.slice(0, 8)} saved locally. It is not a completed sale.`);
  } catch (error) { message(error.message, 'error'); }
  finally { state.saving = false; render(); }
}
async function sync() {
  if (!state.vault || state.syncing) return;
  state.syncing = true; render();
  try {
    const session = await api('auth/session/');
    validateActor(state.vault.snapshot, session);
    for (const order of state.vault.orders.filter((o) => o.status === 'queued')) {
      const payload = {
        lines: buildQuoteLines(order), tendered_minor: order.tendered_minor,
        discount_type: order.discount_type, discount_value: order.discount_value,
        expected_tax_version: order.expected_tax_version, expected_total_minor: order.total_minor,
        payment_method: 'cash',
      };
      try {
        const receipt = await api('sales/checkout/', { method: 'POST',
          headers: { 'Idempotency-Key': order.key }, body: payload }, state.vault.snapshot.branchId);
        order.status = 'synced'; order.receipt_number = receipt.receipt_number;
        order.error = '';
        await seal();
      } catch (error) {
        if (error.status >= 400 && error.status < 500 && ![401, 403].includes(error.status)) {
          order.status = 'needs_review';
          order.error = error.message;
          await seal();
          continue;
        }
        // Uncertain network outcome: preserve exact idempotency key and payload for retry.
        order.error = `Connection interrupted: ${error.message}`;
        await seal();
        throw error;
      }
      render();
    }
    message('Sync finished. Only records marked Synced have been accepted by the server.');
  } catch (error) { message(`Sync stopped: ${error.message}`, 'error'); }
  finally { state.syncing = false; render(); }
}
async function refreshSnapshot() {
  try {
    if (state.vault.orders.some((o) => o.status !== 'synced')) throw new Error('Resolve all pending/review orders before refreshing the snapshot.');
    const session = await api('auth/session/');
    validateActor(state.vault.snapshot, session);
    const snapshot = await fetchSnapshot(session, state.vault.snapshot.branchId);
    state.vault.snapshot = snapshot;
    state.cart = []; setDefaultDiscount();
    await seal(); render(); message('Fresh stock and VAT snapshot downloaded and encrypted.');
  } catch (error) { message(error.message, 'error'); }
}

$('prepare').addEventListener('click', prepare);
$('unlockButton').addEventListener('click', unlock);
$('lockButton').addEventListener('click', lock);
$('search').addEventListener('input', () => { if (state.vault) renderCatalog(); });
$('discountType').addEventListener('change', () => { if (state.vault) renderCart(); });
$('discount').addEventListener('input', () => { if (state.vault) renderCart(); });
$('tendered').addEventListener('input', () => { if (state.vault) renderCart(); });
$('queueButton').addEventListener('click', queueOrder);
$('clearCart').addEventListener('click', () => { state.cart = []; render(); });
$('syncButton').addEventListener('click', sync);
$('refreshStock').addEventListener('click', refreshSnapshot);
window.addEventListener('online', () => { connectionStatus(); if (state.vault) void sync(); });
window.addEventListener('offline', connectionStatus);
connectionStatus();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/offline-sw.js', { scope: '/' })
    .catch(() => message('Offline page caching unavailable in this browser. Use HTTPS or localhost.', 'error'));
}
readBlob().then((record) => {
  state.hasStoredVault = !!record;
  if (record) { $('setup').classList.add('hidden'); $('unlock').classList.remove('hidden');
    $('snapshotLabel').textContent = 'Encrypted register available · unlock to access'; }
  else { $('setup').classList.remove('hidden'); $('unlock').classList.add('hidden'); void loadBranches(); }
}).catch((error) => message(error.message, 'error'));
