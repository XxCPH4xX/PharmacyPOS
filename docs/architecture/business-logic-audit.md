# Business workflow audit — 16 October 2026

Scope: source, API contracts, PostgreSQL constraints, UI flows and executable
tests in this repository. This is an engineering review, not a regulatory
certification or external penetration test.

## Findings and correction plan

| Priority | Module / verified problem | Root cause and impact | Correction / affected components | Required verification |
| --- | --- | --- | --- | --- |
| P1 | Package availability implies sealed stock | ProductUnit is a multiplier; checkout aggregates all base units. Loose tablets can be offered as a sealed BOX. | Central packaging definition, physical loose/inner/outer counts per batch, package movement ledger; catalog, receiving, sales, database constraints. Preserve existing stock as loose. | Opening strips/boxes, sealed-box rejection, FEFO, concurrent last-strip checkout, reconciliation. |
| P1 | Package prices always multiply base price | SaleLine revenue assumes an integer base-unit price. Independent pack discounts cannot reconcile. | Snapshot package prices and exact line totals; allocate integer paisa across batch allocations deterministically. | Discounted package price, remainder allocation, historical COGS/revenue, changed-price rejection. |
| P2 | Repeated manual unit activation | Units are separately enabled after product creation with no packaging hierarchy. | Define packaging once and derive eligible choices, including category-specific base units. | Product creation, receiving, POS unit switches, syrup without STRIP. |
| P2 | POS cart moves while browsing | Page owns scrolling; cart uses position: sticky and starts below its eventual sticky offset. | Viewport-constrained POS shell, independent catalog and cart-item scroll areas, fixed cart totals. | Cart bounding rectangle unchanged after catalog scrolling; many items; desktop/laptop/mobile. |
| P2 | Receipt footer clips / two scrollbars | Generic Modal uses overflow:auto; document-preview independently uses max-height:65vh and overflow:auto. | Receipt-specific flex dialog with one preview scroller and non-shrinking header/tabs/footer. | Long/short thermal and A4, 1920/1366/1280 widths, effective 125%/150% viewports, printing. |
| P2 | Workspace settings are read-only | Only branch creation exists; organization and branch edit APIs are missing. | Owner-authorized version-checked updates with audit events; preserve transaction snapshots. | Owner/non-owner, cross-tenant, stale edit, refresh persistence, receipt reprints. |
| P2 | Unsubmitted cart lost on navigation | Only pending submitted checkout is persisted. | Scope draft storage to authenticated user, tenant and branch; restore without repricing; keep idempotency records separate. | Navigation/reload, branch/user changes, pending checkout recovery. |
| P2 | Strength/form search incomplete | POS and global search omit strength/form; barcode Enter falls back to one partial result. | Include strength/form/SKU and require exact barcode/SKU or deliberately selected search result. | Duplicate scans, ambiguous search, distinct strengths. |
| P2 | Every page loads all operational history | Workspace eagerly downloads catalog, batches, sales, ledger and audit, even on POS. | Separate page data loading and server-driven search/pagination; retain existing server authorization. | Request scope, large lists, stale requests, permission variants. |
| P3 | Navigation space consumed by help card | Fixed sidebar footer contains a large promotional panel. | Remove card; keep compact Help action and use space for management navigation. | Desktop/laptop sidebar access and mobile navigation. |

## Controls already present and retained

- Tenant/branch server scoping, role union, privileged MFA and CSRF-protected sessions.
- PostgreSQL transaction locking, idempotent receiving/checkout and immutable sale,
  payment, stock ledger and audit records with reconciliation constraints.
- Expired/quarantined/recalled stock excluded from dispensing; FEFO batch traceability.
- Prescription-required products blocked in both UI and server until a verified
  dispensing workflow exists. No clinical rule is inferred from medicine names.
- Historical sales retain actual allocated purchase costs, receipt branding,
  selling units, customer details and printed staff names.
- Cash sufficiency is server-validated. bKash/Nagad are explicitly staff-confirmed
  records with duplicate-reference protection, not live gateway integrations.

## Absent workflows and policy dependencies

Purchase orders, partial PO delivery reconciliation, supplier balances, transfers,
returns/refunds, discounts, split/card/credit payments, cash sessions, statutory
tax calculation, prescription verification, subscription entitlements, encrypted
offline POS and background export jobs were not implemented in the inspected
baseline. Their absence is distinct from a defect in an implemented workflow.
The audit does not treat disabled prescription dispensing or unconfigured VAT as
permission to invent clinical/tax rules.

Returns require eligibility, condition review, original-sale allocation and
quarantine before any release to sellable stock. Tax treatment and provider
settlement require approved configuration/credentials. Physical package changes
must never infer sealed packages from loose stock or silently rewrite prior sales.

Implementation and executed verification results are recorded with the final
changes below; unresolved modules must remain explicitly identified.
