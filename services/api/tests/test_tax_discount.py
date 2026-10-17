"""VAT and customer discount regression tests."""
from copy import deepcopy
from uuid import uuid4

import pytest

from core.errors import BusinessError
from core.tax import calculate, config_for, enforce_discount_policy
from sales.models import Sale
from sales.services import checkout

pytestmark = pytest.mark.django_db


def test_default_is_tax_disabled(scope):
    result = calculate([{"product_id": str(uuid4()), "amount_minor": 10000}], config_for(scope.tenant))
    assert (
        result["subtotal_minor"],
        result["discount_minor"],
        result["vat_minor"],
        result["total_minor"],
    ) == (10000, 0, 0, 10000)


def test_exclusive_vat_percent_discount():
    product_id = str(uuid4())
    config = {"enabled": True, "default_rate_bps": 500, "default_mode": "exclusive", "rules": []}
    result = calculate([{"product_id": product_id, "amount_minor": 100000}], config, "percent", 1000)
    assert result["discount_minor"] == 10000
    assert result["vat_minor"] == 4500
    assert result["total_minor"] == 94500


def test_inclusive_vat_fixed_discount():
    config = {"enabled": True, "default_rate_bps": 500, "default_mode": "inclusive", "rules": []}
    result = calculate([{"product_id": str(uuid4()), "amount_minor": 10500}], config, "fixed", 1000)
    assert result["discount_minor"] == 1000
    assert result["vat_minor"] == 452  # half-up(9500 * 500 / 10500)
    assert result["total_minor"] == 9500


def test_medicine_exempt_override():
    exempt, custom = str(uuid4()), str(uuid4())
    config = {
        "enabled": True,
        "default_rate_bps": 1500,
        "default_mode": "exclusive",
        "rules": [
            {"product_id": exempt, "treatment": "exempt"},
            {"product_id": custom, "treatment": "taxable", "rate_bps": 500, "mode": "exclusive"},
        ],
    }
    result = calculate(
        [{"product_id": exempt, "amount_minor": 10000}, {"product_id": custom, "amount_minor": 10000}], config
    )
    assert result["vat_minor"] == 500
    assert result["total_minor"] == 20500


def test_invalid_discount_rejected():
    for kind, value in [("fixed", 200), ("percent", 10001), ("none", 1)]:
        with pytest.raises(ValueError):
            calculate([{"product_id": str(uuid4()), "amount_minor": 100}], {}, kind, value)


def test_checkout_persists_tax_and_discount_snapshot(scope, cart, stock):
    scope.tenant.tax_config = {
        "enabled": True,
        "default_rate_bps": 500,
        "default_mode": "exclusive",
        "rules": [],
        "version": 1,
    }
    scope.tenant.save(update_fields=["tax_config"])
    data = {
        **deepcopy(cart),
        "discount_type": "fixed",
        "discount_value": 50,
        "expected_total_minor": 210,
        "tendered_minor": 300,
    }
    receipt = checkout(scope, data, "discount-tax-sale")
    assert receipt["subtotal_minor"] == 250
    assert receipt["discount_minor"] == 50
    assert receipt["vat_minor"] == 10
    assert receipt["total_minor"] == 210
    assert receipt["change_minor"] == 90
    sale = Sale.objects.get()
    assert sale.tax_snapshot["lines"][0]["rate_bps"] == 500
    assert checkout(scope, data, "discount-tax-sale") == receipt


def test_checkout_rejects_outdated_total(scope, cart, stock):
    scope.tenant.tax_config = {
        "enabled": True,
        "default_rate_bps": 500,
        "default_mode": "exclusive",
        "rules": [],
    }
    scope.tenant.save(update_fields=["tax_config"])
    with pytest.raises(BusinessError, match="Review the new total"):
        checkout(scope, {**cart, "expected_total_minor": 250}, "old-quote")
    assert not Sale.objects.exists()


def test_tax_settings_owner_can_update_and_other_tenant_rule_is_rejected(scope, client):
    url = "/api/v1/settings/tax/"
    assert client.get(url).status_code == 200
    body = {"enabled": True, "default_rate_bps": 500, "default_mode": "inclusive", "rules": [], "version": 0}
    changed = client.put(url, body, format="json")
    assert changed.status_code == 200
    assert changed.json()["version"] == 1
    assert client.put(url, body, format="json").status_code == 400
    body["version"] = 1
    body["rules"] = [{"product_id": str(uuid4()), "treatment": "exempt"}]
    assert client.put(url, body, format="json").status_code == 400


def test_workspace_default_product_discount_applies_to_new_sales(scope, cart, stock):
    scope.tenant.tax_config = {
        "enabled": False,
        "default_rate_bps": 0,
        "default_mode": "exclusive",
        "default_product_discount_bps": 1000,
        "rules": [],
        "version": 2,
    }
    scope.tenant.save(update_fields=["tax_config"])
    quote = calculate([{"product_id": str(uuid4()), "amount_minor": 250}], config_for(scope.tenant))
    assert (
        quote["discount_type"],
        quote["discount_value"],
        quote["discount_minor"],
        quote["total_minor"],
    ) == (
        "percent",
        1000,
        25,
        225,
    )
    data = {**deepcopy(cart), "expected_tax_version": 2, "expected_total_minor": 225, "tendered_minor": 300}
    receipt = checkout(scope, data, "workspace-default-discount")
    assert receipt["total_minor"] == 225
    assert receipt["discount_minor"] == 25
    assert receipt["tax_snapshot"]["discount_type"] == "percent"
    assert receipt["tax_snapshot"]["discount_value"] == 1000
    assert checkout(scope, data, "workspace-default-discount") == receipt


def test_one_sale_fixed_discount_overrides_default():
    config = {"enabled": False, "default_product_discount_bps": 1000}
    lines = [{"product_id": str(uuid4()), "amount_minor": 10000}]
    default = calculate(lines, config)
    special = calculate(lines, config, "fixed", 200)
    assert default["discount_minor"] == 1000
    assert special["discount_type"] == "fixed"
    assert special["discount_minor"] == 200
    assert calculate(lines, config)["discount_minor"] == 1000


def test_zero_default_remains_no_discount():
    result = calculate(
        [{"product_id": str(uuid4()), "amount_minor": 10000}],
        {"enabled": False, "default_product_discount_bps": 0},
    )
    assert (result["discount_type"], result["discount_minor"]) == ("none", 0)


def test_default_discount_remains_compatible_with_exclusive_vat():
    config = {
        "enabled": True,
        "default_rate_bps": 500,
        "default_mode": "exclusive",
        "default_product_discount_bps": 1000,
        "rules": [],
    }
    result = calculate([{"product_id": str(uuid4()), "amount_minor": 100000}], config)
    assert (result["discount_minor"], result["vat_minor"], result["total_minor"]) == (10000, 4500, 94500)


def test_cashier_cannot_set_custom_discount_even_when_default_is_configured():
    class CashierScope:
        def has_role(self, *roles):
            return False

    from rest_framework.exceptions import PermissionDenied

    config = {"default_product_discount_bps": 1000}
    enforce_discount_policy(CashierScope(), config, "none", 0)
    enforce_discount_policy(CashierScope(), config, "percent", 1000)
    with pytest.raises(PermissionDenied):
        enforce_discount_policy(CashierScope(), config, "percent", 10000)
    with pytest.raises(PermissionDenied):
        enforce_discount_policy(CashierScope(), config, "fixed", 500)


def test_manager_can_set_transaction_discount():
    class ManagerScope:
        def has_role(self, *roles):
            return "manager" in roles

    enforce_discount_policy(ManagerScope(), {}, "percent", 10000)
    enforce_discount_policy(ManagerScope(), {}, "fixed", 123)
