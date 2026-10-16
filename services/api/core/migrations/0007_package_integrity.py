import uuid
from django.db import migrations


SQL = """
ALTER TABLE inventory_packagemovement ADD CONSTRAINT package_batch_scope
FOREIGN KEY (tenant_id,branch_id,batch_id) REFERENCES inventory_batch(tenant_id,branch_id,id);
CREATE TRIGGER inventory_packagemovement_immutable BEFORE UPDATE OR DELETE ON inventory_packagemovement
FOR EACH ROW EXECUTE FUNCTION pharmacore_immutable();
CREATE FUNCTION pharmacore_packages_balanced() RETURNS trigger AS $$
DECLARE batch_key uuid; actual record; ledger record;
BEGIN
  IF TG_TABLE_NAME='inventory_batch' THEN batch_key:=NEW.id; ELSE batch_key:=NEW.batch_id; END IF;
  SELECT loose_quantity,inner_quantity,outer_quantity INTO actual FROM inventory_batch WHERE id=batch_key;
  SELECT COALESCE(SUM(loose_delta),0) AS loose, COALESCE(SUM(inner_delta),0) AS inner_count,
    COALESCE(SUM(outer_delta),0) AS outer_count INTO ledger FROM inventory_packagemovement WHERE batch_id=batch_key;
  IF actual.loose_quantity<>ledger.loose OR actual.inner_quantity<>ledger.inner_count OR actual.outer_quantity<>ledger.outer_count THEN
    RAISE EXCEPTION 'Physical packages do not match ledger' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER batch_packages_balance AFTER INSERT OR UPDATE ON inventory_batch
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pharmacore_packages_balanced();
CREATE CONSTRAINT TRIGGER package_movement_balance AFTER INSERT ON inventory_packagemovement
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pharmacore_packages_balanced();
CREATE OR REPLACE FUNCTION pharmacore_sale_balanced() RETURNS trigger AS $$
DECLARE sale_key uuid; sale_total bigint; sale_cost bigint; line_total numeric; line_cost numeric; paid bigint;
BEGIN
  IF TG_TABLE_NAME='sales_sale' THEN sale_key:=NEW.id; ELSE sale_key:=NEW.sale_id; END IF;
  SELECT total_minor,cost_minor INTO sale_total,sale_cost FROM sales_sale WHERE id=sale_key;
  SELECT SUM(total_minor),SUM(quantity::bigint*unit_cost_minor) INTO line_total,line_cost FROM sales_saleline WHERE sale_id=sale_key;
  SELECT amount_minor INTO paid FROM sales_payment WHERE sale_id=sale_key;
  IF line_total IS NULL OR paid IS NULL OR sale_total<>line_total OR sale_cost<>line_cost OR sale_total<>paid THEN
    RAISE EXCEPTION 'Sale, lines and payment do not reconcile' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION pharmacore_item_balanced() RETURNS trigger AS $$
DECLARE item_key uuid; expected_quantity bigint; expected_total numeric; actual_quantity bigint; actual_total numeric;
BEGIN
  IF TG_TABLE_NAME='sales_saleitem' THEN item_key:=NEW.id; ELSE item_key:=NEW.item_id; END IF;
  SELECT quantity::bigint*base_units,quantity::numeric*unit_price_minor INTO expected_quantity,expected_total FROM sales_saleitem WHERE id=item_key;
  SELECT SUM(quantity),SUM(total_minor) INTO actual_quantity,actual_total FROM sales_saleline WHERE item_id=item_key;
  IF actual_quantity IS NULL OR actual_quantity<>expected_quantity OR actual_total<>expected_total THEN
    RAISE EXCEPTION 'Selling units and stock allocations do not reconcile' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
"""


def backfill(apps, schema_editor):
    # A migration opening balance records uncertainty explicitly: existing quantities
    # are loose stock; no historical receipt or sale is rewritten as a sealed pack.
    Batch = apps.get_model('inventory', 'Batch')
    Movement = apps.get_model('inventory', 'PackageMovement')
    Product = apps.get_model('catalog', 'TenantProduct')
    forms = {'Tablets':'TABLET','Capsules':'CAPSULE','Syrups':'BOTTLE','Injections':'AMPOULE','Creams':'TUBE','Powders':'SACHET'}
    for product in Product.objects.select_related('product').iterator():
        product.base_unit = forms.get(product.product.form, 'PIECE')
        units = list(product.units.filter(active=True))
        inner = next((u for u in units if u.name in {'STRIP','PACK'} and (u.name!='STRIP' or product.product.form in {'Tablets','Capsules'})), None)
        outer = next((u for u in units if u.name=='BOX'), None)
        if inner:
            product.inner_name, product.inner_size = inner.name, inner.base_units
        if outer and outer.base_units % product.inner_size == 0:
            product.outer_name, product.outer_size = outer.name, outer.base_units
        product.save()
        product.units.exclude(name__in=[product.inner_name,product.outer_name]).update(active=False)
    for batch in Batch.objects.iterator():
        Movement.objects.create(id=uuid.uuid4(), tenant_id=batch.tenant_id, branch_id=batch.branch_id,
            batch_id=batch.id, loose_delta=batch.quantity, kind='migration', source_id=batch.id)
    schema_editor.execute('SET CONSTRAINTS ALL IMMEDIATE')
    schema_editor.execute('SET CONSTRAINTS ALL DEFERRED')
    # Store current names for old receipt profiles before workspace editing becomes available.
    schema_editor.execute('ALTER TABLE sales_sale DISABLE TRIGGER sales_sale_immutable')
    schema_editor.execute("""UPDATE sales_sale s SET receipt_profile=jsonb_build_object('branch_name',b.name,'branch_address',b.address,'organization_name',t.name)||s.receipt_profile
      FROM core_branch b,core_tenant t WHERE s.branch_id=b.id AND s.tenant_id=t.id""")
    schema_editor.execute('ALTER TABLE sales_sale ENABLE TRIGGER sales_sale_immutable')


class Migration(migrations.Migration):
    dependencies = [('core','0006_saved_customers'),('catalog','0003_physical_packaging'),('inventory','0002_physical_packaging'),('sales','0005_physical_packaging')]
    # Intentionally irreversible: restore a verified backup instead of discarding
    # sealed-package evidence or the exact monetary allocation of a posted sale.
    operations = [migrations.RunPython(backfill), migrations.RunSQL(SQL)]
