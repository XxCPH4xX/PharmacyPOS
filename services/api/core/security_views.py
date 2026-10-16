import io
import secrets
from datetime import timedelta

import qrcode
import qrcode.image.svg
from django.contrib.auth import get_user_model, login
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from core.access import scope_for, tenant_for
from core.auth_views import session_data
from core.models import AuditEvent, Branch, Invitation, Membership
from core.operations import audit
from core.security import begin_enrollment, confirm_enrollment, digest, mfa_state, verify_mfa
from core.serializers import StrictSerializer


class EnrollmentInput(StrictSerializer):
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class CodeInput(StrictSerializer):
    code = serializers.CharField(max_length=64)


class MFAView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "mfa"

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(mfa_state(request))

    @extend_schema(request=EnrollmentInput, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        tenant_for(request)
        data = EnrollmentInput(data=request.data)
        data.is_valid(raise_exception=True)
        secret, uri = begin_enrollment(request.user, data.validated_data["password"])
        svg = io.BytesIO()
        qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage).save(svg)
        return Response({"secret": secret, "uri": uri, "qr_svg": svg.getvalue().decode()})


class MFAConfirmView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "mfa"

    @extend_schema(request=CodeInput, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        data = CodeInput(data=request.data)
        data.is_valid(raise_exception=True)
        confirmed = confirm_enrollment(request.user, data.validated_data["code"])
        if not confirmed:
            raise ValidationError(
                "Invalid, expired, or already-used code. After repeated attempts, wait five minutes."
            )
        device_id, codes = confirmed
        request.session.cycle_key()
        request.session["mfa_device"] = device_id
        tenant = tenant_for(request)
        AuditEvent.objects.create(
            tenant=tenant, actor=request.user, action="identity.mfa_enabled", entity_id=device_id
        )
        return Response({"session": session_data(request), "recovery_codes": codes})


class MFAVerifyView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "mfa"

    @extend_schema(request=CodeInput, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        data = CodeInput(data=request.data)
        data.is_valid(raise_exception=True)
        device_id = verify_mfa(request.user, data.validated_data["code"])
        if not device_id:
            raise ValidationError("Invalid or already-used code. After repeated attempts, wait five minutes.")
        request.session.cycle_key()
        request.session["mfa_device"] = device_id
        return Response(session_data(request))


class InviteInput(StrictSerializer):
    email = serializers.EmailField(max_length=150)
    role = serializers.ChoiceField(choices=[r for r, _ in Membership.Role.choices if r != "owner"])
    branch_id = serializers.UUIDField(required=False, allow_null=True, default=None)


class AcceptInviteInput(StrictSerializer):
    token = serializers.CharField(max_length=100)
    name = serializers.CharField(max_length=100)
    password = serializers.CharField(max_length=128, trim_whitespace=False)
    code = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")


class StaffView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        scope = scope_for(request, "owner")
        staff = (
            Membership.objects.filter(tenant=scope.tenant)
            .select_related("user", "branch")
            .order_by("created_at")
        )
        invitations = Invitation.objects.filter(tenant=scope.tenant).order_by("-created_at")[:100]
        return Response(
            {
                "members": [
                    {
                        "id": str(m.id),
                        "name": m.user.first_name,
                        "email": m.user.email,
                        "role": m.role,
                        "branch_id": str(m.branch_id) if m.branch_id else None,
                        "branch": m.branch.name if m.branch else "All branches",
                        "active": m.active,
                    }
                    for m in staff
                ],
                "invitations": [
                    {
                        "id": str(i.id),
                        "email": i.email,
                        "role": i.role,
                        "expires_at": i.expires_at,
                        "status": "accepted"
                        if i.accepted_at
                        else "revoked"
                        if i.revoked_at
                        else "expired"
                        if i.expires_at < timezone.now()
                        else "pending",
                    }
                    for i in invitations
                ],
            }
        )

    @extend_schema(request=InviteInput, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def post(self, request):
        scope = scope_for(request, "owner")
        data = InviteInput(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data
        branch = (
            get_object_or_404(Branch, id=values["branch_id"], tenant=scope.tenant, active=True)
            if values["branch_id"]
            else None
        )
        token = secrets.token_urlsafe(32)
        invitation = Invitation.objects.create(
            tenant=scope.tenant,
            email=values["email"].lower(),
            role=values["role"],
            branch=branch,
            token_hash=digest(token),
            expires_at=timezone.now() + timedelta(days=7),
            invited_by=request.user,
        )
        audit(scope, "staff.invited", invitation.id, {"role": invitation.role})
        return Response(
            {"id": str(invitation.id), "token": token, "expires_at": invitation.expires_at}, status=201
        )


class StaffRevokeView(APIView):
    @extend_schema(request=None, responses=None)
    @transaction.atomic
    def post(self, request, member_id):
        scope = scope_for(request, "owner")
        member = get_object_or_404(Membership.objects.select_for_update(), id=member_id, tenant=scope.tenant)
        if member.role == "owner":
            raise PermissionDenied("Owner access cannot be revoked through staff management.")
        member.active = False
        member.save(update_fields=["active"])
        audit(scope, "staff.revoked", member.id)
        return Response(status=204)


class InviteRevokeView(APIView):
    @extend_schema(request=None, responses=None)
    @transaction.atomic
    def post(self, request, invitation_id):
        scope = scope_for(request, "owner")
        invitation = get_object_or_404(
            Invitation.objects.select_for_update(), id=invitation_id, tenant=scope.tenant
        )
        invitation.revoked_at = timezone.now()
        invitation.save(update_fields=["revoked_at"])
        audit(scope, "staff.invitation_revoked", invitation.id)
        return Response(status=204)


@method_decorator(csrf_protect, name="dispatch")
class AcceptInviteView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @extend_schema(request=AcceptInviteInput, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        data = AcceptInviteInput(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data
        # Verify existing credentials before the posting transaction so failed MFA attempts persist.
        candidate = Invitation.objects.filter(
            token_hash=digest(values["token"]),
            accepted_at__isnull=True,
            revoked_at__isnull=True,
            expires_at__gt=timezone.now(),
            tenant__active=True,
        ).first()
        if not candidate:
            raise ValidationError("This invitation is invalid or expired.")
        user = get_user_model().objects.filter(username=candidate.email).first()
        verified = None
        if user:
            if not user.is_active or not user.check_password(values["password"]):
                raise PermissionDenied("Use the existing account password to accept this invitation.")
            if hasattr(user, "mfadevice") and user.mfadevice.enabled:
                verified = verify_mfa(user, values["code"])
                if not verified:
                    raise PermissionDenied("An unused authenticator or recovery code is required.")
        try:
            with transaction.atomic():
                invitation = get_object_or_404(Invitation.objects.select_for_update(), id=candidate.id)
                if invitation.accepted_at or invitation.revoked_at or invitation.expires_at <= timezone.now():
                    raise ValidationError("This invitation is invalid or expired.")
                if invitation.branch_id and not invitation.branch.active:
                    raise ValidationError("This branch is inactive.")
                if not user:
                    user = get_user_model()(
                        username=invitation.email, email=invitation.email, first_name=values["name"]
                    )
                    try:
                        validate_password(values["password"], user)
                    except DjangoValidationError as exc:
                        raise ValidationError({"password": exc.messages}) from None
                    user.set_password(values["password"])
                    user.save()
                member, created = Membership.objects.get_or_create(
                    tenant=invitation.tenant,
                    user=user,
                    branch=invitation.branch,
                    defaults={"role": invitation.role},
                )
                if not created:
                    raise ValidationError("Membership already exists. Ask the owner to review access.")
                invitation.accepted_at = timezone.now()
                invitation.save(update_fields=["accepted_at"])
                AuditEvent.objects.create(
                    tenant=invitation.tenant,
                    branch=invitation.branch,
                    actor=user,
                    action="staff.invitation_accepted",
                    entity_id=member.id,
                )
        except IntegrityError:
            raise ValidationError("The account changed. Sign in and retry the invitation.") from None
        login(request, user)
        request.session["tenant_id"] = str(invitation.tenant_id)
        if verified:
            request.session["mfa_device"] = verified
        return Response(session_data(request))
