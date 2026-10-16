from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from catalog.services import create_product
from core.access import Scope
from core.models import Branch, Membership, Tenant
from inventory.services import receive_batch


@pytest.fixture(autouse=True)
def clear_cache():
    cache.clear()


@pytest.fixture(autouse=True)
def domain_test_settings(settings):
    # Authentication security tests opt back in; domain fixtures are already authenticated.
    settings.REQUIRE_PRIVILEGED_MFA = False


@pytest.fixture
def scope(db):
    user = get_user_model().objects.create_user(
        username="owner@example.test",
        email="owner@example.test",
        password="Safe-password-1834!",
        first_name="Owner",
    )
    tenant = Tenant.objects.create(name="Test Pharmacy")
    branch = Branch.objects.create(tenant=tenant, name="Main")
    Membership.objects.create(tenant=tenant, user=user, role="owner")
    return Scope(tenant, branch, user, "owner")


@pytest.fixture
def product(scope):
    return create_product(
        scope,
        {
            "name": "Test medicine",
            "generic": "Test ingredient",
            "strength": "10 mg",
            "form": "Tablets",
            "manufacturer": "Test Manufacturer",
            "prescription_required": False,
            "sku": "TEST-1",
            "barcode": "123456789",
            "price_minor": 125,
            "reorder_level": 5,
        },
    )


@pytest.fixture
def receive_data(product):
    return {
        "product_id": product.id,
        "batch_number": "B-001",
        "expiry": timezone.localdate() + timedelta(days=100),
        "quantity": 10,
        "unit_cost_minor": 80,
        "supplier": "Test Supplier",
        "reference": "GRN-001",
        "location": "A-01",
    }


@pytest.fixture
def stock(scope, receive_data):
    return receive_batch(scope, receive_data, "receive-1")


@pytest.fixture
def cart(product):
    return {
        "lines": [{"product_id": product.id, "quantity": 2, "expected_price_minor": 125}],
        "tendered_minor": 500,
    }


@pytest.fixture
def client(scope):
    client = APIClient()
    client.force_login(scope.user)
    session = client.session
    session["tenant_id"] = str(scope.tenant.id)
    session.save()
    return client
