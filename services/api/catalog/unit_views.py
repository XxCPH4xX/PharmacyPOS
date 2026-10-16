from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import TenantProduct
from catalog.packaging import PackagingInput, configure_packaging, packaging_data
from core.access import scope_for


class ProductUnitsView(APIView):
    @extend_schema(request=PackagingInput, responses=OpenApiTypes.OBJECT)
    def put(self, request, product_id):
        scope = scope_for(request, "manage")
        product = get_object_or_404(TenantProduct, id=product_id, tenant=scope.tenant)
        values = PackagingInput(data=request.data)
        values.is_valid(raise_exception=True)
        product = configure_packaging(scope, product, values.validated_data)
        return Response(packaging_data(product))
