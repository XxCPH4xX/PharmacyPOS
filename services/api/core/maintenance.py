"""Owner maintenance with reviewed scope, durable evidence and retry protection."""

import hashlib
import json
import uuid
from dataclasses import replace

from django.db import transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from catalog.models import TenantProduct
from core.access import Scope, scope_for
from core.auth_views import session_data
from core.errors import BusinessError
from core.models import AuditEvent, Branch, Customer, Membership, Operation, Tenant
from core.operations import audit, complete_operation, lock_operation
from core.security import enforce_mfa
from core.serializers import StrictSerializer
from inventory.models import Batch, StockMovement
from inventory.packaging import physical_counts, record_packages
from sales.models import Sale


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def private_workspace(request):
    if request.user.username == "demo@pharmacore.local":
        raise PermissionDenied(
            "Removal and reset are available in your own workspace. The shared demo is preserved for other visitors."
        )


class RemoveInput(StrictSerializer):
    preview_token = serializers.CharField(max_length=64)
    confirmation = serializers.CharField(max_length=80)
    reason = serializers.CharField(max_length=250, min_length=5)


def removal_preview(scope, product):
    batches = list(Batch.objects.filter(tenant=scope.tenant, product=product).order_by("id"))
    rows = [
        (str(b.id), b.quantity, b.loose_quantity, b.inner_quantity, b.outer_quantity, b.unit_cost_minor)
        for b in batches
    ]
    return {
        "name": product.product.name,
        "sku": product.sku,
        "quantity": sum(b.quantity for b in batches),
        "cost_minor": sum(b.quantity * b.unit_cost_minor for b in batches),
        "branches": len({b.branch_id for b in batches if b.quantity}),
        "preview_token": digest([str(product.id), product.active, rows]),
    }


class RemoveMedicineView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, product_id):
        scope = scope_for(request, "owner")
        product = get_object_or_404(
            TenantProduct.objects.select_related("product"), tenant=scope.tenant, id=product_id
        )
        return Response(removal_preview(scope, product))

    @extend_schema(request=RemoveInput, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def post(self, request, product_id):
        scope = scope_for(request, "owner")
        private_workspace(request)
        serializer = RemoveInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        # Catalog definitions are tenant-wide. Lock branches in the same order for
        # every removal, before product/batch locks used by checkout and receiving.
        list(Branch.objects.select_for_update().filter(tenant=scope.tenant).order_by("id"))
        fingerprint, prior = lock_operation(
            scope,
            "remove_medicine",
            request.headers.get("Idempotency-Key"),
            {"product_id": str(product_id), **data},
        )
        if prior is not None:
            return Response(prior)
        product = get_object_or_404(
            TenantProduct.objects.select_for_update(of=("self",)).select_related("product"),
            tenant=scope.tenant,
            id=product_id,
            active=True,
        )
        preview = removal_preview(scope, product)
        if data["confirmation"] != product.sku:
            raise BusinessError("Type the medicine SKU to confirm removal.", "confirmation_required", 400)
        if preview["preview_token"] != data["preview_token"]:
            raise BusinessError(
                "Stock changed. Close this dialog and review removal again.", "preview_changed"
            )
        removal_id = uuid.uuid4()
        for batch in (
            Batch.objects.select_for_update()
            .filter(tenant=scope.tenant, product=product, quantity__gt=0)
            .select_related("branch")
        ):
            quantity = batch.quantity
            before = physical_counts(batch)
            batch.quantity = batch.loose_quantity = batch.inner_quantity = batch.outer_quantity = 0
            batch.save(update_fields=["quantity", "loose_quantity", "inner_quantity", "outer_quantity"])
            branch_scope = replace(scope, branch=batch.branch)
            record_packages(branch_scope, batch, before, "removal", removal_id)
            StockMovement.objects.create(
                tenant=scope.tenant,
                branch=batch.branch,
                batch=batch,
                product=product,
                quantity=-quantity,
                kind="removal",
                source_id=removal_id,
                reference=f"REMOVE-{removal_id.hex[:12].upper()}",
            )
            audit(
                branch_scope,
                "inventory.removed",
                removal_id,
                {
                    "product_id": str(product.id),
                    "batch_id": str(batch.id),
                    "quantity": quantity,
                    "cost_minor": quantity * batch.unit_cost_minor,
                    "reason": data["reason"],
                },
            )
        product.active = False
        product.save(update_fields=["active"])
        audit(
            scope,
            "catalog.removed",
            product.id,
            {
                "sku": product.sku,
                "reason": data["reason"],
                "quantity": preview["quantity"],
                "cost_minor": preview["cost_minor"],
            },
        )
        return Response(
            complete_operation(
                scope,
                "remove_medicine",
                request.headers["Idempotency-Key"],
                fingerprint,
                {"id": str(product.id), "removed": True, "quantity_removed": preview["quantity"]},
            )
        )


class ResetInput(StrictSerializer):
    source_tenant_id = serializers.UUIDField()
    branch_id = serializers.UUIDField()
    preview_token = serializers.CharField(max_length=64)
    confirmation = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)


def reset_preview(scope):
    counts = {
        "medicines": TenantProduct.objects.filter(tenant=scope.tenant, active=True).count(),
        "stock_units": Batch.objects.filter(tenant=scope.tenant).aggregate(total=Sum("quantity"))["total"]
        or 0,
        "sales": Sale.objects.filter(tenant=scope.tenant).count(),
        "customers": Customer.objects.filter(tenant=scope.tenant).count(),
        "branches": Branch.objects.filter(tenant=scope.tenant, active=True).count(),
        "team_members": Membership.objects.filter(tenant=scope.tenant, active=True)
        .values("user_id")
        .distinct()
        .count(),
    }
    latest = (
        AuditEvent.objects.filter(tenant=scope.tenant)
        .order_by("-created_at", "-id")
        .values_list("id", flat=True)
        .first()
    )
    return {
        "name": scope.tenant.name,
        "source_tenant_id": str(scope.tenant.id),
        "branch_id": str(scope.branch.id),
        "counts": counts,
        "preview_token": digest([str(scope.tenant.id), scope.tenant.version, counts, latest]),
    }


class ResetWorkspaceView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(reset_preview(scope_for(request, "owner")))

    @extend_schema(request=ResetInput, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def post(self, request):
        enforce_mfa(request)
        private_workspace(request)
        serializer = ResetInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if not request.user.check_password(data.pop("password")):
            raise PermissionDenied("Enter your current password to reset this workspace.")
        source = get_object_or_404(Tenant, id=data["source_tenant_id"])
        if not Membership.objects.filter(
            tenant=source, user=request.user, role="owner", branch__isnull=True, active=True
        ).exists():
            raise PermissionDenied("An organization owner is required.")
        list(Branch.objects.select_for_update().filter(tenant=source).order_by("id"))
        branch = get_object_or_404(Branch, id=data["branch_id"], tenant=source)
        scope = Scope(source, branch, request.user, "owner")
        key = request.headers.get("Idempotency-Key")
        if not key or len(key) > 100:
            raise BusinessError("An Idempotency-Key is required.", "idempotency_required", 400)
        fingerprint = digest(data)
        prior = Operation.objects.filter(
            tenant=source, branch=branch, kind="workspace_reset", key=key
        ).first()
        if prior:
            if prior.fingerprint != fingerprint:
                raise BusinessError("This reset key has different input.", "idempotency_conflict")
            target = get_object_or_404(Tenant, id=prior.result["tenant_id"], active=True)
        else:
            source.refresh_from_db()
            if not source.active or str(source.id) != request.session.get("tenant_id"):
                raise BusinessError(
                    "This workspace is no longer active. Reload the page.", "workspace_archived"
                )
            if data["confirmation"] != source.name:
                raise BusinessError("Type the exact workspace name to confirm.", "confirmation_required", 400)
            if data["preview_token"] != reset_preview(scope)["preview_token"]:
                raise BusinessError("Workspace data changed. Review the reset again.", "preview_changed")
            target = Tenant.objects.create(name=source.name, currency=source.currency, replaces=source)
            new_branch = Branch.objects.create(tenant=target, name=branch.name, address=branch.address)
            Membership.objects.create(tenant=target, user=request.user, role="owner")
            audit(
                scope,
                "workspace.archived",
                source.id,
                {"replacement_tenant_id": str(target.id), "counts": reset_preview(scope)["counts"]},
            )
            complete_operation(scope, "workspace_reset", key, fingerprint, {"tenant_id": str(target.id)})
            source.active = False
            source.archived_at = timezone.now()
            source.save(update_fields=["active", "archived_at"])
            audit(
                Scope(target, new_branch, request.user, "owner"),
                "workspace.started_fresh",
                target.id,
                {"archived_tenant_id": str(source.id)},
            )
        request.session["tenant_id"] = str(target.id)
        return Response(session_data(request))
