from django.db import migrations


FORWARD = """
ALTER TABLE core_invitation ADD CONSTRAINT invitation_branch_scope
FOREIGN KEY (tenant_id, branch_id) REFERENCES core_branch(tenant_id,id);
ALTER TABLE catalog_productunit ADD CONSTRAINT productunit_product_scope
FOREIGN KEY (tenant_id, product_id) REFERENCES catalog_tenantproduct(tenant_id,id);
ALTER TABLE sales_saleitem ADD CONSTRAINT saleitem_sale_scope
FOREIGN KEY (tenant_id, sale_id) REFERENCES sales_sale(tenant_id,id);
ALTER TABLE sales_saleitem ADD CONSTRAINT saleitem_product_scope
FOREIGN KEY (tenant_id, product_id) REFERENCES catalog_tenantproduct(tenant_id,id);
ALTER TABLE sales_saleitem ADD CONSTRAINT saleitem_full_context UNIQUE(tenant_id,sale_id,product_id,id);
ALTER TABLE sales_saleline ADD CONSTRAINT saleline_item_context
FOREIGN KEY (tenant_id,sale_id,product_id,item_id) REFERENCES sales_saleitem(tenant_id,sale_id,product_id,id);
ALTER TABLE sales_saleline ADD CONSTRAINT new_saleline_has_item CHECK(item_id IS NOT NULL) NOT VALID;
CREATE TRIGGER sales_saleitem_immutable BEFORE UPDATE OR DELETE ON sales_saleitem
FOR EACH ROW EXECUTE FUNCTION pharmacore_immutable();

CREATE FUNCTION pharmacore_item_balanced() RETURNS trigger AS $$
DECLARE item_key uuid; expected_quantity bigint; expected_total numeric; actual_quantity bigint; actual_total numeric;
BEGIN
    IF TG_TABLE_NAME = 'sales_saleitem' THEN item_key := NEW.id; ELSE item_key := NEW.item_id; END IF;
    SELECT quantity::bigint * base_units, quantity::numeric * unit_price_minor
      INTO expected_quantity, expected_total FROM sales_saleitem WHERE id=item_key;
    SELECT SUM(quantity), SUM(quantity::numeric * unit_price_minor)
      INTO actual_quantity, actual_total FROM sales_saleline WHERE item_id=item_key;
    IF actual_quantity IS NULL OR actual_quantity <> expected_quantity OR actual_total <> expected_total THEN
      RAISE EXCEPTION 'Selling units and stock allocations do not reconcile' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER saleitem_balanced AFTER INSERT ON sales_saleitem DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pharmacore_item_balanced();
CREATE CONSTRAINT TRIGGER saleline_item_balanced AFTER INSERT ON sales_saleline DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pharmacore_item_balanced();
"""
REVERSE = """
DROP TRIGGER saleline_item_balanced ON sales_saleline;
DROP TRIGGER saleitem_balanced ON sales_saleitem;
DROP FUNCTION pharmacore_item_balanced();
DROP TRIGGER sales_saleitem_immutable ON sales_saleitem;
ALTER TABLE sales_saleline DROP CONSTRAINT new_saleline_has_item;
ALTER TABLE sales_saleline DROP CONSTRAINT saleline_item_context;
ALTER TABLE sales_saleitem DROP CONSTRAINT saleitem_full_context;
ALTER TABLE sales_saleitem DROP CONSTRAINT saleitem_product_scope;
ALTER TABLE sales_saleitem DROP CONSTRAINT saleitem_sale_scope;
ALTER TABLE catalog_productunit DROP CONSTRAINT productunit_product_scope;
ALTER TABLE core_invitation DROP CONSTRAINT invitation_branch_scope;
"""


class Migration(migrations.Migration):
    dependencies = [("core", "0004_receipts_units_payments"), ("catalog", "0002_receipts_units_payments"), ("sales", "0002_receipts_units_payments")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
