# VAT and customer discounts (development feature)

This module calculates checkout VAT and discounts server-side and stores the result in a completed sale's immutable `tax_snapshot`. Rates are editable only by organization owners, under **Settings → Tax & VAT**. Per-medicine rules can use the workspace default, a zero-rated exemption, or a custom VAT rate/price mode. A configured rate is not a declaration that a particular Bangladeshi medicine is legally taxable; the pharmacy owner must verify treatment with its tax adviser and applicable NBR materials.

The global default **starts disabled** and at 0%. Shelf prices can be **exclusive**, meaning VAT is added, or **inclusive**, meaning VAT is extracted from the discounted amount and the payable amount is not increased. A customer discount is applied before VAT: either a fixed value in BDT or a percentage (0–100%). A fixed discount cannot exceed the sale subtotal. Discounts are allocated to lines proportionally using integer paisa with largest-remainder allocation; VAT is rounded per line, half-up. This avoids floating-point money calculations on the backend.

The `POST /api/v1/sales/quote/` endpoint computes payable totals from current catalog prices. The UI must receive a quote before opening payment. `POST /api/v1/sales/checkout/` **recomputes** all prices and verifies `expected_total_minor` and `expected_tax_version` under the existing idempotent transaction. A stale quote is rejected. Never trust client-provided tax or discount totals.

The completed `Sale` records `subtotal_minor`, `discount_minor`, `vat_minor` and a line-by-line `tax_snapshot`; payments and the saved receipt use the final payable `total_minor`. Older sales with an empty tax snapshot retain their original receipts. Posted receipt values do not change when settings change.

This change also updates the PostgreSQL deferred reconciliation trigger. Existing sale lines still reconcile to their original undiscounted subtotal, while the tax snapshot reconciles to the discounted, taxed payment. **Back up the PostgreSQL data first**, apply migrations in a staging/test database, and run backend tests before production deployment.

This is **not** a certified Mushak 6.3 tax invoice workflow. It does not implement returns, refunds, tax-filing submissions, all legally required VAT invoice fields, approval thresholds for cashier discounts, or accounting-ledger tax postings. Validate these requirements before production use.

## Local installation

From the project root, after making a PostgreSQL backup:

```bash
python3 scripts/api.py migrate
pnpm --filter @pharmacore/web typecheck
python3 scripts/api.py test
python3 scripts/dev.py stop
python3 scripts/dev.py start
```

For tests using `pytest`, the repository's established test command can be used with its existing PostgreSQL test environment; do not migrate a live production database without first verifying migration, backup, and restore procedures.
