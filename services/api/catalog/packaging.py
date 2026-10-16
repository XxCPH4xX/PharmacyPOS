from django.db import transaction
from django.db.models import Q
from rest_framework import serializers

from catalog.models import ProductUnit, TenantProduct
from core.errors import BusinessError
from core.operations import audit
from core.serializers import StrictSerializer

BASE_UNITS = {
    "Tablets": ["TABLET"],
    "Capsules": ["CAPSULE"],
    "Syrups": ["BOTTLE"],
    "Creams": ["TUBE"],
    "Injections": ["AMPOULE", "VIAL"],
    "Powders": ["SACHET"],
    "Supplies": ["PIECE", "BOTTLE", "SACHET", "TUBE"],
}


class PackagingInput(StrictSerializer):
    base_unit = serializers.ChoiceField(choices=sorted({u for units in BASE_UNITS.values() for u in units}))
    inner_name = serializers.ChoiceField(choices=["", "STRIP", "PACK"], default="")
    inner_size = serializers.IntegerField(min_value=1, max_value=10000, default=1)
    outer_name = serializers.ChoiceField(choices=["", "BOX", "CARTON"], default="")
    inners_per_outer = serializers.IntegerField(min_value=1, max_value=10000, default=1)
    allow_break_inner = serializers.BooleanField(default=False)
    allow_break_outer = serializers.BooleanField(default=False)
    inner_price_minor = serializers.IntegerField(
        min_value=0, max_value=100000000, allow_null=True, default=None
    )
    outer_price_minor = serializers.IntegerField(
        min_value=0, max_value=100000000, allow_null=True, default=None
    )

    def validate(self, data):
        if data["inner_name"] and data["inner_size"] < 2:
            raise serializers.ValidationError("An inner package must contain at least two base units.")
        if not data["inner_name"]:
            data["inner_size"] = 1
        outer_size = data["inner_size"] * data["inners_per_outer"] if data["outer_name"] else 1
        if data["outer_name"] and (outer_size < 2 or outer_size > 10000):
            raise serializers.ValidationError("An outer package must contain 2 to 10,000 base units.")
        return data


def packaging_data(item):
    units = {u.name: u for u in item.units.all()}
    return {
        "base_unit": item.base_unit,
        "inner_name": item.inner_name,
        "inner_size": item.inner_size,
        "outer_name": item.outer_name,
        "inners_per_outer": item.outer_size // item.inner_size if item.outer_name else 1,
        "allow_break_inner": item.allow_break_inner,
        "allow_break_outer": item.allow_break_outer,
        "inner_price_minor": units[item.inner_name].price_minor if item.inner_name in units else None,
        "outer_price_minor": units[item.outer_name].price_minor if item.outer_name in units else None,
    }


@transaction.atomic
def configure_packaging(scope, item, data):
    scope.require("manage")
    from core.models import Branch
    from inventory.models import Batch

    Branch.objects.select_for_update().get(id=scope.branch.id, tenant=scope.tenant)

    item = (
        TenantProduct.objects.select_for_update()
        .select_related("product")
        .get(id=item.id, tenant=scope.tenant)
    )
    if data["base_unit"] not in BASE_UNITS.get(item.product.form, ["PIECE"]):
        raise BusinessError("Choose a base unit appropriate for this dosage form.", "invalid_packaging", 400)
    if data["inner_name"] == "STRIP" and item.product.form not in {"Tablets", "Capsules"}:
        raise BusinessError("Strips are only supported for tablets and capsules.", "invalid_packaging", 400)
    outer_size = data["inner_size"] * data["inners_per_outer"] if data["outer_name"] else 1
    new_structure = (
        data["base_unit"],
        data["inner_name"],
        data["inner_size"],
        data["outer_name"],
        outer_size,
    )
    old_structure = (item.base_unit, item.inner_name, item.inner_size, item.outer_name, item.outer_size)
    if (
        new_structure != old_structure
        and Batch.objects.filter(product=item)
        .filter(Q(inner_quantity__gt=0) | Q(outer_quantity__gt=0))
        .exists()
    ):
        raise BusinessError(
            "Sealed packages still exist in inventory. Receive a distinct product for a different manufacturer pack size.",
            "packaging_in_use",
        )
    for field in [
        "base_unit",
        "inner_name",
        "inner_size",
        "outer_name",
        "allow_break_inner",
        "allow_break_outer",
    ]:
        setattr(item, field, data[field])
    item.outer_size = outer_size
    item.save()
    names = []
    for level in ["inner", "outer"]:
        name = getattr(item, f"{level}_name")
        if name:
            names.append(name)
            ProductUnit.objects.update_or_create(
                tenant=scope.tenant,
                product=item,
                name=name,
                defaults={
                    "base_units": getattr(item, f"{level}_size"),
                    "active": True,
                    "price_minor": data[f"{level}_price_minor"],
                },
            )
    item.units.exclude(name__in=names).update(active=False)
    audit(scope, "catalog.packaging_configured", item.id, data)
    return item
