from django.db.models import Prefetch, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import TenantProduct
from catalog.packaging import packaging_data
from catalog.services import create_product
from core.access import scope_for
from core.serializers import ProductInput
from inventory.models import Batch
from inventory.packaging import available_packages


class Pagination(LimitOffsetPagination):
    default_limit = 50
    max_limit = 200


def catalog_query(scope):
    eligible = Q(
        batches__branch=scope.branch, batches__status="available", batches__expiry__gt=timezone.localdate()
    )
    return (
        TenantProduct.objects.filter(tenant=scope.tenant, active=True)
        .select_related("product")
        .prefetch_related(
            "units",
            Prefetch(
                "batches",
                queryset=Batch.objects.filter(
                    branch=scope.branch, status="available", expiry__gt=timezone.localdate(), quantity__gt=0
                ),
                to_attr="eligible_batches",
            ),
        )
        .annotate(stock=Coalesce(Sum("batches__quantity", filter=eligible), 0))
        .order_by("product__name")
    )


def product_data(item):
    p = item.product
    return {
        "id": str(item.id),
        "name": p.name,
        "generic": p.generic,
        "strength": p.strength,
        "form": p.form,
        "manufacturer": p.manufacturer,
        "prescription_required": p.prescription_required,
        "sku": item.sku,
        "barcode": item.barcode,
        "price_minor": item.price_minor,
        "reorder_level": item.reorder_level,
        "stock": getattr(item, "stock", 0),
        "active": item.active,
        "packaging": packaging_data(item),
        "base_available": sum(
            available_packages(b, item, "base") for b in getattr(item, "eligible_batches", [])
        ),
        "units": [
            {
                "id": str(u.id),
                "name": u.name,
                "base_units": u.base_units,
                "active": u.active,
                "price_minor": u.price_minor
                if u.price_minor is not None
                else item.price_minor * u.base_units,
                "available": sum(
                    available_packages(b, item, "inner" if u.name == item.inner_name else "outer")
                    for b in getattr(item, "eligible_batches", [])
                )
                if u.name in {item.inner_name, item.outer_name}
                else 0,
            }
            for u in item.units.all()
        ],
    }


class CatalogView(APIView):
    @extend_schema(
        responses=OpenApiTypes.OBJECT,
        parameters=[
            OpenApiParameter("search", str),
            OpenApiParameter("limit", int),
            OpenApiParameter("offset", int),
        ],
    )
    def get(self, request):
        scope = scope_for(request)
        query = catalog_query(scope)
        search = request.query_params.get("search", "").strip()[:150]
        if search:
            query = query.filter(
                Q(product__name__icontains=search)
                | Q(product__generic__icontains=search)
                | Q(barcode__icontains=search)
                | Q(sku__icontains=search)
                | Q(product__strength__icontains=search)
                | Q(product__form__icontains=search)
            )
        paginator = Pagination()
        page = paginator.paginate_queryset(query, request)
        return paginator.get_paginated_response([product_data(item) for item in page])

    @extend_schema(request=ProductInput, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        scope = scope_for(request, "manage")
        serializer = ProductInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = create_product(scope, serializer.validated_data)
        return Response(product_data(item), status=201)
