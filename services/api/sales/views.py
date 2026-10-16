import csv
import io

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.views import Pagination
from core.access import scope_for
from core.operations import audit
from core.serializers import CheckoutInput
from sales.models import Sale
from sales.services import checkout, receipt_data


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
            ["Receipt", "Created (UTC)", "Branch", "Cashier", "Revenue (paisa)", "COGS (paisa)", "Payment"]
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
                ]
            )
        audit(scope, "report.sales_exported", scope.branch.id)
        response = HttpResponse("\ufeff" + output.getvalue(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="pharmacore-sales.csv"'
        return response
