# First release: connected pharmacy operations

## Repository audit and boundary

The workspace was empty. There are no existing features or data to migrate.
This release implements one connected, online workflow: register an organization
and branch, define medicines, receive batches, perform cash checkout, print a
receipt, inspect stock movements, and report sales. Prescription-only products
are blocked at checkout until a separately reviewed dispensing workflow exists.

Next.js/TypeScript renders the management and POS UI. Django REST Framework is
the only authority for authorization, money, stock, receipts, and reports.
PostgreSQL stores transactional state. The browser uses same-origin, CSRF-protected
sessions. Integer paisa amounts avoid floating-point financial arithmetic.

## Module dependencies

```text
Web → REST API → identity / tenancy / branches
                       ↓
                    catalog
                       ↓
                   inventory
                       ↓
                     sales → reporting

Every mutation → audit; receiving and checkout → idempotency records
```

Core owns tenant identity, branch membership, audit events, and operation keys.
Catalog separates product identity from tenant commercial settings. Inventory
owns batch balances and signed movements. Sales owns immutable sale snapshots
and cash payment records. Reporting reads these records without modifying them.
Cross-domain mutations go through application services, not signals or UI code.

## Data model and invariants

- Tenant → branches and memberships; a membership is organization-wide or scoped
  to one branch. Owners/managers operate inventory, cashiers sell, auditors read.
- Product → tenant product (SKU, barcode, price, reorder point). Product identity
  is tenant-private for now; shared national catalog curation is a later release.
- Tenant product + branch → batches (number, expiry, condition, cost, balance).
- Receipt → batch → signed stock movements. Sale → sale lines → batch allocations
  and stock movements. Cash payment and sale total must agree.
- All operational foreign keys have tenant-scoped database constraints.
- Available stock cannot be negative. Expired/quarantined/recalled stock cannot
  be sold. Expiry dates are interpreted in Asia/Dhaka; expiry-day stock is blocked.
- A branch row lock serializes stock-affecting operations in that branch. Batches
  are allocated FEFO with deterministic tie-breaking. This favors correctness
  over peak throughput for the first release.
- An idempotency key is scoped to tenant, branch, and operation. Reusing a key
  with different input fails. Success is recorded inside the same transaction.
- Receipt references are unique per branch, preventing repeat receiving under
  a different idempotency key.
- Posted sales, cash payments, movements, and audit events have no edit/delete
  APIs. PostgreSQL triggers reject updates/deletes to posted evidence records.

## Acceptance gates

1. Registration, login, logout, session expiry, CSRF and branch permissions work.
2. Tenant and branch isolation holds for reads and writes, including forged IDs.
3. Receiving creates a batch, ledger entry, and audit event atomically.
4. Checkout calculates prices on the server, allocates FEFO stock, records cash,
   and creates a printable receipt and audit trail in one transaction.
5. Insufficient/restricted/expired stock and insufficient tender fail completely.
6. Duplicate requests cannot double-post; concurrent cashiers cannot oversell.
7. Reports reconcile to posted sales and ledger balances.
8. Browser flows, type checking, production build, and PostgreSQL tests pass.

## Next release dependencies

Prescription verification precedes restricted dispensing. Cash sessions and
reversals precede finance rollout. Verified provider callbacks precede electronic
payments. Device authorization, encrypted storage, bounded stock allocations,
and recovery tests precede offline POS. MFA, RLS with a restricted database role,
deployment hardening, recovery drills and independent assessment precede pilot.

No legal compliance, tax treatment, performance target, or production readiness
is implied by this release. Tax is not calculated; cash receipts identify this
explicitly. No real patient records are needed for development.
