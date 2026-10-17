import uuid

from django.db import IntegrityError, transaction
from django.utils import timezone

from catalog.models import ProductUnit, TenantProduct
from core.tax import calculate, config_for
from core.errors import BusinessError
from core.models import Customer
from core.operations import audit, complete_operation, lock_operation
from core.receipts import amount_words, profile_snapshot
from inventory.models import Batch, StockMovement
from inventory.packaging import available_packages, consume_packages, physical_counts, record_packages
from sales.models import Payment, Sale, SaleItem, SaleLine


def receipt_data(sale):
    items = list(sale.items.prefetch_related("allocations__batch").order_by("created_at", "id"))
    lines = []
    if items:
        for item in items:
            allocations = [
                {"batch": a.batch.number, "expiry": a.batch.expiry.isoformat(), "base_quantity": a.quantity}
                for a in sorted(
                    item.allocations.all(),
                    key=lambda a: (a.batch.expiry, a.batch.created_at, str(a.batch_id)),
                )
            ]
            lines.append(
                {
                    "id": str(item.id),
                    "product_id": str(item.product_id),
                    "name": item.name,
                    "sku": item.sku,
                    "quantity": item.quantity,
                    "unit_name": item.unit_name,
                    "base_units": item.base_units,
                    "unit_price_minor": item.unit_price_minor,
                    "total_minor": item.quantity * item.unit_price_minor,
                    "allocations": allocations,
                    "batch": ", ".join(a["batch"] for a in allocations),
                    "expiry": min((a["expiry"] for a in allocations), default=""),
                }
            )
    else:
        for line in sale.lines.select_related("batch"):
            lines.append(
                {
                    "id": str(line.id),
                    "product_id": str(line.product_id),
                    "name": line.name,
                    "quantity": line.quantity,
                    "unit_name": "UNIT",
                    "base_units": 1,
                    "unit_price_minor": line.unit_price_minor,
                    "total_minor": line.quantity * line.unit_price_minor,
                    "batch": line.batch.number,
                    "expiry": line.batch.expiry.isoformat(),
                    "allocations": [
                        {
                            "batch": line.batch.number,
                            "expiry": line.batch.expiry.isoformat(),
                            "base_quantity": line.quantity,
                        }
                    ],
                }
            )
    snapshots = {entry["product_id"]: entry for entry in sale.tax_snapshot.get("lines", [])}
    for line in lines:
        snapshot = snapshots.get(line["product_id"], {})
        line["discount_minor"] = snapshot.get("discount_minor", 0)
        line["vat_minor"] = snapshot.get("vat_minor", 0)
        line["vat_rate_bps"] = snapshot.get("rate_bps", 0)
        line["vat_mode"] = snapshot.get("mode", "exclusive")
    return {
        "id": str(sale.id),
        "receipt_number": sale.receipt_number,
        "created_at": sale.created_at.isoformat(),
        "branch": sale.receipt_profile.get("branch_name", sale.branch.name),
        "address": sale.receipt_profile.get("branch_address", sale.branch.address),
        "organization": sale.receipt_profile.get("organization_name", sale.tenant.name),
        "cashier": sale.cashier.first_name or sale.cashier.username,
        "staff_name": sale.receipt_profile.get("staff_name")
        or sale.cashier.first_name
        or sale.cashier.username,
        "created_by": sale.receipt_profile.get("created_by")
        or sale.cashier.first_name
        or sale.cashier.username,
        "total_minor": sale.total_minor,
        "subtotal_minor": sale.subtotal_minor or (sale.total_minor if not sale.tax_snapshot else 0),
        "discount_minor": sale.discount_minor,
        "vat_minor": sale.vat_minor,
        "tax_snapshot": sale.tax_snapshot,
        "tendered_minor": sale.tendered_minor,
        "change_minor": sale.tendered_minor - sale.total_minor,
        "payment_method": sale.payment.method,
        "payment_reference": sale.payment.reference,
        "payment_verification": sale.payment.verification,
        "status": "completed",
        "customer_id": str(sale.customer_id) if sale.customer_id else None,
        "customer_name": sale.customer_name,
        "customer_phone": sale.customer_phone,
        "customer_address": sale.customer_address,
        "customer_bin": sale.customer_bin,
        "customer_type": sale.customer_type,
        "remarks": sale.remarks,
        "receipt_profile": sale.receipt_profile,
        "amount_in_words": amount_words(sale.total_minor),
        "tax_status": "calculated" if sale.tax_snapshot.get("enabled", False) else "not_calculated",
        "lines": lines,
    }


@transaction.atomic
def _checkout(scope, data, key, *, occurred_at=None):
    scope.require("sell")
    fingerprint, prior = lock_operation(scope, "checkout", key, data)
    if prior is not None:
        return prior
    customer = None
    customer_snapshot = {
        field: data.get(field, "")
        for field in ["customer_name", "customer_phone", "customer_address", "customer_bin"]
    }
    if data.get("customer_id"):
        customer = Customer.objects.filter(
            id=data["customer_id"], tenant=scope.tenant, branch=scope.branch
        ).first()
        if not customer:
            raise BusinessError("Customer not found in this branch.", "customer_not_found", 404)
        customer_snapshot = {
            f"customer_{field}": getattr(customer, field) for field in ["name", "phone", "address", "bin"]
        }
    allocations = []
    cart_items = {}
    method = data.get("payment_method", "cash")
    reference = data.get("payment_reference", "").strip().upper()
    if method not in {"cash", "bkash", "nagad"}:
        raise BusinessError("Select a supported payment method.", "invalid_payment", 400)
    if method != "cash":
        if not data.get("payment_confirmed") or not reference:
            raise BusinessError(
                "Verify the payment in your merchant account and enter its transaction reference.",
                "payment_confirmation_required",
                400,
            )
        if Payment.objects.filter(tenant=scope.tenant, method=method, reference=reference).exists():
            raise BusinessError("This payment reference has already been used.", "duplicate_payment")
    elif reference:
        raise BusinessError("Cash payments do not use a mobile payment reference.", "invalid_payment", 400)
    total = cost = 0
    for entry in sorted(data["lines"], key=lambda item: str(item["product_id"])):
        item = (
            TenantProduct.objects.select_for_update(of=("self",))
            .select_related("product")
            .filter(id=entry["product_id"], tenant=scope.tenant, active=True)
            .first()
        )
        if not item:
            raise BusinessError("Medicine not found in this organization.", "product_not_found", 404)
        if item.product.prescription_required:
            raise BusinessError(
                f"{item.product.name} requires prescription verification. Dispensing is not enabled in this release.",
                "prescription_required",
            )
        if item.price_minor != entry["expected_price_minor"]:
            raise BusinessError(
                f"The price of {item.product.name} has changed. Refresh and review the cart.", "price_changed"
            )
        unit = None
        if entry.get("unit_id"):
            unit = ProductUnit.objects.filter(
                id=entry["unit_id"], tenant=scope.tenant, product=item, active=True
            ).first()
            if not unit:
                raise BusinessError("The selected selling unit is unavailable.", "unit_not_found", 404)
        multiplier = unit.base_units if unit else 1
        if multiplier != entry.get("expected_base_units", 1):
            raise BusinessError("The package size changed. Refresh and review this sale.", "unit_changed")
        level = "base"
        if unit:
            if unit.name not in {item.inner_name, item.outer_name}:
                raise BusinessError("Review this product's packaging definition.", "unit_changed")
            level = "inner" if unit.name == item.inner_name else "outer"
        unit_price = (
            unit.price_minor if unit and unit.price_minor is not None else item.price_minor * multiplier
        )
        expected_unit_price = entry.get(
            "expected_unit_price_minor", entry["expected_price_minor"] * multiplier
        )
        if unit_price != expected_unit_price:
            raise BusinessError("The package price changed. Refresh and review the sale.", "price_changed")
        remaining = entry["quantity"]
        if remaining * multiplier > 1000000:
            raise BusinessError("Quantity exceeds the supported limit.", "quantity_limit", 400)
        cart_items[item.id] = {
            "product": item,
            "name": f"{item.product.name} {item.product.strength}",
            "sku": item.sku,
            "quantity": entry["quantity"],
            "unit_name": unit.name if unit else item.base_unit,
            "base_units": multiplier,
            "unit_price_minor": unit_price,
        }
        batches = (
            Batch.objects.select_for_update()
            .filter(
                tenant=scope.tenant,
                branch=scope.branch,
                product=item,
                status="available",
                expiry__gt=timezone.localdate(),
                quantity__gt=0,
            )
            .order_by("expiry", "created_at", "id")
        )
        for batch in batches:
            take = min(remaining, available_packages(batch, item, level))
            if take:
                allocations.append((item, batch, level, take, take * unit_price))
                total += take * unit_price
                cost += take * multiplier * batch.unit_cost_minor
                remaining -= take
            if remaining == 0:
                break
        if remaining:
            raise BusinessError(
                f"Not enough eligible stock for {item.product.name}. Refresh availability and try again.",
                "insufficient_stock",
            )
    if total > 1000000000000:
        raise BusinessError("Sale total exceeds the supported limit.", "amount_limit", 400)
    configuration = config_for(scope.tenant)
    if data.get("expected_tax_version") is not None and data["expected_tax_version"] != configuration["version"]:
        raise BusinessError("VAT settings changed. Review this sale.", "tax_settings_changed", 409)
    try:
        prices = calculate(
            [{"product_id": product_id, "amount_minor": info["quantity"] * info["unit_price_minor"]}
             for product_id, info in cart_items.items()],
            configuration,
            data.get("discount_type", "none"),
            data.get("discount_value", 0),
        )
    except ValueError as exc:
        raise BusinessError(str(exc), "discount_invalid", 400) from None
    prices["enabled"] = configuration.get("enabled", False)
    prices["settings_version"] = configuration["version"]
    if prices["subtotal_minor"] != total:
        raise BusinessError("Sale subtotal mismatch.", "subtotal_changed", 409)
    total = prices["total_minor"]
    if total > 1000000000000:
        raise BusinessError("Sale total exceeds the supported limit.", "amount_limit", 400)
    if data.get("expected_total_minor") is not None and data["expected_total_minor"] != total:
        raise BusinessError("Tax or discount settings changed. Review the new total.", "total_changed", 409)
    tendered = data["tendered_minor"] if method == "cash" else total
    if tendered < total:
        raise BusinessError("Cash received must cover the sale total.", "insufficient_tender", 400)
    sale_id = uuid.uuid4()
    when = occurred_at or timezone.now()
    printing = profile_snapshot(scope)
    printing.update(
        branch_name=scope.branch.name,
        branch_address=scope.branch.address,
        organization_name=scope.tenant.name,
    )
    actual_name = scope.user.first_name or scope.user.username
    printing["staff_name"] = data.get("staff_name") or printing.get("default_staff_name") or actual_name
    printing["created_by"] = data.get("created_by") or printing.get("default_created_by") or actual_name
    sale = Sale.objects.create(
        id=sale_id,
        tenant=scope.tenant,
        branch=scope.branch,
        cashier=scope.user,
        receipt_number=f"PC-{timezone.localtime(when):%y%m%d}-{sale_id.hex[:12].upper()}",
        total_minor=total,
        subtotal_minor=prices["subtotal_minor"],
        discount_minor=prices["discount_minor"],
        vat_minor=prices["vat_minor"],
        tax_snapshot=prices,
        cost_minor=cost,
        tendered_minor=tendered,
        receipt_profile=printing,
        customer=customer,
        **customer_snapshot,
        **{
            field: data.get(field, "Retail" if field == "customer_type" else "")
            for field in [
                "customer_type",
                "remarks",
            ]
        },
        created_at=when,
    )
    sale_items = {
        product_id: SaleItem.objects.create(tenant=scope.tenant, sale=sale, **values)
        for product_id, values in cart_items.items()
    }
    for item, batch, level, package_quantity, line_total in allocations:
        before = physical_counts(batch)
        quantity = consume_packages(batch, item, level, package_quantity)
        batch.save(update_fields=["quantity", "loose_quantity", "inner_quantity", "outer_quantity"])
        record_packages(scope, batch, before, "sale", sale.id)
        SaleLine.objects.create(
            tenant=scope.tenant,
            sale=sale,
            branch=scope.branch,
            product=item,
            batch=batch,
            name=f"{item.product.name} {item.product.strength}",
            quantity=quantity,
            unit_price_minor=line_total // quantity,
            total_minor=line_total,
            unit_cost_minor=batch.unit_cost_minor,
            item=sale_items[item.id],
            created_at=when,
        )
        StockMovement.objects.create(
            tenant=scope.tenant,
            branch=scope.branch,
            batch=batch,
            product=item,
            quantity=-quantity,
            kind="sale",
            source_id=sale.id,
            reference=sale.receipt_number,
            created_at=when,
        )
    Payment.objects.create(
        tenant=scope.tenant,
        sale=sale,
        amount_minor=total,
        created_at=when,
        method=method,
        reference=reference,
        verification="cash_received" if method == "cash" else "staff_confirmed",
    )
    audit(
        scope,
        "sale.completed",
        sale.id,
        {"receipt": sale.receipt_number, "total_minor": total,
         "discount_minor": prices["discount_minor"], "vat_minor": prices["vat_minor"],
         "payment_method": method},
    )
    return complete_operation(scope, "checkout", key, fingerprint, receipt_data(sale))


def checkout(scope, data, key, *, occurred_at=None):
    try:
        return _checkout(scope, data, key, occurred_at=occurred_at)
    except IntegrityError as exc:
        if getattr(getattr(exc.__cause__, "diag", None), "constraint_name", "") == "payment_reference_unique":
            raise BusinessError(
                "This payment reference has already been used.", "duplicate_payment"
            ) from None
        raise
