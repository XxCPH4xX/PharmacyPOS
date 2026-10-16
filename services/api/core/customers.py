import re

from django.db import IntegrityError, transaction
from django.db.models import Q
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.views import Pagination
from core.access import scope_for
from core.errors import BusinessError
from core.models import Customer
from core.operations import audit, complete_operation, lock_operation
from core.serializers import StrictSerializer


def normalize_phone(value):
    value = value.translate(str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789"))
    value = re.sub(r"[ ()-]", "", value)
    # Local and international Bangladesh mobile formats identify the same contact.
    for prefix in ("+880", "00880", "880"):
        if value.startswith(prefix) and re.fullmatch(r"1[0-9]{9}", value[len(prefix) :]):
            return "0" + value[len(prefix) :]
    return value


class CustomerInput(StrictSerializer):
    name = serializers.CharField(max_length=100)
    phone = serializers.CharField(max_length=25, allow_blank=True, default="")
    address = serializers.CharField(max_length=250, allow_blank=True, default="")
    bin = serializers.RegexField(r"^[0-9]{13}$", allow_blank=True, default="")

    def validate_phone(self, value):
        value = normalize_phone(value)
        if value and not re.fullmatch(r"\+?[0-9]{7,15}", value):
            raise serializers.ValidationError("Enter a phone number with 7 to 15 digits.")
        return value


def customer_data(customer):
    return {
        "id": str(customer.id),
        "name": customer.name,
        "phone": customer.phone,
        "address": customer.address,
        "bin": customer.bin,
    }


@transaction.atomic
def create_customer(scope, data, key):
    scope.require("sell")
    fingerprint, prior = lock_operation(scope, "customer.create", key, data)
    if prior is not None:
        return prior
    # The savepoint keeps the outer transaction usable after a duplicate phone.
    try:
        with transaction.atomic():
            customer = Customer.objects.create(tenant=scope.tenant, branch=scope.branch, **data)
    except IntegrityError as exc:
        if getattr(getattr(exc.__cause__, "diag", None), "constraint_name", "") == "customer_phone_unique":
            raise BusinessError(
                "This phone number is already saved. Find and select the existing customer.",
                "duplicate_customer",
            ) from None
        raise
    audit(scope, "customer.created", customer.id)
    return complete_operation(scope, "customer.create", key, fingerprint, customer_data(customer))


class CustomersView(APIView):
    @extend_schema(
        responses=OpenApiTypes.OBJECT,
        parameters=[
            OpenApiParameter("search", str),
            OpenApiParameter("limit", int),
            OpenApiParameter("offset", int),
        ],
    )
    def get(self, request):
        scope = scope_for(request, "sell")
        query = Customer.objects.filter(tenant=scope.tenant, branch=scope.branch)
        search = request.query_params.get("search", "").strip()[:100]
        if search:
            phone = normalize_phone(search)
            matches = Q(name__icontains=search)
            if re.fullmatch(r"\+?[0-9]+", phone):
                matches |= Q(phone__icontains=phone)
            query = query.filter(matches)
        paginator = Pagination()
        page = paginator.paginate_queryset(query.order_by("name", "id"), request)
        return paginator.get_paginated_response([customer_data(customer) for customer in page])

    @extend_schema(
        request=CustomerInput,
        responses=OpenApiTypes.OBJECT,
        parameters=[
            OpenApiParameter("Idempotency-Key", str, location=OpenApiParameter.HEADER, required=True)
        ],
    )
    def post(self, request):
        scope = scope_for(request, "sell")
        serializer = CustomerInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(
            create_customer(scope, serializer.validated_data, request.headers.get("Idempotency-Key")),
            status=201,
        )
