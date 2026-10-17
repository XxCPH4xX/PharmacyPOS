import csv
import hashlib
import io
from decimal import Decimal, InvalidOperation

from django.core import signing
from django.db import transaction
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import TenantProduct
from catalog.services import create_product
from core.access import scope_for
from core.serializers import ProductInput

COLUMNS = [
    "name",
    "generic",
    "strength",
    "form",
    "manufacturer",
    "sku",
    "barcode",
    "price",
    "reorder_level",
    "prescription_required",
]

REQUIRED_COLUMNS = set(COLUMNS) - {"reorder_level"}

MAX_ROWS = 500
MAX_BYTES = 1024 * 1024


def parse_price(value):
    try:
        amount = Decimal(value)

        if not amount.is_finite() or amount < 0:
            raise InvalidOperation

        if amount != amount.quantize(Decimal("0.01")):
            raise InvalidOperation

        minor = int(amount * 100)

        if minor > 100000000:
            raise InvalidOperation

        return minor

    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Enter a valid selling price with up to two decimal places.") from None


def read_import(text, tenant):
    if not isinstance(text, str):
        raise ValidationError("CSV content is required.")

    if len(text.encode("utf-8")) > MAX_BYTES:
        raise ValidationError("CSV exceeds the 1 MB limit.")

    try:
        reader = csv.DictReader(
            io.StringIO(text.lstrip("\ufeff")),
            strict=True,
        )

        if not reader.fieldnames:
            raise ValidationError("The CSV has no column headers.")

        headers = reader.fieldnames

        if any(not isinstance(header, str) for header in headers):
            raise ValidationError("Invalid CSV column headers.")

        headers = [header.strip() for header in headers]

        if len(headers) != len(set(headers)):
            raise ValidationError("Duplicate column headers.")

        missing = REQUIRED_COLUMNS - set(headers)
        unknown = set(headers) - set(COLUMNS)

        if missing or unknown:
            raise ValidationError(
                {
                    "missing_columns": sorted(missing),
                    "unknown_columns": sorted(unknown),
                }
            )

        reader.fieldnames = headers

        existing = TenantProduct.objects.filter(
            tenant=tenant,
            active=True,
        )

        existing_skus = set(existing.values_list("sku", flat=True))

        existing_barcodes = set(existing.values_list("barcode", flat=True))

        seen_skus = set()
        seen_barcodes = set()

        records = []
        valid_products = []

        for line_number, row in enumerate(reader, start=2):
            if len(records) >= MAX_ROWS:
                raise ValidationError("Maximum 500 medicine rows per import.")

            errors = []

            if None in row:
                errors.append("Too many columns in this row.")

            values = {key: (row.get(key) or "").strip() for key in COLUMNS}

            if not any(values.values()) and not errors:
                continue

            sku = values["sku"]
            barcode = values["barcode"]

            if sku:
                if sku in seen_skus or sku in existing_skus:
                    errors.append("Duplicate SKU.")
                seen_skus.add(sku)

            if barcode:
                if barcode in seen_barcodes or barcode in existing_barcodes:
                    errors.append("Duplicate barcode.")
                seen_barcodes.add(barcode)

            try:
                price_minor = parse_price(values["price"])
            except ValueError as exc:
                price_minor = -1
                errors.append(str(exc))

            prescription = values["prescription_required"].lower()

            if prescription not in {"true", "false"}:
                errors.append("Prescription required must be true or false.")

            payload = {
                "name": values["name"],
                "generic": values["generic"],
                "strength": values["strength"],
                "form": values["form"],
                "manufacturer": values["manufacturer"],
                "sku": sku,
                "barcode": barcode,
                "price_minor": price_minor,
                "reorder_level": (values["reorder_level"] or "30"),
                "prescription_required": prescription == "true",
            }

            serializer = ProductInput(data=payload)

            if not serializer.is_valid():
                for field, messages in serializer.errors.items():
                    errors.append(f"{field}: {messages}")

            records.append(
                {
                    "line": line_number,
                    "name": values["name"],
                    "sku": sku,
                    "barcode": barcode,
                    "errors": errors,
                }
            )

            if not errors:
                valid_products.append(serializer.validated_data)

    except (csv.Error, UnicodeError) as exc:
        raise ValidationError(f"Invalid CSV format: {exc}") from None

    if not records:
        raise ValidationError("No medicine records found in the CSV.")

    return records, valid_products


class ImportPreviewInput(serializers.Serializer):
    csv_text = serializers.CharField()


class ImportCommitInput(ImportPreviewInput):
    preview_token = serializers.CharField()


class MedicineImportPreviewView(APIView):
    @extend_schema(request=ImportPreviewInput, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        scope = scope_for(request, "manage")

        text = request.data.get("csv_text")

        records, valid = read_import(
            text,
            scope.tenant,
        )

        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()

        token = signing.dumps(
            {
                "tenant": str(scope.tenant.id),
                "digest": digest,
            },
            salt="medicine-import",
        )

        return Response(
            {
                "rows": records,
                "total": len(records),
                "valid": len(valid),
                "invalid": len(records) - len(valid),
                "preview_token": token,
            }
        )


class MedicineImportCommitView(APIView):
    @extend_schema(request=ImportCommitInput, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        scope = scope_for(request, "manage")

        text = request.data.get("csv_text")
        token = request.data.get("preview_token")

        if not isinstance(text, str) or not isinstance(token, str):
            raise ValidationError("Import file and preview token are required.")

        try:
            signed = signing.loads(
                token,
                salt="medicine-import",
                max_age=1800,
            )
        except signing.BadSignature:
            raise ValidationError("Preview expired or invalid. Preview the file again.") from None

        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()

        if signed.get("tenant") != str(scope.tenant.id) or signed.get("digest") != digest:
            raise ValidationError("File does not match the validated preview.")

        with transaction.atomic():
            records, valid = read_import(
                text,
                scope.tenant,
            )

            if len(records) != len(valid):
                raise ValidationError("Some records are invalid. Correct the CSV and preview it again.")

            for product in valid:
                create_product(
                    scope,
                    product,
                )

        return Response(
            {
                "imported": len(valid),
                "message": "Medicines imported successfully.",
            }
        )
