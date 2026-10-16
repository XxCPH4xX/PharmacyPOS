from dataclasses import dataclass
from uuid import UUID

from django.db.models import Q
from rest_framework.exceptions import NotFound, PermissionDenied

from core.models import Branch, Membership, Tenant


@dataclass(frozen=True)
class Scope:
    tenant: Tenant
    branch: Branch
    user: object
    role: str
    roles: frozenset[str] = frozenset()

    def has_role(self, *roles):
        return bool((self.roles or {self.role}).intersection(roles))

    def require(self, action):
        allowed = {
            "read": {"owner", "manager", "cashier", "auditor", "pharmacist", "inventory", "accountant"},
            "sales_read": {"owner", "manager", "cashier", "auditor", "accountant"},
            "manage": {"owner", "manager", "inventory"},
            "sell": {"owner", "manager", "cashier"},
            "owner": {"owner"},
            "report": {"owner", "manager", "auditor", "accountant"},
            "procure": {"owner", "manager", "inventory"},
            "approve": {"owner", "manager"},
            "dispense": {"pharmacist"},
            "finance": {"owner", "accountant"},
            "refund": {"owner", "manager"},
        }
        if not self.has_role(*allowed[action]):
            raise PermissionDenied("Your role does not allow this action.")


def tenant_for(request):
    tenant_id = request.session.get("tenant_id")
    tenant = Tenant.objects.filter(id=tenant_id, active=True).first() if tenant_id else None
    if not tenant or not Membership.objects.filter(tenant=tenant, user=request.user, active=True).exists():
        raise PermissionDenied("Your organization access is inactive. Sign in again.")
    return tenant


def branches_for(user, tenant):
    memberships = Membership.objects.filter(user=user, tenant=tenant, active=True)
    branches = Branch.objects.filter(tenant=tenant, active=True)
    if not memberships.filter(branch__isnull=True).exists():
        branches = branches.filter(id__in=memberships.values("branch_id"))
    return branches.order_by("created_at")


def scope_for(request, action="read"):
    from core.security import enforce_mfa

    enforce_mfa(request)
    tenant = tenant_for(request)
    branches = branches_for(request.user, tenant)
    branch_id = request.headers.get("X-Branch-ID")
    if branch_id:
        try:
            UUID(branch_id)
        except (ValueError, TypeError):
            raise NotFound("Branch not found.") from None
        branch = branches.filter(id=branch_id).first()
    else:
        branch = branches.first()
    if not branch:
        raise NotFound("Branch not found.")
    memberships = Membership.objects.filter(tenant=tenant, user=request.user, active=True).filter(
        Q(branch=branch) | Q(branch__isnull=True)
    )
    rank = {
        "owner": 0,
        "manager": 1,
        "pharmacist": 2,
        "inventory": 3,
        "accountant": 4,
        "cashier": 5,
        "auditor": 6,
    }
    roles = frozenset(memberships.values_list("role", flat=True))
    role = min(roles, key=rank.get)
    scope = Scope(tenant, branch, request.user, role, roles)
    scope.require(action)
    if action == "owner" and not memberships.filter(role="owner", branch__isnull=True).exists():
        raise PermissionDenied("An organization owner is required.")
    return scope
