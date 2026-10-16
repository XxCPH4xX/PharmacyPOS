from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import uuid4

import pytest
from django.db import IntegrityError, close_old_connections, connection, connections, transaction
from django.db.models import Sum
from django.utils import timezone

from core.errors import BusinessError
from core.models import AuditEvent, Branch, Operation, Tenant
from inventory.models import Batch, GoodsReceipt, StockMovement
from inventory.services import receive_batch
from sales.models import Payment, Sale
from sales.services import checkout

pytestmark = pytest.mark.django_db


def test_receiving_and_replay(scope, receive_data):
    first = receive_batch(scope, receive_data, "key")
    assert receive_batch(scope, receive_data, "key") == first
    assert Batch.objects.get().quantity == 10
    assert StockMovement.objects.get().quantity == 10
    assert GoodsReceipt.objects.count() == 1
    assert AuditEvent.objects.filter(action="inventory.received").count() == 1


def test_replay_different_payload_and_reference(scope, receive_data, stock):
    with pytest.raises(BusinessError, match="different input"):
        receive_batch(scope, {**receive_data, "quantity": 100}, "receive-1")
    with pytest.raises(BusinessError, match="already been received"):
        receive_batch(scope, receive_data, "new-key")
    assert Batch.objects.get().quantity == 10


def test_expired_receiving_rejected(scope, receive_data):
    with pytest.raises(BusinessError, match="expire after today"):
        receive_batch(scope, {**receive_data, "expiry": timezone.localdate()}, "bad")
    assert not GoodsReceipt.objects.exists()


def test_cash_sale_reconciles_and_replay(scope, cart, stock):
    result = checkout(scope, cart, "sale-key")
    assert result["total_minor"] == 250
    assert result["change_minor"] == 250
    assert Batch.objects.get().quantity == 8
    assert Payment.objects.get().amount_minor == 250
    assert Sale.objects.get().cost_minor == 160
    assert StockMovement.objects.aggregate(n=Sum("quantity"))["n"] == 8
    assert checkout(scope, cart, "sale-key") == result
    assert Sale.objects.count() == 1


def test_fefo_splits_across_batches(scope, receive_data, cart, stock):
    receive_batch(
        scope,
        {
            **receive_data,
            "batch_number": "EARLY",
            "expiry": timezone.localdate() + timedelta(days=5),
            "reference": "SECOND",
            "quantity": 1,
        },
        "second",
    )
    result = checkout(scope, cart, "sale")
    assert [allocation["batch"] for allocation in result["lines"][0]["allocations"]] == ["EARLY", "B-001"]
    assert [allocation["base_quantity"] for allocation in result["lines"][0]["allocations"]] == [1, 1]
    assert result["lines"][0]["quantity"] == 2


@pytest.mark.parametrize(
    "change, message", [({"quantity": 11}, "Not enough"), ({"expected_price_minor": 1}, "has changed")]
)
def test_failed_sale_rolls_back(scope, cart, stock, change, message):
    cart["lines"][0].update(change)
    with pytest.raises(BusinessError, match=message):
        checkout(scope, cart, "failed")
    assert not Sale.objects.exists()
    assert not Payment.objects.exists()
    assert not Operation.objects.filter(kind="checkout").exists()
    assert Batch.objects.get().quantity == 10


def test_insufficient_cash_rolls_back(scope, cart, stock):
    with pytest.raises(BusinessError, match="Cash received"):
        checkout(scope, {**cart, "tendered_minor": 249}, "failed")
    assert not Sale.objects.exists()
    assert Batch.objects.get().quantity == 10


@pytest.mark.parametrize("status", ["quarantined", "recalled", "expired"])
def test_blocked_batches(scope, cart, stock, status):
    if status == "expired":
        Batch.objects.update(expiry=timezone.localdate())
    else:
        Batch.objects.update(status=status)
    with pytest.raises(BusinessError, match="Not enough"):
        checkout(scope, cart, "blocked")


def test_prescription_required(scope, product, cart, stock):
    product.product.prescription_required = True
    product.product.save()
    with pytest.raises(BusinessError, match="requires prescription"):
        checkout(scope, cart, "rx")
    assert Batch.objects.get().quantity == 10


def test_cross_tenant_product_is_rejected(scope, cart, stock):
    foreign = Tenant.objects.create(name="Other")
    other_branch = Branch.objects.create(tenant=foreign, name="Other")
    from core.access import Scope

    with pytest.raises(BusinessError, match="not found"):
        checkout(Scope(foreign, other_branch, scope.user, "owner"), cart, "foreign")


def test_database_cross_tenant_fk(scope, product):
    foreign = Tenant.objects.create(name="Other")
    with pytest.raises(IntegrityError), transaction.atomic():
        Batch.objects.create(
            tenant=foreign,
            branch=scope.branch,
            product=product,
            number="BAD",
            expiry=timezone.localdate() + timedelta(days=30),
            quantity=0,
            unit_cost_minor=80,
        )


def test_evidence_is_immutable(scope, cart, stock):
    checkout(scope, cart, "posted")
    for model in [Sale, Payment, StockMovement, AuditEvent, Operation, GoodsReceipt]:
        with pytest.raises(IntegrityError, match="append-only"), transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(f"DELETE FROM {model._meta.db_table}")


def test_balance_cannot_be_edited_directly(scope, stock):
    with pytest.raises(IntegrityError, match="does not match ledger|batch_physical_quantity_balanced"), transaction.atomic():
        Batch.objects.update(quantity=999)
        with connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")


def test_sale_cannot_exist_without_lines_and_payment(scope):
    with pytest.raises(IntegrityError, match="do not reconcile"), transaction.atomic():
        Sale.objects.create(
            tenant=scope.tenant,
            branch=scope.branch,
            cashier=scope.user,
            receipt_number="BAD",
            total_minor=10,
            cost_minor=1,
            tendered_minor=10,
        )
        with connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("same_key", [False, True])
def test_concurrent_checkout_cannot_oversell_or_duplicate(scope, cart, stock, same_key):
    cart["lines"][0]["quantity"] = 10
    cart["tendered_minor"] = 1250
    barrier = Barrier(2)

    def attempt(index):
        close_old_connections()
        try:
            barrier.wait(timeout=5)
            return checkout(scope, cart, "same" if same_key else f"sale-{index}")
        except BusinessError as exc:
            return exc.detail.code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(attempt, [0, 1]))
    assert Sale.objects.count() == 1
    assert Batch.objects.get().quantity == 0
    if same_key:
        assert results[0] == results[1]
    else:
        assert sum(isinstance(r, dict) for r in results) == 1
        assert "insufficient_stock" in results


def test_checkout_requires_idempotency_key(client, cart, stock):
    response = client.post("/api/v1/sales/checkout/", cart, format="json")
    assert response.status_code == 400
    assert response.data["error"]["code"] == "idempotency_required"


def test_invalid_uuid_returns_validation(client):
    response = client.post(
        "/api/v1/sales/checkout/",
        {"lines": [{"product_id": "bad", "quantity": 1, "expected_price_minor": 1}], "tendered_minor": 1},
        format="json",
        HTTP_IDEMPOTENCY_KEY=str(uuid4()),
    )
    assert response.status_code == 400
