from django.db import migrations


LINKS = [
    ("core_membership", "branch_id", "core_branch"),
    ("core_auditevent", "branch_id", "core_branch"),
    ("core_operation", "branch_id", "core_branch"),
    ("catalog_tenantproduct", "product_id", "catalog_product"),
    ("inventory_batch", "branch_id", "core_branch"),
    ("inventory_batch", "product_id", "catalog_tenantproduct"),
    ("inventory_goodsreceipt", "branch_id", "core_branch"),
    ("inventory_goodsreceipt", "batch_id", "inventory_batch"),
    ("inventory_stockmovement", "branch_id", "core_branch"),
    ("inventory_stockmovement", "batch_id", "inventory_batch"),
    ("inventory_stockmovement", "product_id", "catalog_tenantproduct"),
    ("sales_sale", "branch_id", "core_branch"),
    ("sales_saleline", "sale_id", "sales_sale"),
    ("sales_saleline", "branch_id", "core_branch"),
    ("sales_saleline", "product_id", "catalog_tenantproduct"),
    ("sales_saleline", "batch_id", "inventory_batch"),
    ("sales_payment", "sale_id", "sales_sale"),
]
IMMUTABLE = ["core_auditevent", "core_operation", "inventory_goodsreceipt", "inventory_stockmovement", "sales_sale", "sales_saleline", "sales_payment"]


def install(apps, schema_editor):
    for table, column, target in LINKS:
        schema_editor.execute(f'ALTER TABLE {table} ADD CONSTRAINT {table}_{column}_scope FOREIGN KEY (tenant_id, {column}) REFERENCES {target}(tenant_id, id)')
    for table in ["inventory_batch", "sales_sale"]:
        schema_editor.execute(f'ALTER TABLE {table} ADD CONSTRAINT {table}_branch_context UNIQUE (tenant_id, branch_id, id)')
    schema_editor.execute('ALTER TABLE inventory_goodsreceipt ADD CONSTRAINT receipt_batch_branch FOREIGN KEY (tenant_id, branch_id, batch_id) REFERENCES inventory_batch(tenant_id, branch_id, id)')
    schema_editor.execute('ALTER TABLE sales_saleline ADD CONSTRAINT sale_line_branch FOREIGN KEY (tenant_id, branch_id, sale_id) REFERENCES sales_sale(tenant_id, branch_id, id)')
    for table in ["inventory_stockmovement", "sales_saleline"]:
        schema_editor.execute(f'ALTER TABLE {table} ADD CONSTRAINT {table}_batch_context FOREIGN KEY (tenant_id, branch_id, product_id, batch_id) REFERENCES inventory_batch(tenant_id, branch_id, product_id, id)')
    schema_editor.execute("""
        CREATE FUNCTION pharmacore_immutable() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'Posted evidence is append-only' USING ERRCODE = '23514'; END;
        $$ LANGUAGE plpgsql;
    """)
    for table in IMMUTABLE:
        schema_editor.execute(f'CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION pharmacore_immutable()')
    schema_editor.execute("""
        CREATE FUNCTION pharmacore_stock_balanced() RETURNS trigger AS $$
        DECLARE batch_key uuid; balance bigint; ledger bigint;
        BEGIN
            IF TG_TABLE_NAME = 'inventory_batch' THEN batch_key := NEW.id;
            ELSE batch_key := NEW.batch_id; END IF;
            SELECT quantity INTO balance FROM inventory_batch WHERE id = batch_key;
            SELECT COALESCE(SUM(quantity), 0) INTO ledger FROM inventory_stockmovement WHERE batch_id = batch_key;
            IF balance <> ledger THEN RAISE EXCEPTION 'Stock balance does not match ledger' USING ERRCODE = '23514'; END IF;
            RETURN NULL;
        END; $$ LANGUAGE plpgsql;
        CREATE CONSTRAINT TRIGGER batch_balance AFTER INSERT OR UPDATE ON inventory_batch
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pharmacore_stock_balanced();
        CREATE CONSTRAINT TRIGGER movement_balance AFTER INSERT ON inventory_stockmovement
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pharmacore_stock_balanced();

        CREATE FUNCTION pharmacore_sale_balanced() RETURNS trigger AS $$
        DECLARE sale_key uuid; sale_total bigint; sale_cost bigint; line_total numeric; line_cost numeric; paid bigint;
        BEGIN
            IF TG_TABLE_NAME = 'sales_sale' THEN sale_key := NEW.id;
            ELSE sale_key := NEW.sale_id; END IF;
            SELECT total_minor, cost_minor INTO sale_total, sale_cost FROM sales_sale WHERE id = sale_key;
            SELECT SUM(quantity * unit_price_minor), SUM(quantity * unit_cost_minor) INTO line_total, line_cost FROM sales_saleline WHERE sale_id = sale_key;
            SELECT amount_minor INTO paid FROM sales_payment WHERE sale_id = sale_key;
            IF line_total IS NULL OR paid IS NULL OR sale_total <> line_total OR sale_cost <> line_cost OR sale_total <> paid THEN
                RAISE EXCEPTION 'Sale, lines and payment do not reconcile' USING ERRCODE = '23514';
            END IF;
            RETURN NULL;
        END; $$ LANGUAGE plpgsql;
    """)
    for table in ["sales_sale", "sales_saleline", "sales_payment"]:
        schema_editor.execute(f'CREATE CONSTRAINT TRIGGER {table}_balanced AFTER INSERT ON {table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pharmacore_sale_balanced()')


def uninstall(apps, schema_editor):
    for table in ["sales_sale", "sales_saleline", "sales_payment"]:
        schema_editor.execute(f'DROP TRIGGER {table}_balanced ON {table}')
    schema_editor.execute('DROP FUNCTION pharmacore_sale_balanced()')
    schema_editor.execute('DROP TRIGGER batch_balance ON inventory_batch')
    schema_editor.execute('DROP TRIGGER movement_balance ON inventory_stockmovement')
    schema_editor.execute('DROP FUNCTION pharmacore_stock_balanced()')
    for table in IMMUTABLE:
        schema_editor.execute(f'DROP TRIGGER {table}_immutable ON {table}')
    schema_editor.execute('DROP FUNCTION pharmacore_immutable()')
    for table in ["inventory_stockmovement", "sales_saleline"]:
        schema_editor.execute(f'ALTER TABLE {table} DROP CONSTRAINT {table}_batch_context')
    schema_editor.execute('ALTER TABLE inventory_goodsreceipt DROP CONSTRAINT receipt_batch_branch')
    schema_editor.execute('ALTER TABLE sales_saleline DROP CONSTRAINT sale_line_branch')
    for table in ["inventory_batch", "sales_sale"]:
        schema_editor.execute(f'ALTER TABLE {table} DROP CONSTRAINT {table}_branch_context')
    for table, column, _ in LINKS:
        schema_editor.execute(f'ALTER TABLE {table} DROP CONSTRAINT {table}_{column}_scope')


class Migration(migrations.Migration):
    dependencies = [("core", "0001_initial"), ("catalog", "0001_initial"), ("inventory", "0001_initial"), ("sales", "0001_initial")]
    operations = [migrations.RunPython(install, uninstall)]
