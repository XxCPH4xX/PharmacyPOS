import base64
import io

import pytest
from django.db import IntegrityError, connection, transaction
from PIL import Image

from catalog.models import ProductUnit
from catalog.packaging import PackagingInput, configure_packaging
from core.errors import BusinessError
from core.models import ReceiptProfile
from core.receipts import DEFAULT_PROFILE, amount_words
from inventory.models import Batch
from inventory.services import receive_batch
from sales.models import Payment, Sale, SaleItem
from sales.services import checkout, receipt_data


def configure_box(scope, product, size):
    config = PackagingInput(data={"base_unit": "TABLET", "outer_name": "BOX", "inners_per_outer": size})
    config.is_valid(raise_exception=True)
    configure_packaging(scope, product, config.validated_data)
    return product.units.get(name="BOX")


def test_two_boxes_convert_to_base_stock_and_keep_snapshot(scope, product, receive_data, cart):
    unit = configure_box(scope, product, 4)
    receive_batch(
        scope, {**receive_data, "quantity": 2, "unit_id": unit.id, "expected_base_units": 4}, "sealed"
    )
    receive_batch(scope, {**receive_data, "quantity": 2, "reference": "loose"}, "loose")
    cart["lines"][0].update(unit_id=unit.id, expected_base_units=4)
    cart["tendered_minor"] = 1000
    result = checkout(scope, cart, "boxes")
    assert result["total_minor"] == 1000
    assert result["lines"][0]["quantity"] == 2
    assert result["lines"][0]["unit_name"] == "BOX"
    assert result["lines"][0]["unit_price_minor"] == 500
    assert Batch.objects.get().quantity == 2
    assert Sale.objects.get().lines.get().quantity == 8
    unit.base_units = 5
    unit.save()
    assert receipt_data(Sale.objects.get())["lines"][0]["base_units"] == 4
    assert checkout(scope, cart, "boxes") == result


def test_pack_conversion_change_rejects_sale(scope, product, stock, cart):
    unit = configure_box(scope, product, 4)
    cart["lines"][0].update(unit_id=unit.id, expected_base_units=5)
    with pytest.raises(BusinessError, match="package size changed"):
        checkout(scope, cart, "changed")
    assert Batch.objects.get().quantity == 10


def test_box_cannot_bypass_insufficient_stock(scope, product, stock, cart):
    unit = configure_box(scope, product, 6)
    cart["lines"][0].update(unit_id=unit.id, expected_base_units=6)
    with pytest.raises(BusinessError, match="Not enough"):
        checkout(scope, cart, "insufficient-boxes")
    assert Batch.objects.get().quantity == 10


@pytest.mark.parametrize("method", ["bkash", "nagad"])
def test_mobile_payment_record_requires_reference_and_confirmation(scope, stock, cart, method):
    cart.update(payment_method=method)
    with pytest.raises(BusinessError, match="Verify the payment"):
        checkout(scope, cart, "unconfirmed")
    cart.update(payment_reference="TEST-TXN-001", payment_confirmed=True)
    result = checkout(scope, cart, "confirmed")
    assert result["payment_method"] == method
    assert result["payment_verification"] == "staff_confirmed"
    assert result["change_minor"] == 0
    assert Payment.objects.get().reference == "TEST-TXN-001"
    assert checkout(scope, cart, "confirmed") == result
    with pytest.raises(BusinessError, match="already been used"):
        checkout(scope, cart, "different-key")
    assert Sale.objects.count() == 1
    assert Batch.objects.get().quantity == 8


def test_settings_snapshot_and_customer_invoice(scope, stock, cart):
    profile = ReceiptProfile.objects.create(
        tenant=scope.tenant, data={**DEFAULT_PROFILE, "shop_name": "Original Pharmacy", "qr_enabled": False}
    )
    cart.update(
        customer_name="Test Customer",
        customer_phone="01700000000",
        customer_type="Collection",
        remarks="Sample",
    )
    result = checkout(scope, cart, "snapshot")
    profile.data["shop_name"] = "Changed Pharmacy"
    profile.save()
    reprint = receipt_data(Sale.objects.get())
    assert reprint["receipt_profile"]["shop_name"] == "Original Pharmacy"
    assert reprint["receipt_profile"]["qr_data_url"] == ""
    assert reprint["customer_name"] == "Test Customer"
    assert result["amount_in_words"] == "Two Taka and Fifty Paisa Only"


def test_print_settings_version_logo_validation_and_qr(client):
    profile = client.get("/api/v1/settings/printing/").data
    profile.pop("qr_data_url")
    profile["logo_data_url"] = "data:image/svg+xml;base64,PHN2Zz4="
    assert client.put("/api/v1/settings/printing/", profile, format="json").status_code == 400
    output = io.BytesIO()
    Image.new("RGB", (32, 32), "teal").save(output, format="PNG")
    profile["logo_data_url"] = "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()
    profile.update(qr_enabled=True, qr_value="")
    assert client.put("/api/v1/settings/printing/", profile, format="json").status_code == 400
    profile["qr_value"] = "TEST-MERCHANT-PAYLOAD"
    result = client.put("/api/v1/settings/printing/", profile, format="json")
    assert result.status_code == 200
    assert result.data["qr_data_url"].startswith("data:image/svg+xml;base64,")
    assert result.data["version"] == 1
    assert client.put("/api/v1/settings/printing/", profile, format="json").status_code == 409


def test_only_owner_can_change_print_settings(client, scope):
    from core.models import Membership

    Membership.objects.filter(user=scope.user).update(role="manager")
    assert client.get("/api/v1/settings/printing/").status_code == 200
    assert client.put("/api/v1/settings/printing/", {}, format="json").status_code == 403


def test_sale_item_evidence_is_immutable(scope, stock, cart):
    checkout(scope, cart, "posted-item")
    with pytest.raises(IntegrityError, match="append-only"), transaction.atomic():
        SaleItem.objects.update(base_units=999)


def test_unit_foreign_tenant_blocked_by_database(scope, product):
    from core.models import Tenant

    foreign = Tenant.objects.create(name="Foreign")
    with pytest.raises(IntegrityError), transaction.atomic():
        ProductUnit.objects.create(tenant=foreign, product=product, name="BOX", base_units=2)
        with connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")


@pytest.mark.parametrize(
    ("minor", "words"),
    [
        (0, "Zero Taka Only"),
        (108650, "One Thousand Eighty Six Taka and Fifty Paisa Only"),
        (10000000, "One Lakh Taka Only"),
    ],
)
def test_bdt_amount_in_words(minor, words):
    assert amount_words(minor) == words


def test_legacy_pending_checkout_body_retains_idempotency(client, scope, stock, cart):
    result = checkout(scope, cart, "legacy-pending")
    response = client.post(
        "/api/v1/sales/checkout/", cart, format="json", HTTP_IDEMPOTENCY_KEY="legacy-pending"
    )
    assert response.status_code == 201
    assert response.data == result
    assert Sale.objects.count() == 1


@pytest.mark.parametrize("role", ["pharmacist", "inventory"])
def test_non_sales_roles_cannot_read_customer_receipts(client, scope, stock, cart, role):
    from core.models import Membership

    result = checkout(scope, cart, "private-customer")
    Membership.objects.filter(user=scope.user).update(role=role)
    assert client.get("/api/v1/catalog/").status_code == 200
    assert client.get("/api/v1/sales/").status_code == 403
    assert client.get(f"/api/v1/sales/{result['id']}/").status_code == 403


def test_combined_roles_retain_both_permissions(scope):
    from dataclasses import replace

    combined = replace(scope, role="inventory", roles=frozenset({"inventory", "cashier"}))
    combined.require("manage")
    combined.require("sell")


def test_printed_names_are_editable_snapshots_without_changing_audit_actor(scope, product, stock, cart):
    from core.models import AuditEvent

    ReceiptProfile.objects.create(
        tenant=scope.tenant,
        data={**DEFAULT_PROFILE, "default_staff_name": "Counter staff", "default_created_by": "Prepared by"},
    )
    cart.update(staff_name="Display Staff", created_by="Display Creator")
    result = checkout(scope, cart, "printed-names")
    assert result["staff_name"] == "Display Staff"
    assert result["created_by"] == "Display Creator"
    assert result["cashier"] == "Owner"
    assert result["lines"][0]["sku"] == product.sku
    assert Sale.objects.get().cashier_id == scope.user.id
    assert AuditEvent.objects.get(action="sale.completed").actor_id == scope.user.id
    ReceiptProfile.objects.filter(tenant=scope.tenant).update(data=DEFAULT_PROFILE)
    assert receipt_data(Sale.objects.get())["staff_name"] == "Display Staff"


def test_print_names_use_configured_defaults(scope, stock, cart):
    ReceiptProfile.objects.create(
        tenant=scope.tenant,
        data={**DEFAULT_PROFILE, "default_staff_name": "Shop staff", "default_created_by": "Shop creator"},
    )
    result = checkout(scope, cart, "default-names")
    assert result["staff_name"] == "Shop staff"
    assert result["created_by"] == "Shop creator"
