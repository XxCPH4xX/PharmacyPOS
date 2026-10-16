import pytest
from django.db.models import Sum
from rest_framework.test import APIClient

from core.models import Branch, Membership, Tenant
from sales.models import Sale
from sales.services import checkout
from sales.views import csv_safe

pytestmark = pytest.mark.django_db


def test_anonymous_cannot_read_operational_records():
    client = APIClient()
    for path in [
        "catalog",
        "dashboard",
        "inventory/batches",
        "inventory/ledger",
        "sales",
        "sales/export",
        "audit",
    ]:
        assert client.get(f"/api/v1/{path}/").status_code == 403


def test_csrf_required_for_login_and_registration():
    client = APIClient(enforce_csrf_checks=True)
    for path in ["login", "register", "demo"]:
        assert client.post(f"/api/v1/auth/{path}/", {}, format="json").status_code == 403


def test_registration_login_logout_and_session():
    client = APIClient(enforce_csrf_checks=True)
    token = client.get("/api/v1/auth/session/").data["csrf_token"]
    body = {
        "email": "new@example.test",
        "password": "Very-safe-password-1783!",
        "name": "New Owner",
        "organization": "New Pharmacy",
        "branch": "Main",
    }
    response = client.post("/api/v1/auth/register/", body, format="json", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 201
    assert response.data["authenticated"] is True
    token = response.data["csrf_token"]
    assert client.post("/api/v1/auth/logout/", HTTP_X_CSRFTOKEN=token).status_code == 204
    token = client.get("/api/v1/auth/session/").data["csrf_token"]
    response = client.post(
        "/api/v1/auth/login/",
        {"email": body["email"], "password": body["password"]},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 200
    assert response.data["tenant"]["name"] == "New Pharmacy"


def test_weak_password_does_not_create_organization():
    client = APIClient()
    response = client.post(
        "/api/v1/auth/register/",
        {
            "email": "weak@example.test",
            "password": "123",
            "name": "Test",
            "organization": "Bad",
            "branch": "Main",
        },
        format="json",
    )
    assert response.status_code == 400
    assert not Tenant.objects.filter(name="Bad").exists()


def test_cross_tenant_and_invalid_branch_headers(client, scope, product, stock):
    tenant = Tenant.objects.create(name="Other")
    branch = Branch.objects.create(tenant=tenant, name="Secret")
    for branch_id in [str(branch.id), "invalid"]:
        for path in ["catalog", "dashboard", "inventory/batches", "inventory/ledger", "sales", "audit"]:
            assert client.get(f"/api/v1/{path}/", HTTP_X_BRANCH_ID=branch_id).status_code == 404
    assert client.get("/api/v1/catalog/").data["count"] == 1


def test_branch_scoped_cashier_permissions(client, scope, cart, stock):
    membership = Membership.objects.get(user=scope.user)
    membership.role = "cashier"
    membership.branch = scope.branch
    membership.save()
    other = Branch.objects.create(tenant=scope.tenant, name="Other")
    assert client.get("/api/v1/catalog/", HTTP_X_BRANCH_ID=str(other.id)).status_code == 404
    assert client.get("/api/v1/dashboard/").status_code == 403
    assert client.get("/api/v1/sales/export/").status_code == 403
    assert client.post("/api/v1/catalog/", {}, format="json").status_code == 403
    assert client.post("/api/v1/branches/", {"name": "Unauthorized"}, format="json").status_code == 403
    assert (
        client.post(
            "/api/v1/sales/checkout/", cart, format="json", HTTP_IDEMPOTENCY_KEY="cashier"
        ).status_code
        == 201
    )


def test_auditor_cannot_sell(client, scope, cart, stock):
    Membership.objects.filter(user=scope.user).update(role="auditor")
    assert client.get("/api/v1/dashboard/").status_code == 200
    assert (
        client.post("/api/v1/sales/checkout/", cart, format="json", HTTP_IDEMPOTENCY_KEY="audit").status_code
        == 403
    )


def test_suspension_revokes_access(client, scope):
    scope.tenant.active = False
    scope.tenant.save()
    assert client.get("/api/v1/catalog/").status_code == 403


@pytest.mark.parametrize(
    "change", [{"quantity": 0}, {"quantity": -1}, {"quantity": 1.5}, {"quantity": 10001}, {"price_minor": 1}]
)
def test_malformed_cart_is_rejected(client, cart, stock, change):
    cart["lines"][0].update(change)
    assert (
        client.post("/api/v1/sales/checkout/", cart, format="json", HTTP_IDEMPOTENCY_KEY="bad").status_code
        == 400
    )
    assert not Sale.objects.exists()


def test_duplicate_lines_are_rejected(client, cart, stock):
    cart["lines"].append(dict(cart["lines"][0]))
    assert (
        client.post("/api/v1/sales/checkout/", cart, format="json", HTTP_IDEMPOTENCY_KEY="bad").status_code
        == 400
    )


def test_reports_reconcile_and_export(client, scope, cart, stock):
    result = checkout(scope, cart, "sale")
    dashboard = client.get("/api/v1/dashboard/").data
    assert dashboard["today_revenue_minor"] == Sale.objects.aggregate(n=Sum("total_minor"))["n"] == 250
    assert dashboard["stock_units"] == 8
    assert dashboard["cost_minor"] == 160
    assert client.get(f"/api/v1/sales/{result['id']}/").data["total_minor"] == 250
    export = client.get("/api/v1/sales/export/")
    assert export.status_code == 200
    assert result["receipt_number"] in export.content.decode()
    assert csv_safe("=HYPERLINK(1)").startswith("'")
    assert csv_safe(" +SUM(1)").startswith("'")


def test_receipt_other_tenant_is_hidden(client, scope, cart, stock):
    sale = checkout(scope, cart, "sale")
    tenant = Tenant.objects.create(name="Other")
    Branch.objects.create(tenant=tenant, name="Other")
    Membership.objects.create(tenant=tenant, user=scope.user, role="owner")
    session = client.session
    session["tenant_id"] = str(tenant.id)
    session.save()
    assert client.get(f"/api/v1/sales/{sale['id']}/").status_code == 404
    assert client.get("/api/v1/catalog/").data["count"] == 0


def test_login_throttles_guesses():
    client = APIClient()
    for _ in range(10):
        assert (
            client.post(
                "/api/v1/auth/login/", {"email": "nobody@example.test", "password": "wrong"}, format="json"
            ).status_code
            == 403
        )
    assert (
        client.post(
            "/api/v1/auth/login/", {"email": "nobody@example.test", "password": "wrong"}, format="json"
        ).status_code
        == 429
    )


def test_demo_disabled_outside_debug(settings):
    settings.DEBUG = False
    assert APIClient().post("/api/v1/auth/demo/").status_code == 404
