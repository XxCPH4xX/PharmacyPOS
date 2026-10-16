import hashlib
import json

from core.errors import BusinessError
from core.models import AuditEvent, Branch, Operation, Tenant


def lock_active_scope(scope):
    # Serialize the branch before looking up a key so concurrent retries see the commit.
    Branch.objects.select_for_update().get(id=scope.branch.id, tenant=scope.tenant)
    if not Tenant.objects.filter(id=scope.tenant.id, active=True).exists():
        raise BusinessError(
            "This workspace was reset. Reload to use the new workspace.", "workspace_archived", 409
        )


def lock_operation(scope, kind, key, payload):
    if not key or len(key) > 100:
        raise BusinessError("A valid Idempotency-Key header is required.", "idempotency_required", 400)
    lock_active_scope(scope)
    fingerprint = hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str, separators=(",", ":")).encode()
    ).hexdigest()
    prior = Operation.objects.filter(tenant=scope.tenant, branch=scope.branch, kind=kind, key=key).first()
    if prior and prior.fingerprint != fingerprint:
        raise BusinessError(
            "This operation key was already used with different input.", "idempotency_conflict"
        )
    return fingerprint, prior.result if prior else None


def complete_operation(scope, kind, key, fingerprint, result):
    Operation.objects.create(
        tenant=scope.tenant, branch=scope.branch, kind=kind, key=key, fingerprint=fingerprint, result=result
    )
    return result


def audit(scope, action, entity_id, detail=None):
    AuditEvent.objects.create(
        tenant=scope.tenant,
        branch=scope.branch,
        actor=scope.user,
        action=action,
        entity_id=entity_id,
        detail=detail or {},
    )
