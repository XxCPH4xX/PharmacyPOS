import hashlib
import secrets
from datetime import timedelta

import pyotp
from cryptography.fernet import Fernet
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from core.errors import BusinessError
from core.models import Membership, MFADevice

PRIVILEGED_ROLES = {"owner", "manager", "pharmacist", "inventory", "accountant"}


def cipher():
    return Fernet(settings.MFA_ENCRYPTION_KEY.encode())


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def mfa_state(request):
    device = MFADevice.objects.filter(user=request.user).first()
    enabled = bool(device and device.enabled)
    verified = bool(enabled and request.session.get("mfa_device") == str(device.id))
    privileged = Membership.objects.filter(user=request.user, active=True, role__in=PRIVILEGED_ROLES).exists()
    demo = settings.DEBUG and request.user.username == "demo@pharmacore.local"
    required = (settings.REQUIRE_PRIVILEGED_MFA and privileged and not demo) or enabled
    return {"enabled": enabled, "verified": verified, "required": required and not verified}


def enforce_mfa(request):
    if mfa_state(request)["required"]:
        raise BusinessError("Verify your authenticator before using this workspace.", "mfa_required", 403)


@transaction.atomic
def begin_enrollment(user, password):
    get_user_model().objects.select_for_update().get(pk=user.pk)
    if not user.check_password(password):
        raise PermissionDenied("Password is incorrect.")
    device = MFADevice.objects.filter(user=user).first()
    if device and device.enabled:
        raise BusinessError("An authenticator is already active.", "mfa_already_enabled")
    secret = pyotp.random_base32()
    device, _ = MFADevice.objects.update_or_create(
        user=user,
        defaults={
            "secret_ciphertext": cipher().encrypt(secret.encode()).decode(),
            "pending_since": timezone.now(),
            "last_counter": -1,
            "failures": 0,
            "locked_until": None,
        },
    )
    return secret, pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name="PharmaCore")


def consume_code(device, code, *, recovery=True):
    now = timezone.now()
    if device.locked_until and device.locked_until > now:
        return False
    matched = False
    if len(code) == 6 and code.isdecimal():
        totp = pyotp.TOTP(cipher().decrypt(device.secret_ciphertext.encode()).decode())
        counter = int(now.timestamp()) // totp.interval
        for candidate in (counter - 1, counter, counter + 1):
            if candidate > device.last_counter and secrets.compare_digest(totp.at(candidate * 30), code):
                device.last_counter = candidate
                matched = True
                break
    elif recovery:
        hashed = digest(code.strip().lower())
        matched = any(secrets.compare_digest(hashed, old) for old in device.recovery_hashes)
        if matched:
            device.recovery_hashes = [old for old in device.recovery_hashes if old != hashed]
    if matched:
        device.failures, device.locked_until = 0, None
    else:
        device.failures += 1
        if device.failures >= 5:
            device.locked_until = now + timedelta(minutes=5)
            device.failures = 0
    device.save()
    return matched


@transaction.atomic
def verify_mfa(user, code):
    device = MFADevice.objects.select_for_update().filter(user=user, enabled=True).first()
    return str(device.id) if device and consume_code(device, code) else None


@transaction.atomic
def confirm_enrollment(user, code):
    device = MFADevice.objects.select_for_update().filter(user=user, enabled=False).first()
    if not device or device.pending_since < timezone.now() - timedelta(minutes=10):
        return None
    if not consume_code(device, code, recovery=False):
        return None
    codes = [secrets.token_hex(10) for _ in range(8)]
    device.enabled = True
    device.recovery_hashes = [digest(c) for c in codes]
    device.save()
    return str(device.id), codes
