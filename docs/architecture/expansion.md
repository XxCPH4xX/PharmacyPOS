# Operational expansion

Preserve posted sales and receiving records. New features use additive migrations,
tenant-scoped services, authorization, audit events, and idempotent posting.

Implementation order and acceptance criteria:

1. Identity: encrypted TOTP enrollment, replay prevention, recovery codes,
   privileged-session enforcement, expiring invitations, staff revocation.
2. Operations: supplier records, approved purchase orders and partial receiving;
   unit conversions; pharmacist-reviewed prescriptions with bounded dispensing.
3. Finance: cash sessions, original-sale refunds, balanced journal entries,
   expenses and reconciliation. Posted records remain append-only.
4. Scale: bounded server search/pagination, background exports, deployment
   database roles and isolation, operational metrics, localization.
5. Payment providers: bKash and Nagad. Provider confirmations must be verified
   server-side and reconcile to a single sale; browser redirects cannot mark paid.
6. Desktop: device authorization and encrypted, bounded offline allocations must
   be verified before offline cash checkout is available.

Each implemented module needs migrations, API contracts, UI, role checks,
cross-tenant tests, failure/replay tests, and documentation. Re-run existing
journeys after integration. Do not label scaffolded or unverified integrations
as complete.

User decision: bKash and Nagad are the intended mobile payment providers.
Hardware integration, external medicine catalog sourcing, and tax-rule setup
are deferred. Provider sandbox credentials and official merchant contracts are
still required for payment integration verification. Do not invent a catalog,
tax rate, licensing rule, or provider response contract.


Completed in the 16 October receipt/identity increment: TOTP enrollment and
verification, recovery-code consumption, link invitations and revocation,
BOX/STRIP/PACK conversion, staff-confirmed cash/bKash/Nagad records, receipt and
invoice customization/printing, editable printed names with immutable audit
identity, and the branch picker. The remaining steps above remain outstanding.
