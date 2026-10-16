# PharmaCore ERP

An online pharmacy workspace for Bangladesh, built with Next.js, TypeScript,
Tailwind, Radix UI, Django REST Framework, and PostgreSQL. The interface follows
the supplied teal pharmacy reference with an original layout and branding.

This is a tested online pilot of the supplied commercial blueprint.

The POS now includes saved customer selection (new, existing, or walk-in),
server-paginated customer search, and a larger payment dialog with cash keypad,
exact-cash shortcuts and a prominent change/amount-due display. Application
dropdowns share the branch selector's styling and keyboard behavior.
It is **not a production-ready or legally validated pharmacy platform**.

## Working functionality

- Organization registration, first-branch provisioning, secure password hashing,
  session login/logout, CSRF protection, throttling, and server-side role checks.
- Tenant-private medicine identities with separate commercial records, SKU and
  barcode search, prescription restrictions, prices in integer paisa.
- Batch receiving, expiry and location tracking, FEFO checkout, BOX / STRIP / PACK
  conversion, stock ledger, activity history, and branch-specific reports.
- Cash and staff-confirmed bKash / Nagad payment recording with transaction
  references and duplicate-reference protection. No gateway charging or verification.
- Customizable 58/80 mm retail receipts and A4 customer invoices, shop logos,
  editable printed staff names, optional merchant QR, receipt barcode, and print/PDF.
  Posted sales preserve their branding, unit conversion, customer and printed names.
- Encrypted TOTP MFA for privileged accounts, replay prevention, single-use
  recovery codes, expiring invitations, and staff access revocation.
- PostgreSQL row locking, idempotency records, composite tenant foreign keys,
  append-only evidence triggers, deferred stock and sale reconciliation checks.
- Responsive dashboard, inventory and POS; light/dark themes; keyboard barcode
  entry (F2); global search (Ctrl/Cmd+K); CSV sales exports.
- Lost-response recovery for checkout and receiving. Pending requests retain
  their operation key in browser session storage; retry confirms the same sale.

Prescription-only medicines cannot be sold. Taxes are not calculated. Mobile
payments must already be received and checked in the merchant account. There
is no live payment gateway or offline finalization. See the
[receipt and invoice guide](docs/operations/receipts-and-invoices.md).

## Local development

Prerequisites: Node.js 24, pnpm 11.25, Python 3.12, PostgreSQL 17, and Docker or
Podman. PostgreSQL is required; SQLite cannot verify the concurrency invariants.

```bash
pnpm install --frozen-lockfile
python3 -m venv .venv
.venv/bin/pip install -r services/api/requirements.lock
```

The local runner reads `.local/postgres.env` and generates a private development
session secret in `.local/django-secret`. Create a development database:

```bash
mkdir -p .local
python3 -c 'import secrets,pathlib; p=pathlib.Path(".local/postgres.env"); p.write_text("POSTGRES_USER=pharmacore\nPOSTGRES_DB=pharmacore\nPOSTGRES_PASSWORD="+secrets.token_urlsafe(32)+"\n"); p.chmod(0o600)'
podman run -d --name pharmacore-db \
  --env-file .local/postgres.env \
  -p 127.0.0.1:54329:5432 \
  -v pharmacore-pgdata:/var/lib/postgresql/data \
  docker.io/library/postgres:17-alpine
python3 scripts/api.py migrate
python3 scripts/api.py seed_demo
python3 scripts/api.py runserver 127.0.0.1:8000
```

In a second terminal:

```bash
pnpm dev
```

Alternatively, `python3 scripts/dev.py start` starts both services in the
background and starts the existing `pharmacore-db` Podman container if present.
Use `python3 scripts/dev.py status` or `stop` to inspect or stop the web/API
processes. Logs are under `.local/`; stopping these processes preserves data.

Open [localhost:3000](http://localhost:3000). Choose **Explore demo workspace**
for fictional sample records, or **Create workspace** for an empty organization.
The demo has an unusable password and a development-only entry point. No shared
production credentials are embedded in source. Re-running `seed_demo` preserves
the existing sample workspace. Do not recreate `.local/postgres.env` while an
existing database uses its password.

Already-running local database: `podman start pharmacore-db`. To stop it without
deleting data, use `podman stop pharmacore-db`.

## Docker Compose development

Copy `.env.example` to `.env` and replace the two placeholder secrets with random
values. Then:

```bash
docker compose up --build -d
docker compose run --rm api python manage.py seed_demo
```

The Compose setup exposes only the web app on localhost:3000. PostgreSQL and Redis
remain on the internal container network. This is a development configuration;
it intentionally enables the local demo and does not configure public TLS.

## Verification

```bash
python3 scripts/api.py test
.venv/bin/ruff check services/api scripts
.venv/bin/ruff format --check services/api scripts
python3 scripts/api.py makemigrations --check --dry-run
python3 scripts/api.py spectacular --file ../../docs/api/openapi.yaml --validate --fail-on-warn
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Browser tests require the API and web app running, with the development demo
seeded. Tests create isolated fictional organizations and one sample sale. They
cover registration → catalog → receiving → scanner checkout → receipt → ledger
→ export, mobile navigation, theme changes, and a server-committed sale whose
response is deliberately lost before a reload and safe retry.

The backend suite uses PostgreSQL, including threaded competing checkouts.
Do not point tests or development fixtures at a live pharmacy database.
See [local verification results](docs/operations/verification.md) for the checks
actually performed and the limits of those results.

## Repository map

- `apps/web`: web management, online POS, receipt designer, and invoice printing.
- `services/api/core`: identity, tenant and branch scope, audit, idempotency,
  dashboard read models, and operational database constraints.
- `services/api/catalog`, `inventory`, `sales`: models and application services.
- `docs/api/openapi.yaml`: generated versioned REST contract.
- `docs/architecture/first-release.md`: data model, dependency graph, gates.
- `docs/security/threat-model.md`: threat boundaries and remaining release risks.
- `docs/operations`: local operation, recovery, and deployment considerations.
- `infrastructure/docker`, `compose.yaml`, `.github/workflows/ci.yml`: development
  packaging and automated verification.

## Configuration

`DJANGO_SECRET_KEY`, `POSTGRES_PASSWORD` are required secrets. PostgreSQL also
accepts `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_DB`.
`DJANGO_DEBUG=1` enables development behavior. `DJANGO_ALLOWED_HOSTS` and
`CSRF_TRUSTED_ORIGINS` are comma-separated explicit allowlists. `REDIS_URL` enables
shared throttling; local single-process development uses Django's memory cache.
`API_ORIGIN` is the Django origin used by the Next.js proxy at build time.
Sessions expire after eight hours and use HttpOnly, SameSite cookies.
`REQUIRE_PRIVILEGED_MFA` defaults to `1`. Outside debug, a separate Fernet
`MFA_ENCRYPTION_KEY` is required. Generate with
`.venv/bin/python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`
and store it in a secret manager. Back it up separately from the database;
losing or replacing it prevents existing authenticators from being decrypted.
Debug derives an MFA key from the local Django secret. Keep that secret stable.

`scripts/api.py` is a local helper that defaults to debug and port 54329; deployed
processes must use `manage.py`/Gunicorn directly and explicit environment values.

## Remaining product work

National catalog curation, prescription verification, suppliers and purchasing
approvals, refunds and cash sessions, taxation, full accounting, live payment
gateways, Tauri/encrypted offline POS, Bangla translations, subscription
administration, RLS deployment roles, background jobs, observability, and hardware
integrations remain outstanding. MFA enrollment and recovery-code verification
work; self-service authenticator replacement and account recovery are not yet
implemented. Invitations produce a private link; email delivery is not integrated.
Hardware, external catalog sourcing, and tax-rule setup were deferred by the user.
The current web client loads branch catalogs/history for local filtering; large
production datasets need server-driven table/search pagination and aggregated
reporting. CSV exports are synchronous and intended for pilot-size datasets.

Before live use: complete the release gates, independently assess security,
verify local requirements, test recovery and hardware, and obtain supervised
pharmacy user acceptance. No performance or compliance certification is claimed.

This workspace has not been published or connected to a remote repository.
Choose a private remote, branch protections, and an appropriate distribution
license before commercial development proceeds.
