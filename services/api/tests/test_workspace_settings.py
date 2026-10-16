from core.models import Branch, Membership, Tenant
from sales.models import Sale
from sales.services import checkout, receipt_data


def test_owner_can_edit_workspace_branch_and_history_stays_unchanged(client, scope, stock, cart):
    original = checkout(scope, cart, "before-rename")
    response = client.patch(
        "/api/v1/settings/workspace/", {"name": "Renamed Pharmacy", "version": 1}, format="json"
    )
    assert response.status_code == 200 and response.data["tenant"]["version"] == 2
    response = client.patch(
        f"/api/v1/branches/{scope.branch.id}/",
        {"name": "Updated branch", "address": "Dhaka", "version": 1},
        format="json",
    )
    assert response.status_code == 200
    assert receipt_data(Sale.objects.get())["organization"] == original["organization"]
    assert receipt_data(Sale.objects.get())["branch"] == original["branch"]
    assert client.get("/api/v1/auth/session/").data["tenant"]["name"] == "Renamed Pharmacy"
    assert (
        client.patch(
            "/api/v1/settings/workspace/", {"name": "Stale", "version": 1}, format="json"
        ).status_code
        == 409
    )


def test_workspace_edit_authorization_and_foreign_branch(client, scope):
    other = Branch.objects.create(tenant=Tenant.objects.create(name="Other"), name="Foreign")
    assert (
        client.patch(
            f"/api/v1/branches/{other.id}/", {"name": "Bad", "address": "", "version": 1}, format="json"
        ).status_code
        == 404
    )
    Membership.objects.filter(user=scope.user).update(role="manager")
    assert (
        client.patch("/api/v1/settings/workspace/", {"name": "Bad", "version": 1}, format="json").status_code
        == 403
    )
