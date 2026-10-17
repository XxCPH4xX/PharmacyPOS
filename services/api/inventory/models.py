from django.db import models
from django.db.models import Q

from catalog.models import TenantProduct
from core.models import Branch, ScopedEntity


class Batch(ScopedEntity):
    class Status(models.TextChoices):
        AVAILABLE = "available", "Available"
        QUARANTINED = "quarantined", "Quarantined"
        RECALLED = "recalled", "Recalled"

    branch = models.ForeignKey(Branch, on_delete=models.PROTECT)
    product = models.ForeignKey(TenantProduct, on_delete=models.PROTECT, related_name="batches")
    number = models.CharField(max_length=80)
    expiry = models.DateField()
    quantity = models.PositiveIntegerField(default=0)
    loose_quantity = models.PositiveIntegerField(default=0)
    inner_quantity = models.PositiveIntegerField(default=0)
    outer_quantity = models.PositiveIntegerField(default=0)
    inner_size = models.PositiveIntegerField(default=1)
    outer_size = models.PositiveIntegerField(default=1)
    unit_cost_minor = models.PositiveBigIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.AVAILABLE)
    location = models.CharField(max_length=40, default="A-01")

    class Meta(ScopedEntity.Meta):
        constraints = ScopedEntity.Meta.constraints + [
            models.UniqueConstraint(
                fields=["tenant", "branch", "product", "number"], name="batch_number_unique"
            ),
            models.UniqueConstraint(
                fields=["tenant", "branch", "product", "id"], name="batch_context_unique"
            ),
            models.CheckConstraint(
                condition=Q(status__in=["available", "quarantined", "recalled"]), name="batch_status_valid"
            ),
            models.CheckConstraint(condition=Q(quantity__lte=10000000), name="batch_quantity_bounded"),
            models.CheckConstraint(
                condition=Q(
                    quantity=models.F("loose_quantity")
                    + models.F("inner_quantity") * models.F("inner_size")
                    + models.F("outer_quantity") * models.F("outer_size")
                ),
                name="batch_physical_quantity_balanced",
            ),
        ]
        indexes = [models.Index(fields=["tenant", "branch", "product", "expiry"])]


class GoodsReceipt(ScopedEntity):
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT)
    batch = models.ForeignKey(Batch, on_delete=models.PROTECT)
    reference = models.CharField(max_length=80)
    supplier = models.CharField(max_length=120)
    quantity = models.PositiveIntegerField()
    total_minor = models.PositiveBigIntegerField()
    unit_name = models.CharField(max_length=12, default="UNIT")
    package_quantity = models.PositiveIntegerField(default=0)
    base_units = models.PositiveIntegerField(default=1)

    class Meta(ScopedEntity.Meta):
        constraints = ScopedEntity.Meta.constraints + [
            models.UniqueConstraint(fields=["tenant", "branch", "reference"], name="receipt_reference_unique")
        ]


class StockMovement(ScopedEntity):
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT)
    batch = models.ForeignKey(Batch, on_delete=models.PROTECT, related_name="movements")
    product = models.ForeignKey(TenantProduct, on_delete=models.PROTECT)
    quantity = models.IntegerField()
    kind = models.CharField(
        max_length=16, choices=[("receipt", "Receipt"), ("sale", "Sale"), ("removal", "Removal")]
    )
    source_id = models.UUIDField()
    reference = models.CharField(max_length=80)

    class Meta(ScopedEntity.Meta):
        constraints = ScopedEntity.Meta.constraints + [
            models.CheckConstraint(
                condition=Q(kind="receipt", quantity__gt=0) | Q(kind__in=["sale", "removal"], quantity__lt=0),
                name="movement_direction_valid",
            ),
        ]


class PackageMovement(ScopedEntity):
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT)
    batch = models.ForeignKey(Batch, on_delete=models.PROTECT, related_name="package_movements")
    loose_delta = models.IntegerField(default=0)
    inner_delta = models.IntegerField(default=0)
    outer_delta = models.IntegerField(default=0)
    kind = models.CharField(max_length=16)
    source_id = models.UUIDField()
