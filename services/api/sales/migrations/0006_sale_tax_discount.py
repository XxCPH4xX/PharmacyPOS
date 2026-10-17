from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("sales", "0005_physical_packaging"), ("core", "0010_tenant_tax_config")]
    operations = [
        migrations.AddField(model_name="sale", name="subtotal_minor", field=models.PositiveBigIntegerField(default=0)),
        migrations.AddField(model_name="sale", name="discount_minor", field=models.PositiveBigIntegerField(default=0)),
        migrations.AddField(model_name="sale", name="vat_minor", field=models.PositiveBigIntegerField(default=0)),
        migrations.AddField(model_name="sale", name="tax_snapshot", field=models.JSONField(default=dict)),
    ]
