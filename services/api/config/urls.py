from django.urls import path
from drf_spectacular.views import SpectacularAPIView

from catalog.import_views import MedicineImportCommitView, MedicineImportPreviewView
from catalog.unit_views import ProductUnitsView
from catalog.views import CatalogView
from core.auth_views import DemoView, LoginView, LogoutView, RegisterView, SessionView
from core.customers import CustomersView
from core.maintenance import RemoveMedicineView, ResetWorkspaceView
from core.receipts import ReceiptProfileView
from core.security_views import (
    AcceptInviteView,
    InviteRevokeView,
    MFAConfirmView,
    MFAVerifyView,
    MFAView,
    StaffRevokeView,
    StaffView,
)
from core.tax_views import TaxSettingsView
from core.views import AuditView, BranchView, DashboardView, HealthView
from core.workspace_settings import WorkspaceSettingsView
from inventory.views import BatchesView, LedgerView, ReceiveView
from sales.views import CheckoutView, QuoteView, ReceiptView, SalesExportView, SalesView

urlpatterns = [
    path("api/v1/health/", HealthView.as_view()),
    path("api/v1/schema/", SpectacularAPIView.as_view()),
    path("api/v1/auth/session/", SessionView.as_view()),
    path("api/v1/auth/login/", LoginView.as_view()),
    path("api/v1/auth/register/", RegisterView.as_view()),
    path("api/v1/auth/logout/", LogoutView.as_view()),
    path("api/v1/auth/demo/", DemoView.as_view()),
    path("api/v1/auth/mfa/", MFAView.as_view()),
    path("api/v1/auth/mfa/confirm/", MFAConfirmView.as_view()),
    path("api/v1/auth/mfa/verify/", MFAVerifyView.as_view()),
    path("api/v1/auth/invitation/", AcceptInviteView.as_view()),
    path("api/v1/staff/", StaffView.as_view()),
    path("api/v1/staff/<uuid:member_id>/revoke/", StaffRevokeView.as_view()),
    path("api/v1/staff/invitations/<uuid:invitation_id>/revoke/", InviteRevokeView.as_view()),
    path("api/v1/branches/", BranchView.as_view()),
    path("api/v1/branches/<uuid:branch_id>/", WorkspaceSettingsView.as_view()),
    path("api/v1/settings/workspace/", WorkspaceSettingsView.as_view()),
    path("api/v1/settings/tax/", TaxSettingsView.as_view()),
    path("api/v1/customers/", CustomersView.as_view()),
    path("api/v1/catalog/", CatalogView.as_view()),
    path(
        "api/v1/catalog/import/preview/",
        MedicineImportPreviewView.as_view(),
    ),
    path(
        "api/v1/catalog/import/commit/",
        MedicineImportCommitView.as_view(),
    ),
    path("api/v1/catalog/<uuid:product_id>/remove/", RemoveMedicineView.as_view()),
    path("api/v1/settings/reset/", ResetWorkspaceView.as_view()),
    path("api/v1/catalog/<uuid:product_id>/units/", ProductUnitsView.as_view()),
    path("api/v1/settings/printing/", ReceiptProfileView.as_view()),
    path("api/v1/inventory/batches/", BatchesView.as_view()),
    path("api/v1/inventory/receive/", ReceiveView.as_view()),
    path("api/v1/inventory/ledger/", LedgerView.as_view()),
    path("api/v1/sales/quote/", QuoteView.as_view()),
    path("api/v1/sales/checkout/", CheckoutView.as_view()),
    path("api/v1/sales/export/", SalesExportView.as_view()),
    path("api/v1/sales/<uuid:sale_id>/", ReceiptView.as_view()),
    path("api/v1/sales/", SalesView.as_view()),
    path("api/v1/dashboard/", DashboardView.as_view()),
    path("api/v1/audit/", AuditView.as_view()),
]
