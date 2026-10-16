# Threat model: online first release

Trust boundaries: browser → same-origin web proxy → Django → PostgreSQL.
Users, request identifiers, amounts, approval flags, and branch headers are
untrusted. Restricted dispensing remains blocked. Mobile-payment confirmation is an explicit
staff attestation, never a claim of provider verification.

| Threat | Implemented boundary / verification |
| --- | --- |
| Cross-tenant object access | Session tenant, active memberships, scoped selectors, composite foreign keys; forged-ID tests |
| Branch privilege escalation | Branch membership checked server-side for every operational request; permission tests |
| CSRF/session theft | CSRF on login, registration and authenticated writes; HttpOnly session, SameSite=Lax, secure cookies outside debug; CSRF tests |
| Password guessing | Argon2, Django password validators, login and signup throttles; generic login error |
| Price/quantity tampering | Strict serializers, integer paisa, server catalog price, positive bounded quantity; adversarial tests |
| Duplicate receiving/sales | Transactional operation keys and input hashes; unique supplier reference; replay tests |
| Concurrent last-unit sales | PostgreSQL row locks and nonnegative balance constraints; concurrent tests |
| Expired or restricted dispensing | Server FEFO eligibility and explicit prescription-only block; policy tests |
| Ledger tampering | No update/delete API; PostgreSQL append-only triggers; database invariant tests |
| Stored XSS/CSV formulas | React escaped text; exported cells neutralize spreadsheet formula prefixes |
| Network loss during checkout | Retain idempotency key through uncertain responses; retry same request; no offline finalization |

| Privileged account compromise | Password-confirmed encrypted TOTP enrollment, per-device replay prevention and lockout, single-use recovery codes, session verification gate |
| Unauthorized staff onboarding | Owner-created hashed, expiring invitation tokens, recipient password checks, role/branch restriction and revocation |
| Misleading printed staff names | Printed display names are configurable snapshots; actual cashier/audit actor remains the authenticated user |
| Logo content injection | Raster-only upload, bounded decoded size, server re-encoding; React escapes text |
| Mobile payment double recording | Required reference and explicit staff verification, tenant/provider reference uniqueness; no provider trust inferred |

Residual risks and launch blockers: authenticator replacement and lost-account
recovery are not implemented; invitations need manual link sharing;
RLS defense in depth and restricted deployment roles require deployment work;
database administrators can alter evidence; throttling requires shared Redis for
multi-process deployment; device controls, refunds, tax, cash shifts, third-party
payments, clinical validation, backup restoration, penetration testing, and
hardware compatibility remain outside this release. Development seed fixtures
must never run against production. Production startup is blocked by default
until an operator explicitly acknowledges the incomplete release gates.

Production operators must add TLS, network isolation, managed secrets, encrypted
backups, centralized audit collection, dependency scans, monitoring, and tested
incident response. Current DGDA/NBR requirements must be verified by qualified
local professionals; this document does not make legal conclusions.
