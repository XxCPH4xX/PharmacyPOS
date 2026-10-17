# Offline register (provisional orders)

This feature is a deliberately conservative **offline register**, not an offline-finalized sale engine. Sale, payment, stock ledger, and official receipt are created *only* after the existing Django checkout accepts a queued order. Do not use unsynced slips as completed-sale receipts or statutory VAT documents.

## First-time setup (online)

1. Start PostgreSQL, Django, and Next.js (or open the production site over HTTPS). Sign in as an owner/manager/cashier and complete MFA.
2. Open **Point of sale → Prepare / open offline register**, or bookmark `/offline-register.html`. Stay online until its service worker is installed and the register has prepared.
3. Select the correct branch, enter a unique 12+ character passphrase, and prepare the device. The passphrase is not uploaded or stored, and is required to decrypt local orders. Losing it means the offline data cannot be recovered.
4. Test the device in a disposable workspace: turn off networking, reopen `/offline-register.html`, unlock, make a *provisional* order, reconnect, and verify the completed transaction in **Sales & receipts**.

## While disconnected

- The dedicated offline page works after its first online visit. It does not depend on Next.js rendering or the Django API while disconnected. It retains a read-only snapshot of **eligible, non-prescription medicines and their base-unit prices**, encrypted in IndexedDB with AES-256-GCM; PBKDF2-SHA256 derives a key from the cashier's passphrase with a random salt.
- Snapshot expires after eight hours. If it expires during an outage, previously queued orders remain, but new orders are blocked.
- Offline base-unit quantities are capped against the last downloaded availability minus all provisional orders on *this device*. Other devices and online cashiers may have consumed the same stock, and products can expire meanwhile. This does not reserve stock on the server.
- Locally calculated VAT/discounts are estimates based on the cached workspace rules. Prices/rates may change before reconnect. Only cash provisional orders are supported (no offline bKash/Nagad validation).
- Customers and personal information are not saved in the offline register. Only product identifiers/prices, amounts, tax config, and transaction identifiers are cached.
- An optional printed provisional slip prominently states that it is **not a finalized sale or tax invoice**.

## Reconnect and reconcile

- Unlock with the offline passphrase, sign into the main PharmaCore app as the **original cashier**, with the same tenant and branch, and reconnect. Sync runs automatically on reconnect/unlock when possible; the **Sync pending orders** button also retries.
- The sync uses the server's existing checkout endpoint, with the original `Idempotency-Key` and full captured price/tax/discount expectations. The server handles FEFO allocation, expiry, stock, tenancy, permissions, duplicate requests, and final tax calculation.
- If a network failure leaves the outcome uncertain, **do not reenter the sale manually**. Retry the same queued operation. The idempotency key lets the backend return the already-recorded result.
- A server rejection (changed price/VAT, insufficient stock, authentication failure, expired batch, etc.) is marked **Requires review**. It is not silently discarded or retried with changed prices. Resolve in the online sales ledger and with the customer before using **Mark manually reconciled**. That button does *not* post a sale.
- Refresh the snapshot after all unresolved orders are handled. Completed sales appear only in the regular server-backed Sales & receipts area.

## Operational limitations and security review

- **Not a certified or production-ready offline pharmacy checkout**. Needs independent testing and statutory review before retail deployment.
- Web Crypto + IndexedDB encrypts at rest against casual disclosure but cannot protect a compromised device, unlocked browser session, weak passphrase, or malicious browser extensions. Consider native device management and encrypted local databases for commercial deployments.
- Browser profile reset, private-browsing cleanup, storage eviction, lost passphrase, or device failure can destroy unsynced records. The current feature cannot remotely recover them. Use one offline-register tab per device; concurrent tabs are not supported.
- This version is single-device provisional, not a multi-device distributed reservation system. It does not guarantee stock availability or support batch/packaged-unit selection offline, returns/refunds, patient verification, or offline-finished legal invoices.
- Browser service worker deliberately caches **only** the standalone offline HTML/JS and never caches API responses, user sessions, authenticated pages, or personal information.
- Do not use the development server or service-worker cache as a production deployment strategy. Validate the feature on HTTPS with real TLS, managed devices, and a production Next.js build.

## Verification

Run calculation and actor validation tests:

```bash
node --test apps/web/tests/offline-core.test.mjs
pnpm --filter @pharmacore/web typecheck
```

Use a disposable database for end-to-end reconciliation, including stale stock, tax version changes, duplicate sync, offline browser reload, and network failure *after* the server commits. Never run synthetic stock/sale tests against real pharmacy data.
