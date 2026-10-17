"""Tenant-scoped VAT rules and monetary calculations. All money is in paisa."""
from decimal import ROUND_HALF_UP, Decimal

from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from core.serializers import StrictSerializer

MAX_RATE = 10000  # basis points: 10000 = 100%; never infer Bangladesh statutory rates

class ProductRule(StrictSerializer):
    product_id = serializers.UUIDField()
    treatment = serializers.ChoiceField(choices=["default", "exempt", "taxable"])
    rate_bps = serializers.IntegerField(min_value=0, max_value=MAX_RATE, required=False)
    mode = serializers.ChoiceField(choices=["inclusive", "exclusive"], required=False)

class TaxConfigInput(StrictSerializer):
    enabled = serializers.BooleanField()
    default_rate_bps = serializers.IntegerField(min_value=0, max_value=MAX_RATE)
    default_mode = serializers.ChoiceField(choices=["inclusive", "exclusive"])
    rules = ProductRule(many=True, max_length=2000)
    default_product_discount_bps = serializers.IntegerField(min_value=0, max_value=MAX_RATE, required=False, default=0)
    version = serializers.IntegerField(min_value=0)

    def validate_rules(self, rules):
        ids = [str(r["product_id"]) for r in rules]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Each medicine may have only one VAT rule.")
        for rule in rules:
            if rule["treatment"] == "taxable" and "rate_bps" not in rule:
                raise serializers.ValidationError("Taxable overrides require a VAT rate.")
        return rules

DEFAULT = {"enabled": False, "default_rate_bps": 0, "default_mode": "exclusive", "rules": [],
           "default_product_discount_bps": 0, "version": 0}

def config_for(tenant):
    return {**DEFAULT, **(tenant.tax_config or {})}

def enforce_discount_policy(scope, configuration, discount_type, discount_value):
    """Cashiers may use the owner-configured discount, not create their own.

    The policy belongs at the quote and checkout service boundaries because
    hiding an input in the browser does not prevent a forged HTTP request.
    """
    if scope.has_role("owner", "manager"):
        return
    default_bps = configuration.get("default_product_discount_bps", 0)
    if discount_type == "none" and discount_value == 0:
        return
    if discount_type == "percent" and discount_value == default_bps:
        return
    raise PermissionDenied("A manager must approve a discount different from the pharmacy default.")


def round_minor(value):
    return int(Decimal(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP))

def calculate(lines, configuration, discount_type="none", discount_value=0):
    """Compute each line's VAT after a proportionally allocated sale discount.

    Input lines: [{product_id, amount_minor}]. Rates use basis points (5%=500).
    Inclusive prices already contain VAT; exclusive VAT increases the payable amount.
    Rounding is per line in integer paisa. Discounts allocate by largest remainder.
    """
    if discount_type not in ("none", "fixed", "percent"):
        raise ValueError("Unsupported discount type")
    if not isinstance(discount_value, int) or isinstance(discount_value, bool) or discount_value < 0:
        raise ValueError("Invalid discount")
    # An unset per-sale discount inherits the workspace's configured product discount.
    # An explicit fixed or percentage discount overrides it only for that sale.
    if discount_type == "none" and discount_value == 0:
        default_bps = configuration.get("default_product_discount_bps", 0)
        if not isinstance(default_bps, int) or isinstance(default_bps, bool) or not 0 <= default_bps <= MAX_RATE:
            raise ValueError("Invalid default product discount")
        if default_bps:
            discount_type, discount_value = "percent", default_bps
    subtotal = sum(x["amount_minor"] for x in lines)
    if subtotal < 0 or subtotal > 1000000000000:
        raise ValueError("Unsupported subtotal")
    if discount_type == "percent":
        if discount_value > 10000:
            raise ValueError("Discount percentage exceeds 100%")
        discount = round_minor(Decimal(subtotal) * discount_value / 10000)
    elif discount_type == "fixed":
        discount = discount_value
    else:
        if discount_value:
            raise ValueError("Discount value must be zero for none")
        discount = 0
    if discount > subtotal:
        raise ValueError("Discount exceeds subtotal")
    allocations = [0] * len(lines)
    if subtotal and discount:
        exact = [Decimal(discount) * x["amount_minor"] / subtotal for x in lines]
        allocations = [int(x) for x in exact]
        remain = discount - sum(allocations)
        indexes = sorted(range(len(lines)), key=lambda i: (-(exact[i] - allocations[i]), i))
        for i in indexes[:remain]:
            allocations[i] += 1
    rules = {str(rule["product_id"]): rule for rule in configuration.get("rules", [])}
    results = []
    vat_total = extra_vat = 0
    for line, reduction in zip(lines, allocations):
        amount = line["amount_minor"] - reduction
        rule = rules.get(str(line["product_id"]), {})
        treatment = rule.get("treatment", "default")
        rate = (rule.get("rate_bps", configuration.get("default_rate_bps", 0))
                if treatment == "taxable" else configuration.get("default_rate_bps", 0))
        if treatment == "exempt" or not configuration.get("enabled", False):
            rate = 0
        mode = rule.get("mode", configuration.get("default_mode", "exclusive"))
        vat = round_minor(Decimal(amount) * rate / (10000 + rate if mode == "inclusive" else 10000)) if rate else 0
        additional = vat if mode == "exclusive" else 0
        vat_total += vat
        extra_vat += additional
        results.append({"product_id": str(line["product_id"]), "subtotal_minor": line["amount_minor"],
                        "discount_minor": reduction, "vat_minor": vat, "rate_bps": rate,
                        "mode": mode, "treatment": treatment, "total_minor": amount + additional})
    return {"subtotal_minor": subtotal, "discount_minor": discount, "vat_minor": vat_total,
            "total_minor": subtotal - discount + extra_vat,
            "discount_type": discount_type, "discount_value": discount_value,
            "lines": results}
