import random
from datetime import datetime, time, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from catalog.services import create_product
from core.access import Scope
from core.models import Branch, Membership, Tenant
from core.reporting import month_shift
from inventory.services import receive_batch
from sales.services import checkout


class Command(BaseCommand):
    help = "Create fictional development fixtures through the application services."

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Demo fixtures are disabled outside development.")
        if get_user_model().objects.filter(username="demo@pharmacore.local").exists():
            self.stdout.write("Demo workspace already exists; existing records preserved.")
            return
        user = get_user_model().objects.create_user(
            username="demo@pharmacore.local",
            email="demo@pharmacore.local",
            first_name="Shahriar",
            password=None,
        )
        tenant = Tenant.objects.create(name="PharmaCore Pharmacy")
        branch = Branch.objects.create(
            tenant=tenant, name="Dhanmondi Branch", address="Dhanmondi, Dhaka · Bangladesh"
        )
        Membership.objects.create(tenant=tenant, user=user, role="owner")
        scope = Scope(tenant, branch, user, "owner")
        # Fictional commercial fixtures, not clinical guidance or a national catalog.
        fixtures = [
            ("Napa", "Paracetamol", "500 mg", "Tablets", "Beximco", 120, 5200, False),
            ("Seclo", "Omeprazole", "20 mg", "Capsules", "Square", 600, 2400, True),
            ("Alatrol", "Cetirizine", "10 mg", "Tablets", "Square", 300, 2200, False),
            ("Sergel", "Esomeprazole", "20 mg", "Capsules", "Healthcare", 700, 1800, True),
            ("ORS", "Oral rehydration salts", "1 sachet", "Supplies", "SMC", 650, 3200, False),
            ("Fexo", "Fexofenadine", "120 mg", "Tablets", "Square", 900, 1800, False),
            ("Napa Syrup", "Paracetamol", "120 mg / 5 ml", "Syrups", "Beximco", 3500, 350, False),
            ("Ceevit", "Ascorbic acid", "250 mg", "Tablets", "Square", 250, 2600, False),
            ("Ace", "Paracetamol", "500 mg", "Tablets", "Square", 120, 2400, False),
            ("Normal Saline", "Sodium chloride", "0.9% · 500 ml", "Injections", "Beximco", 8500, 180, True),
            ("Azithrocin", "Azithromycin", "500 mg", "Tablets", "Beximco", 3500, 24, True),
            ("Monas", "Montelukast", "10 mg", "Tablets", "ACME", 1600, 18, True),
            ("Hand Sanitizer", "Alcohol hand rub", "100 ml", "Supplies", "ACI", 12000, 420, False),
            ("Sterile Gauze", "Cotton gauze", "10 cm × 10 cm", "Supplies", "JMI", 2500, 780, False),
            ("Tusca", "Cough syrup", "100 ml", "Syrups", "Square", 8000, 22, True),
            ("Disposable Syringe", "Sterile syringe", "5 ml", "Supplies", "JMI", 1000, 1200, False),
        ]
        today = timezone.localdate()
        products = []
        for i, (name, generic, strength, form, manufacturer, price, quantity, rx) in enumerate(fixtures):
            product = create_product(
                scope,
                {
                    "name": name,
                    "generic": generic,
                    "strength": strength,
                    "form": form,
                    "manufacturer": manufacturer,
                    "prescription_required": rx,
                    "sku": f"MED-{i + 1:04}",
                    "barcode": f"89010000{i + 1:05}",
                    "price_minor": price,
                    "reorder_level": 50,
                },
            )
            days = [42, 67, 240, 350, 28, 480, 56, 360, 520, 730, 45, 320, 400, 300, 160, 500][i]
            receive_batch(
                scope,
                {
                    "product_id": product.id,
                    "batch_number": f"BT-{today.year}-{i + 1:03}",
                    "expiry": today + timedelta(days=days),
                    "quantity": quantity,
                    "unit_cost_minor": price * 65 // 100,
                    "supplier": f"{manufacturer} Distribution",
                    "reference": f"DEMO-GRN-{i + 1:03}",
                    "location": f"{chr(65 + i // 4)}-{i % 4 + 1:02}",
                },
                f"demo-receipt-{i}",
            )
            if not rx:
                products.append(product)
        rng = random.Random(42)
        for month_offset in range(-5, 1):
            month = month_shift(today, month_offset)
            for i in range(12 + (month_offset + 5) * 3):
                item = products[i % len(products)]
                quantity = rng.randint(1, 10)
                day = min(i + 1, today.day if month_offset == 0 else 25)
                when = timezone.make_aware(
                    datetime.combine(month.replace(day=day), time(9 + i % 9, i * 7 % 60))
                )
                if when > timezone.now():
                    when = timezone.now() - timedelta(minutes=i + 1)
                checkout(
                    scope,
                    {
                        "lines": [
                            {
                                "product_id": item.id,
                                "quantity": quantity,
                                "expected_price_minor": item.price_minor,
                            }
                        ],
                        "tendered_minor": quantity * item.price_minor,
                    },
                    f"demo-sale-{month_offset}-{i}",
                    occurred_at=when,
                )
        self.stdout.write(
            self.style.SUCCESS("Created fictional demo workspace. Use Explore demo on the sign-in screen.")
        )
