from django.db import models
from django.db.models import Q

from core.models import ScopedEntity


class Product(ScopedEntity):
    name = models.CharField(max_length=120)
    generic = models.CharField(max_length=150)
    strength = models.CharField(max_length=60)
    form = models.CharField(max_length=30, default="Tablets")
    manufacturer = models.CharField(max_length=120)
    prescription_required = models.BooleanField(default=False)


class TenantProduct(ScopedEntity):
    product = models.OneToOneField(Product, on_delete=models.PROTECT)
    sku = models.CharField(max_length=40)
    barcode = models.CharField(max_length=64)
    price_minor = models.PositiveBigIntegerField()
    reorder_level = models.PositiveIntegerField(default=30)
    active = models.BooleanField(default=True)
    base_unit = models.CharField(max_length=12, default="PIECE")
    inner_name = models.CharField(max_length=8, blank=True)
    inner_size = models.PositiveIntegerField(default=1)
    outer_name = models.CharField(max_length=8, blank=True)
    outer_size = models.PositiveIntegerField(default=1)
    allow_break_inner = models.BooleanField(default=False)
    allow_break_outer = models.BooleanField(default=False)

    class Meta(ScopedEntity.Meta):
        constraints = ScopedEntity.Meta.constraints + [
            models.UniqueConstraint(
                fields=["tenant", "sku"], condition=Q(active=True), name="catalog_tenant_sku_unique"
            ),
            models.UniqueConstraint(
                fields=["tenant", "barcode"], condition=Q(active=True), name="catalog_tenant_barcode_unique"
            ),
            models.CheckConstraint(condition=Q(price_minor__lte=100000000), name="catalog_price_bounded"),
            models.CheckConstraint(
                condition=Q(inner_size__gte=1, outer_size__gte=1, outer_size__lte=10000),
                name="catalog_package_sizes_valid",
            ),
        ]


class ProductUnit(ScopedEntity):
    product = models.ForeignKey(TenantProduct, on_delete=models.PROTECT, related_name="units")
    name = models.CharField(
        max_length=8, choices=[("BOX", "Box"), ("STRIP", "Strip"), ("PACK", "Pack"), ("CARTON", "Carton")]
    )
    base_units = models.PositiveIntegerField()
    active = models.BooleanField(default=True)
    price_minor = models.PositiveBigIntegerField(null=True, blank=True)

    class Meta(ScopedEntity.Meta):
        constraints = ScopedEntity.Meta.constraints + [
            models.UniqueConstraint(fields=["tenant", "product", "name"], name="product_unit_name_unique"),
            models.CheckConstraint(
                condition=Q(base_units__gte=2, base_units__lte=10000), name="product_unit_conversion_valid"
            ),
            models.CheckConstraint(
                condition=Q(name__in=["BOX", "STRIP", "PACK", "CARTON"]), name="product_unit_name_valid"
            ),
            models.CheckConstraint(
                condition=Q(price_minor__isnull=True) | Q(price_minor__lte=100000000),
                name="product_unit_price_bounded",
            ),
        ]
