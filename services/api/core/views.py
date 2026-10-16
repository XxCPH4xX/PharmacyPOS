from django.db import connection, transaction
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.views import Pagination
from core.access import scope_for
from core.auth_views import session_data
from core.models import AuditEvent, Branch, Membership
from core.operations import audit
from core.reporting import dashboard_data
from core.serializers import BranchInput


class HealthView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(responses=OpenApiTypes.OBJECT, auth=[])
    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        return Response({"status": "ok", "version": "0.1.0"})


class DashboardView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(dashboard_data(scope_for(request, "report")))


class BranchView(APIView):
    @extend_schema(request=BranchInput, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def post(self, request):
        scope = scope_for(request, "owner")
        if not Membership.objects.filter(
            tenant=scope.tenant, user=scope.user, role="owner", branch__isnull=True, active=True
        ).exists():
            raise PermissionDenied("An organization owner is required.")
        serializer = BranchInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        branch = Branch.objects.create(tenant=scope.tenant, **serializer.validated_data)
        audit(scope, "branch.created", branch.id)
        return Response(session_data(request), status=201)


class AuditView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        scope = scope_for(request, "report")
        query = (
            AuditEvent.objects.filter(tenant=scope.tenant, branch=scope.branch)
            .select_related("actor")
            .order_by("-created_at", "id")
        )
        paginator = Pagination()
        page = paginator.paginate_queryset(query, request)
        return paginator.get_paginated_response(
            [
                {
                    "id": str(e.id),
                    "created_at": e.created_at.isoformat(),
                    "actor": e.actor.first_name or e.actor.username,
                    "action": e.action,
                    "entity_id": str(e.entity_id),
                    "detail": e.detail,
                }
                for e in page
            ]
        )
