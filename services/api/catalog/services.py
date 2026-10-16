from django.db import IntegrityError, transaction

from catalog.models import Product, TenantProduct
from catalog.packaging import BASE_UNITS, configure_packaging
from core.errors import BusinessError
from core.operations import audit, lock_active_scope


@transaction.atomic
def create_product(scope, data):
    scope.require("manage")
    lock_active_scope(scope)
    identity = {
        key: data[key]
        for key in ["name", "generic", "strength", "form", "manufacturer", "prescription_required"]
    }
    try:
        with transaction.atomic():
            product = Product.objects.create(tenant=scope.tenant, **identity)
            item = TenantProduct.objects.create(
                tenant=scope.tenant,
                product=product,
                base_unit=BASE_UNITS[data["form"]][0],
                **{key: data[key] for key in ["sku", "barcode", "price_minor", "reorder_level"]},
            )
    except IntegrityError:
        raise BusinessError("This SKU or barcode is already in your catalog.", "duplicate_product") from None
    if data.get("packaging"):
        item = configure_packaging(scope, item, data["packaging"])
    audit(scope, "catalog.created", item.id, {"sku": item.sku})
    return item
