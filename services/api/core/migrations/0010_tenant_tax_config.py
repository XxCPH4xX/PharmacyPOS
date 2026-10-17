from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("core", "0009_workspace_removal_reset")]
    operations = [migrations.AddField(model_name="tenant", name="tax_config", field=models.JSONField(default=dict))]
