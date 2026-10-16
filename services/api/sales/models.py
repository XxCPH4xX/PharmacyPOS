from django.conf import settings
from django.db import models
from django.db.models import Q

from catalog.models import TenantProduct
from core.models import Branch, Customer, ScopedEntity
from inventory.models import Batch


class Sale(ScopedEntity):
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT)
    cashier = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    receipt_number = models.CharField(max_length=40, unique=True)
    total_minor = models.PositiveBigIntegerField()
    cost_minor = models.PositiveBigIntegerField()
    tendered_minor = models.PositiveBigIntegerField()
    receipt_profile = models.JSONField(default=dict)
    customer = models.ForeignKey(Customer, null=True, blank=True, on_delete=models.PROTECT)
    customer_name = models.CharField(max_length=100, blank=True)
    customer_phone = models.CharField(max_length=25, blank=True)
    customer_address = models.CharField(max_length=250, blank=True)
    customer_bin = models.CharField(max_length=13, blank=True)
    customer_type = models.CharField(max_length=16, default="Retail")
    remarks = models.CharField(max_length=500, blank=True)

    class Meta(ScopedEntity.Meta):
        constraints = ScopedEntity.Meta.constraints + [
            models.CheckConstraint(
                condition=Q(tendered_minor__gte=models.F("total_minor")), name="sale_tender_covers_total"
            ),
        ]
        indexes = [models.Index(fields=["tenant", "branch", "created_at"])]


class SaleLine(ScopedEntity):
    sale = models.ForeignKey(Sale, related_name="lines", on_delete=models.PROTECT)
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT)
    product = models.ForeignKey(TenantProduct, on_delete=models.PROTECT)
    batch = models.ForeignKey(Batch, on_delete=models.PROTECT)
    name = models.CharField(max_length=200)
    quantity = models.PositiveIntegerField()
    unit_price_minor = models.PositiveBigIntegerField()
    unit_cost_minor = models.PositiveBigIntegerField()
    total_minor = models.PositiveBigIntegerField(default=0)
    item = models.ForeignKey("SaleItem", null=True, on_delete=models.PROTECT, related_name="allocations")

    class Meta(ScopedEntity.Meta):
        constraints = ScopedEntity.Meta.constraints + [
            models.CheckConstraint(condition=Q(quantity__gt=0), name="sale_line_positive")
        ]


class Payment(ScopedEntity):
    sale = models.OneToOneField(Sale, related_name="payment", on_delete=models.PROTECT)
    amount_minor = models.PositiveBigIntegerField()
    method = models.CharField(max_length=10, default="cash")
    reference = models.CharField(max_length=80, blank=True)
    verification = models.CharField(max_length=16, default="cash_received")

    class Meta(ScopedEntity.Meta):
        constraints = ScopedEntity.Meta.constraints + [
            models.CheckConstraint(
                condition=Q(method__in=["cash", "bkash", "nagad"]), name="payment_method_valid"
            ),
            models.CheckConstraint(
                condition=Q(method="cash", verification="cash_received", reference="")
                | (Q(method__in=["bkash", "nagad"], verification="staff_confirmed") & ~Q(reference="")),
                name="payment_evidence_valid",
            ),
            models.UniqueConstraint(
                fields=["tenant", "method", "reference"],
                condition=~Q(reference=""),
                name="payment_reference_unique",
            ),
        ]


class SaleItem(ScopedEntity):
    sale = models.ForeignKey(Sale, related_name="items", on_delete=models.PROTECT)
    product = models.ForeignKey(TenantProduct, on_delete=models.PROTECT)
    name = models.CharField(max_length=200)
    sku = models.CharField(max_length=40, blank=True)
    quantity = models.PositiveIntegerField()
    unit_name = models.CharField(max_length=8, default="UNIT")
    base_units = models.PositiveIntegerField(default=1)
    unit_price_minor = models.PositiveBigIntegerField()

    class Meta(ScopedEntity.Meta):
        constraints = ScopedEntity.Meta.constraints + [
            models.CheckConstraint(
                condition=Q(quantity__gt=0, base_units__gt=0), name="sale_item_units_positive"
            ),
            models.UniqueConstraint(fields=["tenant", "sale", "id"], name="sale_item_context_unique"),
        ]
