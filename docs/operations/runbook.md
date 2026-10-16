# Operating the first release

## Health and diagnosis

`GET /api/v1/health/` checks database connectivity. Business responses include
`X-Request-ID`, and structured validation errors include the same correlation ID.
No endpoint caches tenant data publicly. Inspect Django and Next logs locally;
do not forward raw medical or financial records to public bug reports.

If receiving or checkout loses its response, reopen the same branch and retry
the pending request. Browser session storage holds the request and operation
key; the server returns the original result if it already committed. Do not
create another sale to guess whether the first succeeded. Verify Sales &
receipts if the browser session itself has been lost. Offline sales are blocked.

If balances cannot reconcile, the database rejects the whole transaction. Do
not disable triggers or edit balances manually. Investigate the source document
and ledger. Posted evidence cannot be edited via the application.

## Backups and recovery

Use managed, encrypted PostgreSQL backups with point-in-time recovery for any
future deployment. The following commands are for development rehearsal only.
Keep dumps outside version control and encrypt them before off-host storage.

```bash
umask 077
mkdir -p .local/backups
podman exec pharmacore-db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > .local/backups/pharmacore.dump
```

Restore only into a new isolated database, never over the current database:

```bash
podman exec pharmacore-db createdb -U pharmacore pharmacore_restore
podman exec -i pharmacore-db pg_restore -U pharmacore -d pharmacore_restore --no-owner < .local/backups/pharmacore.dump
```

After restoring, verify tenant counts, sale totals against recorded payments, and
batch balances against movement sums. Run the integration suite against a
separate test database, inspect receipts, and measure recovery duration. Keep
the original database available until the owner approves recovery. This runbook
does not constitute a production recovery drill or an RPO/RTO guarantee.

## Migration and deployment boundary

Apply schema migrations with a dedicated migration role. Runtime processes
should use restricted roles that cannot bypass evidence controls. Composite
foreign keys and evidence triggers are installed by `core.0002_integrity` and
must be present after migration. Migration reversal removes those controls;
use only in a maintenance window with writes stopped and a verified backup.

`compose.yaml` is local-only. Do not bind it publicly. Before a staging or live
deployment, add TLS and a reviewed reverse proxy, managed secrets, secure
networking, MFA enrollment/recovery procedures, shared Redis, restricted database roles/RLS, centralized
monitoring, dependency scans, and approved backups. Set Django's secure proxy
settings only after the proxy strips untrusted forwarded headers.

Outside debug, startup blocks by default. `ALLOW_UNREVIEWED_DEPLOYMENT=1` is an
explicit engineering override for an isolated assessment environment, not an
approval for commercial launch. Complete the blueprint's release gates first.


## MFA secrets and recovery

Keep `MFA_ENCRYPTION_KEY` separate from database backups and preserve it across
restores. Debug uses a key derived from the Django secret; changing that secret
also changes the development MFA key. Recovery codes are shown once and stored
as hashes. Each is single-use. There is no self-service MFA reset workflow yet;
do not disable MFA or alter records as an ad hoc recovery procedure.

Print profiles and new sale item reconciliation constraints are installed by
core migrations 0004–0006 and sales migrations 0002–0004. Back up before applying
these migrations. Existing sale allocations remain readable without new item
links; new allocations require their tenant-scoped item link.
