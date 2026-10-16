# Verification record

Checked locally on 16 October 2026 with fictional development records. These
results cover the implemented online pilot, not the complete commercial
blueprint or an independent security assessment.

## Receipt, units, payment recording, and identity update

- 79 PostgreSQL tests passed. Added coverage includes saved customer creation,
  phone normalization, search/pagination, branch/role isolation, customer-save
  retries, immutable customer snapshots, BOX conversion, immutable
  unit/branding/staff-name snapshots, legacy interrupted-checkout replay,
  mobile-payment confirmation and duplicate references, logo validation,
  owner-only print settings, receipt access restrictions, MFA and invitations.
- Five Playwright journeys passed: responsive dashboard/branch menu,
  registration with authenticator enrollment, customer create/retry/select,
  cash keypad/change calculation and checkout/export,
  interrupted-checkout recovery, BOX/bKash/print customization and reprinting,
  and an 80-line multi-page invoice.
- TypeScript, Ruff lint/format, Django system checks, migration drift checks,
  OpenAPI validation, and the production Next.js build passed.
- Rendered and inspected 58 mm and 80 mm PDFs and a single-page A4 invoice.
  The 80-line invoice printed seven A4 pages with all lines/totals present and
  repeated item headings. Inspected all seven rendered pages.
- Adjusted the long thermal shop heading to fit narrow paper. POS change is
  displayed in a large, highlighted panel with a separate amber amount-due state.
- Rebuilt checkout as a two-column payment dialog with 14 px labels, 22 px
  keypad digits and 32 px change. Verified the stacked 390 px mobile dialog has
  no horizontal overflow. Application helper text is at least 12 px; print
  typography remains independently configurable.
- All dropdowns use the shared styled selector, including branch, selling unit,
  inventory filters, medicine receiving, staff roles, chart and printing options.
- These are browser/PDF checks. Physical thermal printers, scanners, live
  bKash/Nagad gateways, and statutory tax invoices have not been verified.

## Earlier infrastructure checks (15 October 2026)

The following baseline results predate the receipt/identity update; container
images and restored backup results below were not rerun for this update.

| Check | Result |
| --- | --- |
| PostgreSQL backend suite | 39 tests passed, including competing checkouts, tenant/branch isolation, immutable evidence, and reconciliation constraints |
| Playwright browser suite | 3 journeys passed: dashboard/navigation, registration through receiving and checkout, and interrupted checkout recovery |
| Receiving recovery | Server committed, response was dropped, browser reloaded, and retry returned the original receipt without double receiving |
| Mobile layout | Loaded dashboard verified at 390 × 844; no page-level horizontal overflow |
| Static checks | TypeScript, Ruff lint/format, Django checks, and migration drift checks passed |
| API contract | OpenAPI generation and validation passed with warnings treated as failures |
| Production frontend build | Next.js standalone build passed |
| Container builds | Python API and Node frontend images built successfully with Podman |
| Container runtime | Frontend, proxied database health, CSRF-protected demo login, and authorized dashboard passed using an isolated restored database |
| Backup restoration | Custom-format PostgreSQL dump restored into a separate database: 3 tenants, 123 sales, zero stock-ledger, payment-total, or sale-line-total mismatches |

The restored databases and temporary runtime containers were removed after
verification. The development database and its volume were preserved. Private
dumps, runtime secrets, screenshots, and local result files remain under ignored
`.local/`; none belong in a published repository.

The GitHub Actions workflow is provided but has not run on a remote repository.
No load benchmark, hardware certification, encrypted off-site restore,
production deployment, independent MFA assessment, offline synchronization, external
penetration test, or regulatory review has been completed. The release limits
and remaining work are listed in the README and threat model.
