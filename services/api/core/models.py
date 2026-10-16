import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class Entity(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        abstract = True


class Tenant(Entity):
    archived_at = models.DateTimeField(null=True, blank=True)
    replaces = models.OneToOneField("self", null=True, blank=True, on_delete=models.PROTECT, related_name="replacement")
    version = models.PositiveIntegerField(default=1)
    name = models.CharField(max_length=150)
    active = models.BooleanField(default=True)
    currency = models.CharField(max_length=3, default="BDT", editable=False)


class ScopedEntity(Entity):
    tenant = models.ForeignKey(Tenant, on_delete=models.PROTECT)

    class Meta:
        abstract = True
        constraints = [
            models.UniqueConstraint(fields=["tenant", "id"], name="%(app_label)s_%(class)s_tenant_id")
        ]


class Branch(ScopedEntity):
    version = models.PositiveIntegerField(default=1)
    name = models.CharField(max_length=120)
    address = models.CharField(max_length=250, blank=True)
    active = models.BooleanField(default=True)


class Membership(ScopedEntity):
    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        MANAGER = "manager", "Manager"
        CASHIER = "cashier", "Cashier"
        AUDITOR = "auditor", "Auditor"
        PHARMACIST = "pharmacist", "Pharmacist"
        INVENTORY = "inventory", "Inventory manager"
        ACCOUNTANT = "accountant", "Accountant"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    branch = models.ForeignKey(Branch, null=True, blank=True, on_delete=models.PROTECT)
    role = models.CharField(max_length=12, choices=Role.choices)
    active = models.BooleanField(default=True)

    class Meta(ScopedEntity.Meta):
        constraints = ScopedEntity.Meta.constraints + [
            models.UniqueConstraint(fields=["tenant", "user", "branch"], name="membership_branch_unique"),
            models.UniqueConstraint(
                fields=["tenant", "user"], condition=Q(branch__isnull=True), name="membership_org_unique"
            ),
            models.CheckConstraint(
                condition=Q(
                    role__in=[
                        "owner",
                        "manager",
                        "cashier",
                        "auditor",
                        "pharmacist",
                        "inventory",
                        "accountant",
                    ]
                ),
                name="membership_role_valid",
            ),
        ]


class AuditEvent(ScopedEntity):
    branch = models.ForeignKey(Branch, null=True, on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    action = models.CharField(max_length=64)
    entity_id = models.UUIDField()
    detail = models.JSONField(default=dict)

    class Meta(ScopedEntity.Meta):
        indexes = [models.Index(fields=["tenant", "created_at"])]


class Operation(ScopedEntity):
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT)
    kind = models.CharField(max_length=32)
    key = models.CharField(max_length=100)
    fingerprint = models.CharField(max_length=64)
    result = models.JSONField()

    class Meta(ScopedEntity.Meta):
        constraints = ScopedEntity.Meta.constraints + [
            models.UniqueConstraint(fields=["tenant", "branch", "kind", "key"], name="operation_key_unique")
        ]


class MFADevice(Entity):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    secret_ciphertext = models.TextField()
    enabled = models.BooleanField(default=False)
    last_counter = models.BigIntegerField(default=-1)
    recovery_hashes = models.JSONField(default=list)
    failures = models.PositiveIntegerField(default=0)
    locked_until = models.DateTimeField(null=True)
    pending_since = models.DateTimeField(default=timezone.now)


class Invitation(ScopedEntity):
    email = models.EmailField(max_length=150)
    role = models.CharField(max_length=12, choices=Membership.Role.choices)
    branch = models.ForeignKey(Branch, null=True, on_delete=models.PROTECT)
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    accepted_at = models.DateTimeField(null=True)
    revoked_at = models.DateTimeField(null=True)
    invited_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)

    class Meta(ScopedEntity.Meta):
        constraints = ScopedEntity.Meta.constraints + [
            models.CheckConstraint(condition=~Q(role="owner"), name="invitation_no_owner")
        ]


class ReceiptProfile(ScopedEntity):
    tenant = models.OneToOneField(Tenant, on_delete=models.PROTECT)
    data = models.JSONField(default=dict)
    version = models.PositiveIntegerField(default=1)


class Customer(ScopedEntity):
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT)
    name = models.CharField(max_length=100)
    phone = models.CharField(max_length=25, blank=True)
    address = models.CharField(max_length=250, blank=True)
    bin = models.CharField(max_length=13, blank=True)

    class Meta(ScopedEntity.Meta):
        constraints = ScopedEntity.Meta.constraints + [
            models.UniqueConstraint(fields=["tenant", "branch", "id"], name="customer_branch_context"),
            models.UniqueConstraint(
                fields=["tenant", "branch", "phone"],
                condition=~Q(phone=""),
                name="customer_phone_unique",
            ),
        ]
        indexes = [models.Index(fields=["tenant", "branch", "name"])]
