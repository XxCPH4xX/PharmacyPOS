from dataclasses import replace

from django.db import connection

from catalog.services import create_product
from core.models import Branch, Membership, Operation, Tenant
from inventory.models import Batch, StockMovement
from inventory.services import receive_batch
from sales.models import Sale
from sales.services import checkout, receipt_data


def remove(client, product, token=None, **overrides):
    path = f"/api/v1/catalog/{product.id}/remove/"
    preview = client.get(path).data if token is None else {"preview_token": token}
    return client.post(
        path,
        {
            "preview_token": preview["preview_token"],
            "confirmation": product.sku,
            "reason": "Incorrect catalog entry",
            **overrides,
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="remove-1",
    )


def test_removal_reconciles_all_branches_and_preserves_sales(
    client, scope, product, stock, cart, receive_data
):
    original = checkout(scope, cart, "sale")
    other = Branch.objects.create(tenant=scope.tenant, name="Second")
    receive_batch(replace(scope, branch=other), receive_data, "other-delivery")
    token = client.get(f"/api/v1/catalog/{product.id}/remove/").data["preview_token"]
    result = remove(client, product, token)
    assert result.status_code == 200 and result.data["quantity_removed"] == 18
    assert all(b.quantity == 0 and b.loose_quantity == 0 for b in Batch.objects.all())
    assert StockMovement.objects.filter(kind="removal").count() == 2
    assert client.get("/api/v1/catalog/").data["count"] == 0
    assert client.get("/api/v1/inventory/batches/").data["count"] == 0
    assert receipt_data(Sale.objects.get()) == original
    assert remove(client, product, token).data == result.data
    assert StockMovement.objects.filter(kind="removal").count() == 2
    with connection.cursor() as cursor:
        cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
    replacement = create_product(
        scope,
        {
            "name": "Replacement",
            "generic": "Ingredient",
            "strength": "10 mg",
            "form": "Tablets",
            "manufacturer": "Test",
            "prescription_required": False,
            "sku": product.sku,
            "barcode": product.barcode,
            "price_minor": 125,
            "reorder_level": 5,
        },
    )
    assert replacement.id != product.id


def test_remove_rejects_stale_preview_and_bad_confirmation(client, scope, product, stock, cart):
    token = client.get(f"/api/v1/catalog/{product.id}/remove/").data["preview_token"]
    checkout(scope, cart, "sale")
    assert remove(client, product, token).status_code == 409
    assert remove(client, product, confirmation="wrong").status_code == 400
    assert Batch.objects.get().quantity == 8


def test_remove_requires_owner(client, scope, product):
    Membership.objects.filter(user=scope.user).update(role="manager")
    assert client.get(f"/api/v1/catalog/{product.id}/remove/").status_code == 403
    assert client.post(f"/api/v1/catalog/{product.id}/remove/", {}, format="json").status_code == 403


def reset_body(client):
    preview = client.get("/api/v1/settings/reset/").data
    return {key: preview[key] for key in ["source_tenant_id", "branch_id", "preview_token"]} | {
        "confirmation": preview["name"],
        "password": "Safe-password-1834!",
    }


def test_workspace_reset_is_empty_archived_and_retry_safe(client, scope, product, stock, cart):
    checkout(scope, cart, "sale")
    data = reset_body(client)
    response = client.post("/api/v1/settings/reset/", data, format="json", HTTP_IDEMPOTENCY_KEY="reset-1")
    assert response.status_code == 200
    new_id = response.data["tenant"]["id"]
    assert new_id != str(scope.tenant.id)
    scope.tenant.refresh_from_db()
    assert not scope.tenant.active and scope.tenant.archived_at
    assert Tenant.objects.get(id=new_id).replaces_id == scope.tenant.id
    assert Sale.objects.filter(tenant=scope.tenant).count() == 1
    assert client.get("/api/v1/catalog/").data["count"] == 0
    assert client.get("/api/v1/sales/").data["count"] == 0
    retry = client.post("/api/v1/settings/reset/", data, format="json", HTTP_IDEMPOTENCY_KEY="reset-1")
    assert retry.status_code == 200 and retry.data["tenant"]["id"] == new_id
    assert Tenant.objects.count() == 2
    assert Operation.objects.filter(kind="workspace_reset").count() == 1


def test_reset_requires_current_password_confirmation_and_fresh_preview(client, scope, product, stock, cart):
    data = reset_body(client)
    assert (
        client.post(
            "/api/v1/settings/reset/",
            {**data, "password": "wrong"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="reset-1",
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/settings/reset/",
            {**data, "confirmation": "wrong"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="reset-1",
        ).status_code
        == 400
    )
    checkout(scope, cart, "sale")
    assert (
        client.post(
            "/api/v1/settings/reset/", data, format="json", HTTP_IDEMPOTENCY_KEY="reset-1"
        ).status_code
        == 409
    )
    assert Tenant.objects.count() == 1


def test_foreign_reset_and_remove_rejected(client, scope, product, stock):
    from django.contrib.auth import get_user_model
    from rest_framework.test import APIClient

    other_user = get_user_model().objects.create_user(
        username="other@example.test", password="Safe-password-1834!"
    )
    other_tenant = Tenant.objects.create(name="Other")
    Branch.objects.create(tenant=other_tenant, name="Other")
    Membership.objects.create(tenant=other_tenant, user=other_user, role="owner")
    other = APIClient()
    other.force_login(other_user)
    session = other.session
    session["tenant_id"] = str(other_tenant.id)
    session.save()
    data = reset_body(client)
    assert (
        other.post("/api/v1/settings/reset/", data, format="json", HTTP_IDEMPOTENCY_KEY="foreign").status_code
        == 403
    )
    assert other.get(f"/api/v1/catalog/{product.id}/remove/").status_code == 404
