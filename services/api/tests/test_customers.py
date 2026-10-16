import pytest
from django.db import IntegrityError, transaction

from core.models import AuditEvent, Branch, Customer, Membership, Tenant
from inventory.models import Batch
from sales.models import Sale
from sales.services import receipt_data


def save_customer(client, key="customer-1", **overrides):
    return client.post(
        "/api/v1/customers/",
        {"name": "Sample Customer", "phone": "+880 1700-000000", "address": "Dhaka", **overrides},
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )


def test_save_customer_retry_search_and_duplicate_phone(client, scope):
    first = save_customer(client)
    assert first.status_code == 201
    assert first.data["phone"] == "01700000000"
    assert save_customer(client).data == first.data
    assert Customer.objects.count() == 1
    assert AuditEvent.objects.filter(action="customer.created").count() == 1
    for search in ["sample", "01700000000", "+8801700000000", "০১৭০০০০০০০০"]:
        page = client.get("/api/v1/customers/", {"search": search}).data
        assert page["results"] == [first.data]
    assert client.get("/api/v1/customers/", {"search": "unknown"}).data["count"] == 0
    duplicate = save_customer(client, key="customer-2", phone="01700000000")
    assert duplicate.status_code == 409
    assert duplicate.data["error"]["code"] == "duplicate_customer"
    assert save_customer(client, name="Changed input").status_code == 409


def test_customer_list_paginates_on_server(client, scope):
    for i in range(23):
        Customer.objects.create(tenant=scope.tenant, branch=scope.branch, name=f"Customer {i:02}")
    first = client.get("/api/v1/customers/", {"limit": 20}).data
    second = client.get("/api/v1/customers/", {"limit": 20, "offset": 20}).data
    assert first["count"] == second["count"] == 23
    assert len(first["results"]) == 20
    assert len(second["results"]) == 3
    assert not {c["id"] for c in first["results"]}.intersection(c["id"] for c in second["results"])


@pytest.mark.parametrize("foreign_tenant", [False, True])
def test_customer_branch_and_tenant_scope(client, scope, stock, cart, foreign_tenant):
    tenant = Tenant.objects.create(name="Other") if foreign_tenant else scope.tenant
    other_branch = Branch.objects.create(tenant=tenant, name="Other")
    customer = Customer.objects.create(tenant=tenant, branch=other_branch, name="Private")
    assert client.get("/api/v1/customers/").data["count"] == 0
    result = client.post(
        "/api/v1/sales/checkout/",
        {**cart, "customer_id": str(customer.id)},
        format="json",
        HTTP_IDEMPOTENCY_KEY="wrong-customer",
    )
    assert result.status_code == 404
    assert not Sale.objects.exists()
    assert Batch.objects.get().quantity == 10
    with pytest.raises(IntegrityError), transaction.atomic():
        Customer.objects.create(tenant=Tenant.objects.create(name="Invalid"), branch=scope.branch, name="No")


@pytest.mark.parametrize("role", ["auditor", "pharmacist", "inventory", "accountant"])
def test_non_selling_roles_cannot_access_customer_directory(client, scope, role):
    Membership.objects.filter(user=scope.user).update(role=role)
    assert client.get("/api/v1/customers/").status_code == 403
    assert save_customer(client).status_code == 403


def test_cashier_customer_selection_is_server_resolved_and_receipt_is_snapshot(client, scope, stock, cart):
    Membership.objects.filter(user=scope.user).update(role="cashier", branch=scope.branch)
    customer = save_customer(client).data
    body = {**cart, "customer_id": customer["id"], "customer_name": "Untrusted name"}
    result = client.post(
        "/api/v1/sales/checkout/", body, format="json", HTTP_IDEMPOTENCY_KEY="saved-customer-sale"
    )
    assert result.status_code == 201
    assert result.data["customer_id"] == customer["id"]
    assert result.data["customer_name"] == "Sample Customer"
    assert result.data["customer_phone"] == "01700000000"
    Customer.objects.filter(id=customer["id"]).update(name="Updated later", phone="01800000000")
    assert receipt_data(Sale.objects.get())["customer_name"] == "Sample Customer"
    retry = client.post(
        "/api/v1/sales/checkout/", body, format="json", HTTP_IDEMPOTENCY_KEY="saved-customer-sale"
    )
    assert retry.data == result.data
    assert Sale.objects.count() == 1


@pytest.mark.parametrize("overrides", [{"name": " "}, {"phone": "call me"}, {"bin": "123"}])
def test_customer_validation(client, overrides):
    assert save_customer(client, **overrides).status_code == 400
    assert not Customer.objects.exists()


def test_phone_optional_with_retry_without_duplicates(client):
    first = save_customer(client, phone="")
    assert first.status_code == 201
    assert save_customer(client, phone="").data == first.data
    assert Customer.objects.count() == 1
