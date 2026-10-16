from datetime import timedelta

from django.db.models import Count, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone

from catalog.views import catalog_query, product_data
from inventory.models import Batch
from inventory.views import batch_data
from sales.models import Sale, SaleLine


def month_shift(date, count):
    index = date.year * 12 + date.month - 1 + count
    return date.replace(year=index // 12, month=index % 12 + 1, day=1)


def dashboard_data(scope):
    today = timezone.localdate()
    month = today.replace(day=1)
    previous = month_shift(month, -1)
    first = month_shift(month, -5)
    sales = Sale.objects.filter(tenant=scope.tenant, branch=scope.branch)
    catalog = list(catalog_query(scope))
    batches = Batch.objects.filter(tenant=scope.tenant, branch=scope.branch, quantity__gt=0)
    recent = sales.filter(created_at__date__gte=month)
    revenue = recent.aggregate(revenue=Sum("total_minor"), cost=Sum("cost_minor"))
    last_revenue = (
        sales.filter(created_at__date__gte=previous, created_at__date__lt=month).aggregate(
            value=Sum("total_minor")
        )["value"]
        or 0
    )
    daily = sales.filter(created_at__date=today).aggregate(revenue=Sum("total_minor"), count=Count("id"))
    expiring = (
        batches.filter(expiry__gt=today, expiry__lte=today + timedelta(days=90))
        .select_related("product__product")
        .order_by("expiry")
    )
    low_stock = [p for p in catalog if p.active and p.stock <= p.reorder_level]
    grouped = {
        row["month"].strftime("%Y-%m"): row
        for row in sales.filter(created_at__date__gte=first)
        .annotate(month=TruncMonth("created_at"))
        .values("month")
        .annotate(revenue=Sum("total_minor"), cost=Sum("cost_minor"))
    }
    months = []
    for i in range(6):
        date = month_shift(first, i)
        row = grouped.get(date.strftime("%Y-%m"), {})
        months.append(
            {
                "label": date.strftime("%b"),
                "revenue_minor": row.get("revenue", 0),
                "cost_minor": row.get("cost", 0),
            }
        )
    distribution = {}
    for product in catalog:
        distribution[product.product.form] = distribution.get(product.product.form, 0) + product.stock
    top = (
        SaleLine.objects.filter(tenant=scope.tenant, branch=scope.branch, sale__created_at__date__gte=month)
        .values("product_id", "name")
        .annotate(units=Sum("quantity"), revenue=Sum("total_minor"))
        .order_by("-units")[:5]
    )
    return {
        "as_of": timezone.now().isoformat(),
        "currency": "BDT",
        "revenue_minor": revenue["revenue"] or 0,
        "cost_minor": revenue["cost"] or 0,
        "previous_revenue_minor": last_revenue,
        "today_revenue_minor": daily["revenue"] or 0,
        "today_transactions": daily["count"],
        "month_transactions": recent.count(),
        "stock_units": sum(p.stock for p in catalog),
        "medicine_count": len(catalog),
        "low_stock_count": len(low_stock),
        "expiring_count": expiring.count(),
        "expired_count": batches.filter(expiry__lte=today).count(),
        "trend": months,
        "distribution": [{"name": key, "value": value} for key, value in distribution.items()],
        "low_stock": [product_data(p) for p in low_stock[:6]],
        "expiring": [batch_data(b) for b in expiring[:6]],
        "top_products": [
            {
                "id": str(r["product_id"]),
                "name": r["name"],
                "units": r["units"],
                "revenue_minor": r["revenue"],
            }
            for r in top
        ],
    }
