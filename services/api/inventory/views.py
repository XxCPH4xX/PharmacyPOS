from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.views import Pagination
from core.access import scope_for
from core.serializers import ReceiveInput
from inventory.models import Batch, StockMovement
from inventory.services import receive_batch


def batch_data(batch):
    return {
        "id": str(batch.id),
        "product_id": str(batch.product_id),
        "name": batch.product.product.name,
        "strength": batch.product.product.strength,
        "number": batch.number,
        "expiry": batch.expiry.isoformat(),
        "quantity": batch.quantity,
        "loose_quantity": batch.loose_quantity,
        "inner_quantity": batch.inner_quantity,
        "outer_quantity": batch.outer_quantity,
        "inner_name": batch.product.inner_name,
        "outer_name": batch.product.outer_name,
        "base_unit": batch.product.base_unit,
        "unit_cost_minor": batch.unit_cost_minor,
        "status": batch.status,
        "location": batch.location,
    }


class BatchesView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        scope = scope_for(request)
        query = (
            Batch.objects.filter(tenant=scope.tenant, branch=scope.branch, product__active=True)
            .select_related("product__product")
            .order_by("expiry", "number")
        )
        paginator = Pagination()
        page = paginator.paginate_queryset(query, request)
        return paginator.get_paginated_response([batch_data(batch) for batch in page])


class ReceiveView(APIView):
    @extend_schema(
        request=ReceiveInput,
        responses=OpenApiTypes.OBJECT,
        parameters=[
            OpenApiParameter("Idempotency-Key", str, location=OpenApiParameter.HEADER, required=True)
        ],
    )
    def post(self, request):
        scope = scope_for(request, "manage")
        serializer = ReceiveInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(
            receive_batch(scope, serializer.validated_data, request.headers.get("Idempotency-Key")),
            status=201,
        )


class LedgerView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        scope = scope_for(request, "report")
        query = (
            StockMovement.objects.filter(tenant=scope.tenant, branch=scope.branch)
            .select_related("batch", "product__product")
            .order_by("-created_at", "id")
        )
        paginator = Pagination()
        page = paginator.paginate_queryset(query, request)
        return paginator.get_paginated_response(
            [
                {
                    "id": str(m.id),
                    "created_at": m.created_at.isoformat(),
                    "name": m.product.product.name,
                    "batch": m.batch.number,
                    "quantity": m.quantity,
                    "kind": m.kind,
                    "reference": m.reference,
                }
                for m in page
            ]
        )
