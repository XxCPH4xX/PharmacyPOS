from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from core.access import branches_for, tenant_for
from core.models import AuditEvent, Branch, Membership, Tenant
from core.serializers import LoginInput, RegisterInput


def session_data(request):
    if not request.user.is_authenticated:
        return {"authenticated": False, "demo_available": settings.DEBUG, "csrf_token": get_token(request)}
    tenant = tenant_for(request)
    branches = branches_for(request.user, tenant)
    memberships = Membership.objects.filter(tenant=tenant, user=request.user, active=True)
    from core.security import mfa_state

    return {
        "authenticated": True,
        "csrf_token": get_token(request),
        "user": {
            "id": request.user.id,
            "name": request.user.first_name or request.user.username,
            "email": request.user.email,
        },
        "tenant": {
            "id": str(tenant.id),
            "name": tenant.name,
            "currency": tenant.currency,
            "version": tenant.version,
        },
        "branches": [
            {"id": str(branch.id), "name": branch.name, "address": branch.address, "version": branch.version}
            for branch in branches
        ],
        "memberships": [
            {"branch_id": str(m.branch_id) if m.branch_id else None, "role": m.role} for m in memberships
        ],
        "demo": request.user.username == "demo@pharmacore.local",
        "mfa": mfa_state(request),
    }


class SessionView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(session_data(request))


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @extend_schema(request=LoginInput, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        serializer = LoginInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(
            request,
            username=serializer.validated_data["email"].lower(),
            password=serializer.validated_data["password"],
        )
        membership = (
            Membership.objects.filter(user=user, active=True, tenant__active=True)
            .order_by("created_at")
            .first()
            if user
            else None
        )
        if not membership:
            raise PermissionDenied("Email or password is incorrect, or access is inactive.")
        login(request, user)
        request.session["tenant_id"] = str(membership.tenant_id)
        AuditEvent.objects.create(
            tenant=membership.tenant, actor=user, action="identity.login", entity_id=membership.id
        )
        return Response(session_data(request))


@method_decorator(csrf_protect, name="dispatch")
class RegisterView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "register"

    @extend_schema(request=RegisterInput, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def post(self, request):
        serializer = RegisterInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        email = data["email"].lower()
        user = get_user_model()(username=email, email=email, first_name=data["name"])
        try:
            validate_password(data["password"], user)
        except DjangoValidationError as exc:
            raise ValidationError({"password": exc.messages}) from None
        try:
            with transaction.atomic():
                user.set_password(data["password"])
                user.save()
        except IntegrityError:
            raise ValidationError({"email": "An account with this email already exists."}) from None
        tenant = Tenant.objects.create(name=data["organization"])
        branch = Branch.objects.create(tenant=tenant, name=data["branch"], address=data["address"])
        Membership.objects.create(tenant=tenant, user=user, role="owner")
        AuditEvent.objects.create(
            tenant=tenant, branch=branch, actor=user, action="tenant.registered", entity_id=tenant.id
        )
        login(request, user)
        request.session["tenant_id"] = str(tenant.id)
        return Response(session_data(request), status=201)


class LogoutView(APIView):
    @extend_schema(request=None, responses=None)
    def post(self, request):
        tenant = tenant_for(request)
        membership = Membership.objects.filter(tenant=tenant, user=request.user).first()
        AuditEvent.objects.create(
            tenant=tenant, actor=request.user, action="identity.logout", entity_id=membership.id
        )
        logout(request)
        return Response(status=204)


@method_decorator(csrf_protect, name="dispatch")
class DemoView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        if not settings.DEBUG:
            raise NotFound()
        user = get_user_model().objects.filter(username="demo@pharmacore.local", is_active=True).first()
        membership = (
            Membership.objects.filter(user=user, active=True, tenant__active=True).first() if user else None
        )
        if not membership:
            raise NotFound("Run the seed_demo management command first.")
        login(request, user)
        request.session["tenant_id"] = str(membership.tenant_id)
        AuditEvent.objects.create(
            tenant=membership.tenant, actor=user, action="identity.demo_login", entity_id=membership.id
        )
        return Response(session_data(request))
