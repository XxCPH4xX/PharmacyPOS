from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from django.db import IntegrityError, close_old_connections, connection, connections, transaction

from catalog.packaging import PackagingInput, configure_packaging
from catalog.views import catalog_query, product_data
from core.errors import BusinessError
from core.reporting import dashboard_data
from inventory.models import Batch, PackageMovement
from inventory.services import receive_batch
from sales.models import Sale
from sales.services import checkout


def configure(scope, product, **overrides):
    serializer = PackagingInput(
        data={
            "base_unit": "TABLET",
            "inner_name": "STRIP",
            "inner_size": 10,
            "outer_name": "BOX",
            "inners_per_outer": 10,
            "allow_break_inner": True,
            "allow_break_outer": True,
            **overrides,
        }
    )
    serializer.is_valid(raise_exception=True)
    return configure_packaging(scope, product, serializer.validated_data)


def receive(scope, product, data, name="BOX", quantity=1, **overrides):
    unit = product.units.get(name=name) if name else None
    return receive_batch(
        scope,
        {
            **data,
            "unit_id": unit.id if unit else None,
            "expected_base_units": unit.base_units if unit else 1,
            "quantity": quantity,
            **overrides,
        },
        f"receive-{name}-{overrides.get('reference', '')}",
    )


def sell(scope, product, name, quantity, key="sale"):
    unit = product.units.get(name=name) if name else None
    return checkout(
        scope,
        {
            "lines": [
                {
                    "product_id": product.id,
                    "quantity": quantity,
                    "expected_price_minor": 125,
                    "unit_id": unit.id if unit else None,
                    "expected_base_units": unit.base_units if unit else 1,
                    "expected_unit_price_minor": (
                        unit.price_minor if unit.price_minor is not None else unit.base_units * 125
                    )
                    if unit
                    else 125,
                }
            ],
            "tendered_minor": 100000,
        },
        key,
    )


def test_three_tablets_open_one_strip_and_preserve_sealed_counts(scope, product, receive_data):
    product = configure(scope, product)
    receive(scope, product, receive_data)
    result = sell(scope, product, None, 3)
    batch = Batch.objects.get()
    assert (batch.loose_quantity, batch.inner_quantity, batch.outer_quantity, batch.quantity) == (7, 9, 0, 97)
    assert result["total_minor"] == 375
    movement = PackageMovement.objects.get(kind="sale")
    assert (movement.loose_delta, movement.inner_delta, movement.outer_delta) == (7, 9, -1)
    with connection.cursor() as cursor:
        cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")


def test_two_strips_open_one_box_without_opening_strips(scope, product, receive_data):
    product = configure(scope, product)
    receive(scope, product, receive_data)
    sell(scope, product, "STRIP", 2)
    batch = Batch.objects.get()
    assert (batch.loose_quantity, batch.inner_quantity, batch.outer_quantity, batch.quantity) == (0, 8, 0, 80)


def test_loose_stock_never_counts_as_sealed_box(scope, product, receive_data):
    product = configure(scope, product)
    receive(scope, product, receive_data, name=None, quantity=200)
    data = product_data(catalog_query(scope).get(id=product.id))
    assert data["stock"] == 200 and data["base_available"] == 200
    assert all(u["available"] == 0 for u in data["units"])
    with pytest.raises(BusinessError, match="Not enough"):
        sell(scope, product, "BOX", 1)
    assert Batch.objects.get().quantity == 200


def test_sealed_box_price_and_cost_are_exact_and_historical(scope, product, receive_data):
    product = configure(scope, product, outer_price_minor=9999)
    receive(scope, product, receive_data, quantity=2)
    result = sell(scope, product, "BOX", 1)
    sale = Sale.objects.get()
    assert result["total_minor"] == 9999 and sale.cost_minor == 8000
    assert sale.lines.get().total_minor == 9999
    assert dashboard_data(scope)["top_products"][0]["revenue_minor"] == 9999
    assert Batch.objects.get().outer_quantity == 1
    with connection.cursor() as cursor:
        cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")


def test_fefo_uses_actual_packages_per_batch(scope, product, receive_data):
    product = configure(scope, product)
    receive(scope, product, receive_data, name=None, quantity=100)
    receive(
        scope,
        product,
        receive_data,
        name="STRIP",
        quantity=1,
        reference="second",
        batch_number="SECOND",
        expiry=receive_data["expiry"] + timedelta(days=10),
    )
    receive(
        scope,
        product,
        receive_data,
        name="STRIP",
        quantity=2,
        reference="third",
        batch_number="THIRD",
        expiry=receive_data["expiry"] + timedelta(days=20),
    )
    result = sell(scope, product, "STRIP", 2)
    assert [a["batch"] for a in result["lines"][0]["allocations"]] == ["SECOND", "THIRD"]
    assert Batch.objects.get(number="B-001").quantity == 100


def test_break_permission_and_structure_changes_are_enforced(scope, product, receive_data):
    product = configure(scope, product, allow_break_outer=False)
    receive(scope, product, receive_data)
    with pytest.raises(BusinessError, match="Not enough"):
        sell(scope, product, "STRIP", 1)
    with pytest.raises(BusinessError, match="Sealed packages"):
        configure(scope, product, inner_size=12)
    assert Batch.objects.get().outer_quantity == 1


def test_syrup_never_allows_strips(scope, product):
    product.product.form = "Syrups"
    product.product.save()
    with pytest.raises(BusinessError, match="Strips"):
        configure(scope, product, base_unit="BOTTLE")


def test_package_ledger_is_append_only_and_reconciled(scope, product, receive_data):
    product = configure(scope, product)
    receive(scope, product, receive_data)
    with pytest.raises(IntegrityError, match="append-only"), transaction.atomic():
        PackageMovement.objects.update(outer_delta=5)
    with pytest.raises(IntegrityError, match="Physical packages"), transaction.atomic():
        Batch.objects.update(outer_quantity=0, loose_quantity=100)
        with connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")


@pytest.mark.django_db(transaction=True)
def test_concurrent_last_strip_only_one_cashier_succeeds(scope, product, receive_data):
    product = configure(scope, product)
    receive(scope, product, receive_data, name="STRIP")
    barrier = Barrier(2)

    def attempt(i):
        close_old_connections()
        try:
            barrier.wait(timeout=5)
            return sell(scope, product, "STRIP", 1, key=f"sale-{i}")
        except BusinessError as exc:
            return exc.detail.code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, [0, 1]))
    assert sum(isinstance(r, dict) for r in results) == 1
    assert "insufficient_stock" in results
    assert Sale.objects.count() == 1 and Batch.objects.get().quantity == 0
