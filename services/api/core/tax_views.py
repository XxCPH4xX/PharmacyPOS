from django.db import transaction
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import TenantProduct
from core.access import scope_for
from core.models import Tenant
from core.operations import audit
from core.tax import TaxConfigInput, config_for


class TaxSettingsView(APIView):
    def get(self, request):
        scope = scope_for(request, "read")
        return Response(config_for(scope.tenant))

    @transaction.atomic
    def put(self, request):
        scope = scope_for(request, "owner")
        serializer = TaxConfigInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data
        tenant = Tenant.objects.select_for_update().get(pk=scope.tenant.pk)
        previous = config_for(tenant)
        if payload["version"] != previous["version"]:
            raise ValidationError({"version": "Settings changed. Reload before saving."})
        ids = {r["product_id"] for r in payload["rules"]}
        if TenantProduct.objects.filter(id__in=ids, tenant=tenant, active=True).count() != len(ids):
            raise ValidationError({"rules": "One or more medicines are invalid or not part of this workspace."})
        updated = {**payload, "rules": [{**r, "product_id": str(r["product_id"])} for r in payload["rules"]],
                   "version": previous["version"] + 1}
        tenant.tax_config = updated
        tenant.save(update_fields=["tax_config"])
        audit(scope, "tax.settings_updated", tenant.id, {"before": previous, "after": updated})
        return Response(updated)
