# Integrated cash-sale continuity in the POS

This iteration adds a **provisional cash queue to the regular `/pos` screen**.
There is no separate register, passphrase, or manual preparation step: an active,
authenticated POS caches medicine prices and VAT rules when online. If the Django
API becomes unavailable while the POS remains open, supported base-unit cash sales
can be recorded locally and will retry automatically every 20 seconds and on the
browser `online` event. Pending sales remain visibly pending and never receive a
final receipt until Django confirms them. Network access alone is not proof that
the API is reachable; failures preserve each operation's idempotency key.

## Limits and safety

* **This is not a full offline SaaS implementation or a production financial ledger.**
  The same normal POS remains usable **while its browser tab stays open**. A full
  refresh or browser restart while the API is unavailable still needs a locally
  hosted server or another reviewed offline authentication strategy.
* Encrypted browser IndexedDB stores data with a non-exportable device-bound
  AES-GCM key. It is not a substitute for a managed, backed-up, encrypted local
  database. Clearing site data, losing the device, or browser storage eviction
  can permanently lose pending orders. Use one POS tab per device.
* Sync requires the original cashier, tenant, and branch, with MFA complete and
  selling permission. A different user cannot automatically post queued orders.
* The cache expires after eight hours. Cached stock is an estimate across a
  disconnected branch; other terminals can sell stock meanwhile. Orders that
  conflict with current price, stock, VAT, or permissions require manual review.
* Offline checkout supports only walk-in cash sales in base units, with the saved
  default product discount. No offline mobile payment verification, prescription
  dispensing, packaged units, or recorded customer accounts. Custom discounts
  require online manager confirmation.
* Never print an unsynced transaction as a completed receipt or VAT invoice.
  The cashier must explain pending status before accepting cash.
* The previous standalone offline register remains present in this patch but the
  POS no longer links to it. Queues from that version are **not migrated**. Resolve
  them separately before decommissioning it; never delete an unresolved vault.

## Smoke test (demo data only)

1. Start all services, sign in and load `/pos`, confirm the medicine catalog.
2. Stop Django API but keep Next.js and browser tab open. Make a base-unit cash
   checkout. Verify it displays as **Pending sync**, not a completed receipt.
3. Restart Django. Wait about 20 seconds and verify it appears once in Sales.
4. Test reconnection with network response lost after server commit; retries
   must return the same receipt and never add a second sale.
5. Test insufficient stock, changed tax version, session expiry, another cashier,
   two browser tabs, site-data eviction, and noncash checkout attempts.
6. Do not use real pharmacy data for these tests.

The required production architecture includes a managed local branch service,
transactional local database, controlled device identity, durable outbox/inbox
sync, signed checkpoints, conflict policies, independent security assessment,
backup restore drills, and Bangladesh pharmacy/tax compliance validation.
