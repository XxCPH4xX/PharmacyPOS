from datetime import timedelta

import pyotp
import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from core.models import Invitation, Membership, MFADevice
from core.security import begin_enrollment, cipher, confirm_enrollment, digest, verify_mfa


def enroll(user):
    secret, _ = begin_enrollment(user, "Safe-password-1834!")
    return secret, confirm_enrollment(user, pyotp.TOTP(secret).now())


def test_privileged_api_requires_enrollment_and_verification(client, settings):
    settings.REQUIRE_PRIVILEGED_MFA = True
    assert client.get("/api/v1/catalog/").status_code == 403
    setup = client.post("/api/v1/auth/mfa/", {"password": "Safe-password-1834!"}, format="json")
    assert setup.status_code == 200
    confirmed = client.post(
        "/api/v1/auth/mfa/confirm/", {"code": pyotp.TOTP(setup.data["secret"]).now()}, format="json"
    )
    assert confirmed.status_code == 200
    assert len(confirmed.data["recovery_codes"]) == 8
    assert client.get("/api/v1/catalog/").status_code == 200
    session = client.session
    session.pop("mfa_device")
    session.save()
    assert client.get("/api/v1/catalog/").status_code == 403


def test_mfa_encrypted_replay_recovery_and_lockout(scope):
    secret, (_, codes) = enroll(scope.user)
    device = MFADevice.objects.get(user=scope.user)
    assert secret not in device.secret_ciphertext
    assert cipher().decrypt(device.secret_ciphertext.encode()).decode() == secret
    assert verify_mfa(scope.user, pyotp.TOTP(secret).now()) is None
    assert verify_mfa(scope.user, codes[0])
    assert verify_mfa(scope.user, codes[0]) is None
    for _ in range(5):
        assert verify_mfa(scope.user, "wrong-code") is None
    assert verify_mfa(scope.user, codes[1]) is None
    MFADevice.objects.filter(pk=device.pk).update(locked_until=timezone.now() - timedelta(seconds=1))
    assert verify_mfa(scope.user, codes[1])


def test_enrollment_requires_password_and_expires(client, scope):
    assert client.post("/api/v1/auth/mfa/", {"password": "wrong"}).status_code == 403
    secret, _ = begin_enrollment(scope.user, "Safe-password-1834!")
    MFADevice.objects.filter(user=scope.user).update(pending_since=timezone.now() - timedelta(minutes=11))
    assert confirm_enrollment(scope.user, pyotp.TOTP(secret).now()) is None


def test_existing_authenticator_cannot_be_overwritten(scope):
    enroll(scope.user)
    with pytest.raises(Exception, match="already active"):
        begin_enrollment(scope.user, "Safe-password-1834!")


def test_invite_accept_single_use_branch_and_revocation(client, scope):
    result = client.post(
        "/api/v1/staff/",
        {"email": "cashier@example.test", "role": "cashier", "branch_id": str(scope.branch.id)},
        format="json",
    )
    assert result.status_code == 201
    invitation = Invitation.objects.get(id=result.data["id"])
    assert invitation.token_hash == digest(result.data["token"])
    assert result.data["token"] != invitation.token_hash
    client.logout()
    payload = {"token": result.data["token"], "name": "Cashier", "password": "Unique-only-44558899!"}
    assert client.post("/api/v1/auth/invitation/", payload, format="json").status_code == 200
    assert client.post("/api/v1/auth/invitation/", payload, format="json").status_code == 400
    member = Membership.objects.get(user__email="cashier@example.test")
    assert member.branch == scope.branch
    assert client.get("/api/v1/staff/").status_code == 403
    member.active = False
    member.save()
    assert client.get("/api/v1/catalog/").status_code == 403


def test_invite_no_owner_or_foreign_branch(client, scope):
    from core.models import Branch, Tenant

    foreign = Branch.objects.create(tenant=Tenant.objects.create(name="Other"), name="Foreign")
    assert client.post("/api/v1/staff/", {"email": "new@example.test", "role": "owner"}).status_code == 400
    assert (
        client.post(
            "/api/v1/staff/", {"email": "new@example.test", "role": "cashier", "branch_id": str(foreign.id)}
        ).status_code
        == 404
    )
    owner = Membership.objects.get(tenant=scope.tenant, user=scope.user)
    assert client.post(f"/api/v1/staff/{owner.id}/revoke/").status_code == 403


def test_revoked_or_expired_invites_rejected(client):
    result = client.post("/api/v1/staff/", {"email": "new@example.test", "role": "cashier"}, format="json")
    assert client.post(f"/api/v1/staff/invitations/{result.data['id']}/revoke/").status_code == 204
    client.logout()
    assert (
        client.post(
            "/api/v1/auth/invitation/",
            {"token": result.data["token"], "name": "New", "password": "Strong-password-654312!"},
        ).status_code
        == 400
    )


def test_existing_account_invite_requires_password(client):
    get_user_model().objects.create_user(
        username="existing@example.test", email="existing@example.test", password="Existing-password-9922!"
    )
    result = client.post(
        "/api/v1/staff/", {"email": "existing@example.test", "role": "auditor"}, format="json"
    )
    client.logout()
    data = {"token": result.data["token"], "name": "Existing", "password": "Wrong-password-9922!"}
    assert client.post("/api/v1/auth/invitation/", data).status_code == 403
    data["password"] = "Existing-password-9922!"
    assert client.post("/api/v1/auth/invitation/", data).status_code == 200
