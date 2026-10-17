"use client";

import { api, ApiError } from "@/lib/api";
import type { Product, Receipt, SaleQuote } from "@/lib/types";

// This is an automatic device-bound continuity queue, not an offline financial ledger.
// Its records are encrypted in IndexedDB, but an unlocked/compromised browser profile
// can use its own non-exportable key. A managed local server is needed for offline finality.
const DB_NAME = "pharmacore-pos-continuity-v1";
const EXPIRY_MS = 8 * 60 * 60 * 1000;
const STORES = ["data", "keys"] as const;

type Mode = "none" | "percent" | "fixed";
export type CashPayload = {
  lines: { product_id: string; quantity: number; expected_price_minor: number;
    expected_unit_price_minor?: number; expected_base_units?: number; unit_id?: string }[];
  tendered_minor: number; expected_total_minor?: number; expected_tax_version?: number;
  discount_type?: Mode; discount_value?: number; payment_method?: string;
  customer_id?: string | null; customer_name?: string; customer_phone?: string;
  customer_address?: string; customer_bin?: string; customer_type?: string;
  staff_name?: string; created_by?: string; remarks?: string;
};
export type TaxSnapshot = { enabled: boolean; default_rate_bps: number;
  default_mode: "inclusive" | "exclusive"; default_product_discount_bps?: number;
  version: number; rules: { product_id: string; treatment: "default" | "exempt" | "taxable";
    rate_bps?: number; mode?: "inclusive" | "exclusive" }[] };
export type CatalogSnapshot = { capturedAt: number; products: Product[]; tax: TaxSnapshot };
export type LocalCashSale = { id: string; identity: string; branch: string; createdAt: number;
  payload: CashPayload; status: "queued" | "needs_review" | "synced" | "superseded";
  error: string; errorCode?: string; receipt?: Receipt };

type SecureRecord = { id: string; iv: number[]; cipher: ArrayBuffer };

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Offline storage failed"));
  });
}
function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Offline storage transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("Offline storage transaction aborted"));
  });
}
let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      for (const store of STORES) if (!open.result.objectStoreNames.contains(store))
        open.result.createObjectStore(store, { keyPath: "id" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error || new Error("Unable to access device storage"));
  });
  const pending = opening.catch((error: unknown) => {
    dbPromise = null; // Allow a subsequent attempt after storage initialization fails.
    throw error;
  });
  dbPromise = pending;
  return pending;
}

let keyPromise: Promise<CryptoKey> | null = null;
async function deviceKey(): Promise<CryptoKey> {
  if (!keyPromise) keyPromise = (async () => {
    const database = await db();
    const existing = await request<{ id: string; key: CryptoKey } | undefined>(
      database.transaction("keys", "readonly").objectStore("keys").get("device"),
    );
    if (existing) return existing.key;
    const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const tx = database.transaction("keys", "readwrite");
    // add() rather than put() ensures two open tabs cannot overwrite each other's key.
    const added = request(tx.objectStore("keys").add({ id: "device", key: generated }));
    try { await Promise.all([added, completed(tx)]); return generated; }
    catch {
      const winner = await request<{ key: CryptoKey } | undefined>(
        database.transaction("keys", "readonly").objectStore("keys").get("device"),
      );
      if (!winner) throw new Error("Offline encryption key could not be created");
      return winner.key;
    }
  })().catch((error) => { keyPromise = null; throw error; });
  return keyPromise;
}
async function encrypt(id: string, value: unknown): Promise<SecureRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deviceKey(),
    new TextEncoder().encode(JSON.stringify(value)));
  return { id, iv: Array.from(iv), cipher };
}
async function decrypt<T>(record: SecureRecord): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(record.iv) },
    await deviceKey(), record.cipher);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
async function read<T>(id: string): Promise<T | null> {
  const database = await db();
  const record = await request<SecureRecord | undefined>(
    database.transaction("data", "readonly").objectStore("data").get(id),
  );
  return record ? decrypt<T>(record) : null;
}
async function write(id: string, value: unknown): Promise<void> {
  const record = await encrypt(id, value);
  const database = await db();
  const tx = database.transaction("data", "readwrite");
  tx.objectStore("data").put(record);
  await completed(tx);
}

export const deviceScope = (identity: string, branch: string) => `${identity}:${branch}`;
export async function saveCatalog(scope: string, products: Product[], tax: TaxSnapshot) {
  if (!products.length) throw new Error("Cannot cache an empty medicine catalog.");
  await write(`catalog:${scope}`, { capturedAt: Date.now(), products, tax } satisfies CatalogSnapshot);
}
export async function loadCatalog(scope: string): Promise<CatalogSnapshot | null> {
  const snapshot = await read<CatalogSnapshot>(`catalog:${scope}`);
  return snapshot && Date.now() - snapshot.capturedAt <= EXPIRY_MS ? snapshot : null;
}
export async function saveCashSale(sale: LocalCashSale): Promise<void> {
  if (sale.payload.payment_method !== "cash") throw new Error("Only cash can be queued offline.");
  // Idempotency key is never regenerated for a failed transaction.
  await write(`sale:${sale.identity}:${sale.branch}:${sale.id}`, sale);
}
export async function listCashSales(identity: string, branch: string): Promise<LocalCashSale[]> {
  const database = await db();
  const rows = await request<SecureRecord[]>(
    database.transaction("data", "readonly").objectStore("data").getAll(),
  );
  const prefix = `sale:${identity}:${branch}:`;
  const matches = rows.filter((row) => row.id.startsWith(prefix));
  const decoded = await Promise.all(matches.map((row) => decrypt<LocalCashSale>(row)));
  return decoded.sort((a, b) => a.createdAt - b.createdAt);
}
// Only definitive server rejections can be revised as a new sale. Never
// supersede a checkout with an unknown outcome or an idempotency conflict.
const CORRECTABLE_CODES = new Set([
  "price_changed", "unit_changed", "unit_not_found", "insufficient_stock",
]);
export function isCorrectableRejection(sale: LocalCashSale): boolean {
  return sale.status === "needs_review" && CORRECTABLE_CODES.has(sale.errorCode || "");
}
export async function supersedeRejectedCashSale(identity: string, branch: string, id: string): Promise<void> {
  const key = `sale:${identity}:${branch}:${id}`;
  const sale = await read<LocalCashSale>(key);
  if (!sale || sale.identity !== identity || sale.branch !== branch || sale.id !== id ||
      !isCorrectableRejection(sale))
    throw new Error("Only an explicitly rejected checkout can be replaced after review.");
  // Preserve the rejected record for reconciliation history, but release its
  // provisional stock reservation before creating a new checkout key.
  await write(key, { ...sale, status: "superseded" });
}
export function reservedBaseUnits(sales: LocalCashSale[]): Record<string, number> {
  const reserved: Record<string, number> = {};
  for (const sale of sales) if (sale.status === "queued" || sale.status === "needs_review") {
    for (const line of sale.payload.lines) reserved[line.product_id] =
      (reserved[line.product_id] || 0) + line.quantity * (line.expected_base_units || 1);
  }
  return reserved;
}

export function calculateOfflineQuote(lines: CashPayload["lines"], tax: TaxSnapshot,
  kind: Mode, value: number): SaleQuote {
  if (!lines.length || lines.length > 100 || !["none", "percent", "fixed"].includes(kind) ||
      !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid cached checkout details.");
  if (new Set(lines.map((line) => line.product_id)).size !== lines.length)
    throw new Error("Duplicate medicines must be combined before checkout.");
  const amounts = lines.map((line) => {
    if (line.unit_id || (line.expected_base_units || 1) !== 1 ||
        !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 10000 ||
        !Number.isSafeInteger(line.expected_price_minor) || line.expected_price_minor < 0)
      throw new Error("Packaged units need online checkout.");
    return line.quantity * line.expected_price_minor;
  });
  const subtotal = amounts.reduce((sum, amount) => sum + amount, 0);
  if (!Number.isSafeInteger(subtotal) || subtotal > 1_000_000_000_000)
    throw new Error("Sale amount exceeds offline limits.");
  // Offline authorizations cannot safely grant a new discount. Only the
  // last owner-configured default is eligible without contacting the server.
  if (kind !== "none" && (kind !== "percent" || value !== (tax.default_product_discount_bps || 0)))
    throw new Error("Custom discounts require online manager confirmation.");
  if (kind === "none" && value === 0 && tax.default_product_discount_bps) {
    kind = "percent"; value = tax.default_product_discount_bps;
  }
  if (kind === "percent" && value > 10000) throw new Error("Percentage exceeds 100%.");
  const divide = (a: number, b: number, denom: number) =>
    Number((BigInt(a) * BigInt(b) * 2n + BigInt(denom)) / (2n * BigInt(denom)));
  const discount = kind === "percent" ? divide(subtotal, value, 10000) : 0;
  if (discount > subtotal) throw new Error("Discount exceeds the subtotal.");
  const reductions = amounts.map((amount) => subtotal ? Number(BigInt(discount) * BigInt(amount) / BigInt(subtotal)) : 0);
  let left = discount - reductions.reduce((a, b) => a + b, 0);
  const positions = amounts.map((amount, i) => ({ i, rest: (BigInt(discount) * BigInt(amount)) % BigInt(subtotal || 1) }))
    .sort((a, b) => a.rest === b.rest ? a.i - b.i : a.rest > b.rest ? -1 : 1);
  for (let i = 0; i < left; i++) reductions[positions[i].i]++;
  let vat = 0, addedVat = 0;
  const quotes = lines.map((line, i) => {
    const rule = tax.rules.find((r) => r.product_id === line.product_id);
    const treatment = rule?.treatment || "default";
    const rate = !tax.enabled || treatment === "exempt" ? 0 :
      treatment === "taxable" ? rule?.rate_bps : tax.default_rate_bps;
    const mode = rule?.mode || tax.default_mode;
    if (!Number.isInteger(rate) || (rate ?? -1) < 0 || (rate ?? 10001) > 10000)
      throw new Error("Cached VAT rule is invalid.");
    const taxable = amounts[i] - reductions[i];
    const lineVat = rate ? divide(taxable, rate, mode === "inclusive" ? 10000 + rate : 10000) : 0;
    vat += lineVat;
    if (mode === "exclusive") addedVat += lineVat;
    return { product_id: line.product_id, subtotal_minor: amounts[i], discount_minor: reductions[i],
      vat_minor: lineVat, rate_bps: rate || 0, mode, treatment,
      total_minor: taxable + (mode === "exclusive" ? lineVat : 0) };
  });
  return { settings_version: tax.version, subtotal_minor: subtotal, discount_minor: discount,
    vat_minor: vat, total_minor: subtotal - discount + addedVat,
    discount_type: kind, discount_value: value, lines: quotes };
}

type ServerSession = {
  authenticated: boolean;
  user?: { id: string };
  tenant?: { id: string };
  mfa?: { required: boolean };
  branches?: { id: string }[];
  memberships?: { branch_id?: string | null; role: string }[];
};

export function validateSyncActor(identity: string, branch: string, session: ServerSession): void {
  const [tenant, user] = identity.split(":");
  if (!tenant || !user || !session.authenticated || session.mfa?.required ||
      String(session.user?.id) !== user || String(session.tenant?.id) !== tenant ||
      !session.branches?.some((item) => item.id === branch) ||
      !session.memberships?.some((membership) =>
        (!membership.branch_id || membership.branch_id === branch) &&
        ["owner", "manager", "cashier"].includes(membership.role))) {
    throw new Error("Sign in as the original cashier in the same branch before synchronization.");
  }
}

let flushing = false;
export async function synchronizeCashSales(identity: string, branch: string): Promise<{
  synced: number; review: number; pending: number;
}> {
  if (flushing) return { synced: 0, review: 0, pending: 0 };
  flushing = true;
  let synced = 0, review = 0, pending = 0;
  try {
    const queued = (await listCashSales(identity, branch)).filter((s) => s.status === "queued");
    if (!queued.length) return { synced, review, pending };
    const session = await api<ServerSession>("auth/session/");
    validateSyncActor(identity, branch, session);
    for (const sale of queued) {
      try {
        const receipt = await api<Receipt>("sales/checkout/", {
          method: "POST", headers: { "Idempotency-Key": sale.id },
          body: JSON.stringify(sale.payload),
        }, sale.branch);
        await saveCashSale({ ...sale, status: "synced", receipt, error: "" });
        synced++;
      } catch (e) {
        const error = e as ApiError;
        // Keep an uncertain outcome queued with the original idempotency key.
        // Permission failure can be a timed-out session; do not turn it into a sale.
        if (error.status >= 400 && error.status < 500 && ![401, 403, 429].includes(error.status)) {
          await saveCashSale({ ...sale, status: "needs_review", error: error.message, errorCode: error.code });
          review++;
          continue;
        }
        pending++;
        break; // Preserve ordering when the server is unreachable.
      }
    }
    return { synced, review, pending };
  } finally { flushing = false; }
}
