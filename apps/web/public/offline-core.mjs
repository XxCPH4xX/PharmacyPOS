// Money is always integer paisa. The server is authoritative on reconnection.
export const roundDiv = (numerator, denominator) => {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0 || numerator < 0) {
    throw new Error('Invalid monetary calculation');
  }
  return Number((BigInt(numerator) * 2n + BigInt(denominator)) / (2n * BigInt(denominator)));
};

export function decimalToMinor(raw) {
  const text = String(raw).trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) throw new Error('Enter a valid amount (up to two decimal places).');
  const [whole, fraction = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount)) throw new Error('Amount out of range.');
  return amount;
}

export const money = (paisa) => `৳${(paisa / 100).toFixed(2)}`;

function mulDivRound(amount, factor, denominator) {
  return Number((BigInt(amount) * BigInt(factor) * 2n + BigInt(denominator)) / (2n * BigInt(denominator)));
}

export function calculateProvisional(lines, tax, discountType = 'none', discountValue = 0) {
  if (!['none', 'fixed', 'percent'].includes(discountType) || !Number.isSafeInteger(discountValue) || discountValue < 0) {
    throw new Error('Invalid discount.');
  }
  if (lines.length < 1 || lines.length > 100) throw new Error('An order must have 1–100 medicines.');
  const subtotal = lines.reduce((acc, line) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || !Number.isSafeInteger(line.price_minor) || line.price_minor < 0) {
      throw new Error('Invalid item quantity or price.');
    }
    return acc + line.quantity * line.price_minor;
  }, 0);
  if (!Number.isSafeInteger(subtotal) || subtotal > 1_000_000_000_000) throw new Error('Order amount is too large.');
  if (discountType === 'percent' && discountValue > 10000) throw new Error('Discount cannot exceed 100%.');
  if (discountType === 'none' && discountValue !== 0) throw new Error('Invalid zero discount.');
  if (discountType === 'none' && (tax.default_product_discount_bps || 0) > 0) {
    discountType = 'percent';
    discountValue = tax.default_product_discount_bps;
  }
  const discount = discountType === 'percent' ? mulDivRound(subtotal, discountValue, 10000) :
    discountType === 'fixed' ? discountValue : 0;
  if (discount > subtotal) throw new Error('Discount exceeds subtotal.');
  const amounts = lines.map((line) => line.quantity * line.price_minor);
  const reductions = lines.map(() => 0);
  if (subtotal && discount) {
    const precise = amounts.map((value) => BigInt(discount) * BigInt(value));
    const floors = precise.map((value) => Number(value / BigInt(subtotal)));
    floors.forEach((value, index) => { reductions[index] = value; });
    const remaining = discount - floors.reduce((sum, n) => sum + n, 0);
    const order = precise.map((value, index) => ({ remainder: value % BigInt(subtotal), index }))
      .sort((a, b) => a.remainder === b.remainder ? a.index - b.index : (a.remainder > b.remainder ? -1 : 1));
    for (let i = 0; i < remaining; i++) reductions[order[i].index]++;
  }
  const rules = new Map((tax.rules || []).map((rule) => [rule.product_id, rule]));
  let vat = 0;
  let additionalVat = 0;
  const results = lines.map((line, index) => {
    const rule = rules.get(line.product_id) || {};
    const treatment = rule.treatment || 'default';
    const rate = !tax.enabled || treatment === 'exempt' ? 0 :
      treatment === 'taxable' ? rule.rate_bps : tax.default_rate_bps;
    const mode = rule.mode || tax.default_mode || 'exclusive';
    if (!Number.isInteger(rate) || rate < 0 || rate > 10000) throw new Error('Invalid cached VAT rate.');
    const taxable = amounts[index] - reductions[index];
    const amount = rate ? mulDivRound(taxable, rate, mode === 'inclusive' ? 10000 + rate : 10000) : 0;
    vat += amount;
    if (mode === 'exclusive') additionalVat += amount;
    return { product_id: line.product_id, rate_bps: rate, mode, discount_minor: reductions[index], vat_minor: amount };
  });
  return { subtotal_minor: subtotal, discount_minor: discount, vat_minor: vat,
    total_minor: subtotal - discount + additionalVat, lines: results };
}

export function validateActor(snapshot, session) {
  if (!session?.authenticated || session.mfa?.required || !session.user?.id ||
      String(session.user.id) !== String(snapshot.userId) ||
      session.tenant?.id !== snapshot.tenantId ||
      !session.branches?.some((branch) => branch.id === snapshot.branchId) ||
      !session.memberships?.some((m) => (!m.branch_id || m.branch_id === snapshot.branchId) &&
        ['owner', 'manager', 'cashier'].includes(m.role))) {
    throw new Error('Sign in as the original cashier with selling permission in the same branch before syncing.');
  }
}

export function buildQuoteLines(order) {
  return order.items.map((line) => ({
    product_id: line.product_id,
    quantity: line.quantity,
    expected_price_minor: line.base_price_minor,
    expected_unit_price_minor: line.price_minor,
    expected_base_units: line.base_units,
    ...(line.unit_id ? { unit_id: line.unit_id } : {}),
  }));
}
