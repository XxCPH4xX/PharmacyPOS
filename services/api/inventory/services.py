from django.db import transaction
from django.utils import timezone

from catalog.models import ProductUnit, TenantProduct
from core.errors import BusinessError
from core.operations import audit, complete_operation, lock_operation
from inventory.models import Batch, GoodsReceipt, StockMovement
from inventory.packaging import physical_counts, record_packages


@transaction.atomic
def receive_batch(scope, data, key):
    scope.require("manage")
    fingerprint, prior = lock_operation(scope, "receive", key, data)
    if prior is not None:
        return prior
    product = (
        TenantProduct.objects.select_for_update()
        .filter(tenant=scope.tenant, id=data["product_id"], active=True)
        .first()
    )
    if not product:
        raise BusinessError("Medicine not found in this organization.", "product_not_found", 404)
    unit = None
    if data.get("unit_id"):
        unit = ProductUnit.objects.filter(
            id=data["unit_id"], product=product, tenant=scope.tenant, active=True
        ).first()
        if not unit or unit.name not in {product.inner_name, product.outer_name}:
            raise BusinessError("Select a configured receiving unit.", "unit_not_found", 400)
    multiplier = unit.base_units if unit else 1
    if multiplier != data.get("expected_base_units", 1):
        raise BusinessError("The package size changed. Review the delivery.", "unit_changed")
    received = data["quantity"] * multiplier
    if received > 10000000:
        raise BusinessError("Delivery quantity exceeds the supported limit.", "quantity_limit", 400)
    if data["expiry"] <= timezone.localdate():
        raise BusinessError("Receive only batches that expire after today.", "expired_batch", 400)
    if GoodsReceipt.objects.filter(
        tenant=scope.tenant, branch=scope.branch, reference=data["reference"]
    ).exists():
        raise BusinessError("This delivery reference has already been received.", "duplicate_receipt")
    batch = Batch.objects.filter(
        tenant=scope.tenant, branch=scope.branch, product=product, number=data["batch_number"]
    ).first()
    if batch and (
        batch.expiry != data["expiry"]
        or batch.unit_cost_minor != data["unit_cost_minor"]
        or batch.status != "available"
        or batch.location != data["location"]
    ):
        raise BusinessError(
            "Existing batch expiry, cost, location or condition does not match.", "batch_conflict"
        )
    if batch and batch.quantity + received > 10000000:
        raise BusinessError("Batch quantity exceeds the supported limit.", "quantity_limit")
    if not batch:
        batch = Batch.objects.create(
            tenant=scope.tenant,
            branch=scope.branch,
            product=product,
            number=data["batch_number"],
            expiry=data["expiry"],
            unit_cost_minor=data["unit_cost_minor"],
            location=data["location"],
        )
    before = physical_counts(batch)
    batch.inner_size, batch.outer_size = product.inner_size, product.outer_size
    if unit and unit.name == product.outer_name:
        batch.outer_quantity += data["quantity"]
    elif unit:
        batch.inner_quantity += data["quantity"]
    else:
        batch.loose_quantity += data["quantity"]
    batch.quantity += received
    batch.save(
        update_fields=[
            "quantity",
            "loose_quantity",
            "inner_quantity",
            "outer_quantity",
            "inner_size",
            "outer_size",
        ]
    )
    receipt = GoodsReceipt.objects.create(
        tenant=scope.tenant,
        branch=scope.branch,
        batch=batch,
        reference=data["reference"],
        supplier=data["supplier"],
        quantity=received,
        unit_name=unit.name if unit else product.base_unit,
        package_quantity=data["quantity"],
        base_units=multiplier,
        total_minor=received * data["unit_cost_minor"],
    )
    StockMovement.objects.create(
        tenant=scope.tenant,
        branch=scope.branch,
        batch=batch,
        product=product,
        quantity=received,
        kind="receipt",
        source_id=receipt.id,
        reference=receipt.reference,
    )
    record_packages(scope, batch, before, "receipt", receipt.id)
    audit(scope, "inventory.received", receipt.id, {"batch_id": str(batch.id), "quantity": receipt.quantity})
    return complete_operation(
        scope,
        "receive",
        key,
        fingerprint,
        {
            "id": str(receipt.id),
            "batch_id": str(batch.id),
            "reference": receipt.reference,
            "quantity": receipt.quantity,
        },
    )
