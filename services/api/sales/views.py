import csv
import io

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import ProductUnit, TenantProduct
from catalog.views import Pagination
from core.access import scope_for
from core.operations import audit
from core.serializers import CartLineInput, CheckoutInput, StrictSerializer
from core.tax import calculate, config_for, enforce_discount_policy
from sales.models import Sale
from sales.services import checkout, receipt_data


class QuoteInput(StrictSerializer):
    lines = CartLineInput(many=True, min_length=1, max_length=100)
    discount_type = serializers.ChoiceField(choices=["none", "fixed", "percent"], default="none")
    discount_value = serializers.IntegerField(min_value=0, max_value=1000000000000, default=0)

    def validate_lines(self, lines):
        ids = [item["product_id"] for item in lines]
        if len(ids) != len(set(ids)):
            raise ValidationError("Combine duplicate medicines first.")
        return lines


class QuoteView(APIView):
    @extend_schema(request=QuoteInput, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        scope = scope_for(request, "sell")
        serializer = QuoteInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        entries = serializer.validated_data
        lines = []
        for entry in entries["lines"]:
            item = TenantProduct.objects.filter(
                id=entry["product_id"], tenant=scope.tenant, active=True
            ).first()
            if not item or item.price_minor != entry["expected_price_minor"]:
                raise ValidationError("Medicine price changed. Refresh the sale.")
            multiplier = 1
            price = item.price_minor
            if entry.get("unit_id"):
                unit = ProductUnit.objects.filter(
                    id=entry["unit_id"], product=item, tenant=scope.tenant, active=True
                ).first()
                if not unit:
                    raise ValidationError("Selling unit changed. Refresh the sale.")
                multiplier = unit.base_units
                price = unit.price_minor if unit.price_minor is not None else item.price_minor * multiplier
            if multiplier != entry.get("expected_base_units", 1) or price != entry.get(
                "expected_unit_price_minor", item.price_minor * multiplier
            ):
                raise ValidationError("Package price changed. Refresh the sale.")
            lines.append({"product_id": item.id, "amount_minor": price * entry["quantity"]})
        try:
            configuration = config_for(scope.tenant)
            enforce_discount_policy(scope, configuration, entries["discount_type"], entries["discount_value"])
            result = calculate(lines, configuration, entries["discount_type"], entries["discount_value"])
            result["settings_version"] = configuration["version"]
        except ValueError as exc:
            raise ValidationError(str(exc)) from None
        return Response(result)


class CheckoutView(APIView):
    @extend_schema(
        request=CheckoutInput,
        responses=OpenApiTypes.OBJECT,
        parameters=[
            OpenApiParameter("Idempotency-Key", str, location=OpenApiParameter.HEADER, required=True)
        ],
    )
    def post(self, request):
        scope = scope_for(request, "sell")
        serializer = CheckoutInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(
            checkout(scope, serializer.validated_data, request.headers.get("Idempotency-Key")), status=201
        )


def visible_sales(scope):
    query = Sale.objects.filter(tenant=scope.tenant, branch=scope.branch).select_related(
        "branch", "tenant", "cashier", "payment"
    )
    if not scope.has_role("owner", "manager", "auditor", "accountant"):
        query = query.filter(cashier=scope.user)
    return query.order_by("-created_at", "id")


class SalesView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT, operation_id="sales_list")
    def get(self, request):
        scope = scope_for(request, "sales_read")
        paginator = Pagination()
        page = paginator.paginate_queryset(visible_sales(scope), request)
        return paginator.get_paginated_response(
            [
                {
                    "id": str(s.id),
                    "receipt_number": s.receipt_number,
                    "created_at": s.created_at.isoformat(),
                    "cashier": s.cashier.first_name,
                    "total_minor": s.total_minor,
                    "subtotal_minor": s.subtotal_minor or (s.total_minor if not s.tax_snapshot else 0),
                    "discount_minor": s.discount_minor,
                    "vat_minor": s.vat_minor,
                    "payment_method": s.payment.method,
                    "status": "completed",
                }
                for s in page
            ]
        )


class ReceiptView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT, operation_id="sales_receipt")
    def get(self, request, sale_id):
        scope = scope_for(request, "sales_read")
        sale = get_object_or_404(visible_sales(scope), id=sale_id)
        return Response(receipt_data(sale))


def csv_safe(value):
    value = str(value)
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r", "\n")) else value


class SalesExportView(APIView):
    @extend_schema(responses={(200, "text/csv"): OpenApiTypes.BINARY})
    def get(self, request):
        scope = scope_for(request, "report")
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "Receipt",
                "Created (UTC)",
                "Branch",
                "Cashier",
                "Revenue (paisa)",
                "COGS (paisa)",
                "Payment",
                "Subtotal (paisa)",
                "Discount (paisa)",
                "VAT (paisa)",
            ]
        )
        for sale in visible_sales(scope).iterator(chunk_size=500):
            writer.writerow(
                [
                    sale.receipt_number,
                    sale.created_at.isoformat(),
                    csv_safe(scope.branch.name),
                    csv_safe(sale.cashier.first_name),
                    sale.total_minor,
                    sale.cost_minor,
                    sale.payment.method,
                    sale.subtotal_minor or (sale.total_minor if not sale.tax_snapshot else 0),
                    sale.discount_minor,
                    sale.vat_minor,
                ]
            )
        audit(scope, "report.sales_exported", scope.branch.id)
        response = HttpResponse("\ufeff" + output.getvalue(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="pharmacore-sales.csv"'
        return response
