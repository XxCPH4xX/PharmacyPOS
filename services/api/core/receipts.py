import base64
import io

import qrcode
import qrcode.image.svg
from django.db import transaction
from drf_spectacular.utils import OpenApiTypes, extend_schema
from PIL import Image, UnidentifiedImageError
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from core.access import scope_for
from core.errors import BusinessError
from core.models import ReceiptProfile, Tenant
from core.operations import audit
from core.serializers import StrictSerializer

DEFAULT_PROFILE = {
    "shop_name": "",
    "address": "",
    "phone": "",
    "email": "",
    "contact_name": "",
    "bin": "",
    "drug_license": "",
    "logo_data_url": "",
    "paper_width": 80,
    "font_size": 11,
    "show_logo": True,
    "show_batch": True,
    "show_staff": True,
    "show_amount_words": True,
    "qr_enabled": False,
    "qr_value": "",
    "invoice_terms": "",
    "receipt_terms": "Please keep this receipt for your records.",
    "default_staff_name": "",
    "default_created_by": "",
    "show_barcode": True,
    "signature_name": "",
    "invoice_accent": "#344151",
}


def with_qr(data):
    result = dict(data)
    result["qr_data_url"] = ""
    if result.get("qr_enabled") and result.get("qr_value"):
        image = io.BytesIO()
        qrcode.make(result["qr_value"], image_factory=qrcode.image.svg.SvgPathImage).save(image)
        result["qr_data_url"] = "data:image/svg+xml;base64," + base64.b64encode(image.getvalue()).decode()
    return result


def profile_data(scope):
    profile = ReceiptProfile.objects.filter(tenant=scope.tenant).first()
    data = {**DEFAULT_PROFILE, **(profile.data if profile else {})}
    return {**with_qr(data), "version": profile.version if profile else 0}


def profile_snapshot(scope):
    data = profile_data(scope)
    data["shop_name"] = data["shop_name"] or scope.tenant.name
    data["address"] = data["address"] or scope.branch.address
    return data


class ReceiptProfileInput(StrictSerializer):
    version = serializers.IntegerField(min_value=0)
    shop_name = serializers.CharField(max_length=150, allow_blank=True)
    address = serializers.CharField(max_length=250, allow_blank=True)
    phone = serializers.CharField(max_length=60, allow_blank=True)
    email = serializers.EmailField(max_length=150, allow_blank=True)
    contact_name = serializers.CharField(max_length=100, allow_blank=True)
    bin = serializers.RegexField(r"^\d{13}$", allow_blank=True)
    drug_license = serializers.CharField(max_length=80, allow_blank=True)
    logo_data_url = serializers.CharField(max_length=1500000, allow_blank=True)
    paper_width = serializers.ChoiceField(choices=[58, 80])
    font_size = serializers.IntegerField(min_value=9, max_value=14)
    show_logo = serializers.BooleanField()
    show_batch = serializers.BooleanField()
    show_staff = serializers.BooleanField()
    show_amount_words = serializers.BooleanField()
    qr_enabled = serializers.BooleanField()
    qr_value = serializers.CharField(max_length=500, allow_blank=True)
    receipt_terms = serializers.CharField(max_length=1500, allow_blank=True, required=False)
    default_staff_name = serializers.CharField(max_length=100, allow_blank=True, required=False)
    default_created_by = serializers.CharField(max_length=100, allow_blank=True, required=False)
    show_barcode = serializers.BooleanField(required=False)
    invoice_terms = serializers.CharField(max_length=1000, allow_blank=True)
    signature_name = serializers.CharField(max_length=100, allow_blank=True)
    invoice_accent = serializers.RegexField(r"^#[0-9a-fA-F]{6}$")

    def validate_logo_data_url(self, value):
        if not value:
            return ""
        prefix, separator, encoded = value.partition(",")
        if not separator or prefix not in {
            "data:image/png;base64",
            "data:image/jpeg;base64",
            "data:image/webp;base64",
        }:
            raise serializers.ValidationError("Upload a PNG, JPEG, or WebP image.")
        try:
            raw = base64.b64decode(encoded, validate=True)
            if len(raw) > 1000000:
                raise ValueError()
            with Image.open(io.BytesIO(raw)) as source:
                if source.width > 4096 or source.height > 4096 or source.width * source.height > 4000000:
                    raise ValueError()
                source.load()
                clean = source.convert("RGBA")
                clean.thumbnail((512, 512))
                output = io.BytesIO()
                clean.save(output, format="PNG")
                return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()
        except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError):
            raise serializers.ValidationError("Use a valid image under 1 MB and 4 megapixels.") from None

    def validate(self, data):
        if data["qr_enabled"] and not data["qr_value"]:
            raise serializers.ValidationError(
                {"qr_value": "Enter a merchant payment URL or QR payload before enabling QR printing."}
            )
        return data


class ReceiptProfileView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(profile_data(scope_for(request)))

    @extend_schema(request=ReceiptProfileInput, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def put(self, request):
        scope = scope_for(request, "owner")
        values = ReceiptProfileInput(data=request.data)
        values.is_valid(raise_exception=True)
        data = dict(values.validated_data)
        version = data.pop("version")
        Tenant.objects.select_for_update().get(id=scope.tenant.id)
        profile = ReceiptProfile.objects.filter(tenant=scope.tenant).first()
        if version != (profile.version if profile else 0):
            raise BusinessError(
                "Print settings changed in another window. Reload before saving.", "settings_conflict"
            )
        if profile:
            profile.data = {**profile.data, **data}
            profile.version += 1
            profile.save()
        else:
            profile = ReceiptProfile.objects.create(tenant=scope.tenant, data=data)
        audit(scope, "receipt.settings_updated", profile.id, {"version": profile.version})
        return Response(profile_data(scope))


def amount_words(minor):
    small = [
        "Zero",
        "One",
        "Two",
        "Three",
        "Four",
        "Five",
        "Six",
        "Seven",
        "Eight",
        "Nine",
        "Ten",
        "Eleven",
        "Twelve",
        "Thirteen",
        "Fourteen",
        "Fifteen",
        "Sixteen",
        "Seventeen",
        "Eighteen",
        "Nineteen",
    ]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    def words(value):
        if value < 20:
            return small[value]
        if value < 100:
            return tens[value // 10] + (" " + small[value % 10] if value % 10 else "")
        for limit, label in [(10000000, "Crore"), (100000, "Lakh"), (1000, "Thousand"), (100, "Hundred")]:
            if value >= limit:
                return (
                    words(value // limit)
                    + " "
                    + label
                    + (" " + words(value % limit) if value % limit else "")
                )
        return ""

    taka, paisa = divmod(minor, 100)
    return f"{words(taka)} Taka" + (f" and {words(paisa)} Paisa" if paisa else "") + " Only"
