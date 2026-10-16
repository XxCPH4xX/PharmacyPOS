from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from core.access import scope_for
from core.auth_views import session_data
from core.errors import BusinessError
from core.models import Branch, Membership, Tenant
from core.operations import audit
from core.serializers import StrictSerializer


class WorkspaceInput(StrictSerializer):
    name = serializers.CharField(max_length=150)
    version = serializers.IntegerField(min_value=1)


class BranchEditInput(WorkspaceInput):
    name = serializers.CharField(max_length=120)
    address = serializers.CharField(max_length=250, allow_blank=True)


class WorkspaceSettingsView(APIView):
    @extend_schema(request=WorkspaceInput, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def patch(self, request, branch_id=None):
        scope = scope_for(request, "owner")
        if not Membership.objects.filter(
            tenant=scope.tenant, user=scope.user, role="owner", branch__isnull=True, active=True
        ).exists():
            raise PermissionDenied("An organization owner is required.")
        serializer = (BranchEditInput if branch_id else WorkspaceInput)(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        obj = (
            get_object_or_404(
                Branch.objects.select_for_update(), tenant=scope.tenant, id=branch_id, active=True
            )
            if branch_id
            else Tenant.objects.select_for_update().get(id=scope.tenant.id)
        )
        if obj.version != data.pop("version"):
            raise BusinessError("These settings changed. Refresh before editing again.", "settings_changed")
        before = {key: getattr(obj, key) for key in data}
        for key, value in data.items():
            setattr(obj, key, value)
        obj.version += 1
        obj.save()
        audit(
            scope,
            "branch.updated" if branch_id else "workspace.updated",
            obj.id,
            {"before": before, "after": data},
        )
        return Response(session_data(request))
