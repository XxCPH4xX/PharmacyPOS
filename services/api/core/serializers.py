from rest_framework import serializers


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, dict):
            extra = set(data) - set(self.fields)
            if extra:
                raise serializers.ValidationError({key: "Unknown field." for key in sorted(extra)})
        return super().to_internal_value(data)


class LoginInput(StrictSerializer):
    email = serializers.EmailField(max_length=150)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class RegisterInput(LoginInput):
    name = serializers.CharField(max_length=100)
    organization = serializers.CharField(max_length=150)
    branch = serializers.CharField(max_length=120)
    address = serializers.CharField(max_length=250, required=False, default="")


class BranchInput(StrictSerializer):
    name = serializers.CharField(max_length=120)
    address = serializers.CharField(max_length=250, required=False, default="")


class ProductInput(StrictSerializer):
    name = serializers.CharField(max_length=120)
    generic = serializers.CharField(max_length=150)
    strength = serializers.CharField(max_length=60)
    form = serializers.ChoiceField(
        choices=["Tablets", "Capsules", "Syrups", "Injections", "Supplies", "Creams", "Powders"]
    )
    manufacturer = serializers.CharField(max_length=120)
    prescription_required = serializers.BooleanField(default=False)
    sku = serializers.RegexField(r"^[a-zA-Z0-9_-]+$", max_length=40)
    barcode = serializers.RegexField(r"^[a-zA-Z0-9_-]+$", max_length=64)
    price_minor = serializers.IntegerField(min_value=0, max_value=100000000)
    reorder_level = serializers.IntegerField(min_value=0, max_value=100000, default=30)
    packaging = serializers.JSONField(required=False)

    def validate_packaging(self, value):
        from catalog.packaging import PackagingInput

        serializer = PackagingInput(data=value)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data


class ReceiveInput(StrictSerializer):
    unit_id = serializers.UUIDField(required=False, allow_null=True)
    expected_base_units = serializers.IntegerField(min_value=1, max_value=10000, required=False)
    product_id = serializers.UUIDField()
    batch_number = serializers.CharField(max_length=80)
    expiry = serializers.DateField()
    quantity = serializers.IntegerField(min_value=1, max_value=1000000)
    unit_cost_minor = serializers.IntegerField(min_value=0, max_value=100000000)
    supplier = serializers.CharField(max_length=120)
    reference = serializers.CharField(max_length=80)
    location = serializers.CharField(max_length=40, default="A-01")


class CartLineInput(StrictSerializer):
    product_id = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1, max_value=10000)
    expected_price_minor = serializers.IntegerField(min_value=0, max_value=100000000)
    unit_id = serializers.UUIDField(required=False, allow_null=True)
    expected_base_units = serializers.IntegerField(min_value=1, max_value=10000, required=False)
    expected_unit_price_minor = serializers.IntegerField(min_value=0, max_value=1000000000000, required=False)


class CheckoutInput(StrictSerializer):
    lines = CartLineInput(many=True, min_length=1, max_length=100)
    tendered_minor = serializers.IntegerField(min_value=0, max_value=1000000000000)
    payment_method = serializers.ChoiceField(choices=["cash", "bkash", "nagad"], required=False)
    payment_reference = serializers.RegexField(r"^[A-Za-z0-9_-]{4,80}$", required=False, allow_blank=True)
    payment_confirmed = serializers.BooleanField(required=False)
    customer_id = serializers.UUIDField(required=False, allow_null=True)
    customer_name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    customer_phone = serializers.RegexField(r"^[+0-9 ()-]{0,25}$", required=False, allow_blank=True)
    customer_address = serializers.CharField(max_length=250, required=False, allow_blank=True)
    customer_bin = serializers.RegexField(r"^\d{13}$", required=False, allow_blank=True)
    customer_type = serializers.ChoiceField(choices=["Retail", "Delivery", "Collection"], required=False)
    staff_name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    created_by = serializers.CharField(max_length=100, required=False, allow_blank=True)
    remarks = serializers.CharField(max_length=500, required=False, allow_blank=True)

    def validate_lines(self, value):
        ids = [line["product_id"] for line in value]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Combine quantities for duplicate medicines.")
        return value
