from django.db import migrations

SQL = """
CREATE OR REPLACE FUNCTION pharmacore_sale_balanced() RETURNS trigger AS $$
DECLARE sale_key uuid; sale_total bigint; expected_subtotal bigint; sale_cost bigint;
        posted_discount bigint; posted_vat bigint; snapshot jsonb;
        exclusive_vat bigint; line_total numeric; line_cost numeric; paid bigint;
BEGIN
  IF TG_TABLE_NAME='sales_sale' THEN sale_key:=NEW.id; ELSE sale_key:=NEW.sale_id; END IF;
  SELECT total_minor,CASE WHEN tax_snapshot <> '{}'::jsonb THEN subtotal_minor ELSE total_minor END,
         cost_minor, discount_minor, vat_minor, tax_snapshot
    INTO sale_total,expected_subtotal,sale_cost,posted_discount,posted_vat,snapshot
    FROM sales_sale WHERE id=sale_key;
  SELECT SUM(total_minor), SUM(quantity::bigint * unit_cost_minor) INTO line_total,line_cost
    FROM sales_saleline WHERE sale_id=sale_key;
  SELECT amount_minor INTO paid FROM sales_payment WHERE sale_id=sale_key;
  IF snapshot <> '{}'::jsonb THEN
    SELECT COALESCE(SUM(CASE WHEN line->>'mode'='exclusive' THEN (line->>'vat_minor')::bigint ELSE 0 END),0)
      INTO exclusive_vat FROM jsonb_array_elements(snapshot->'lines') line;
    IF (snapshot->>'subtotal_minor')::bigint <> expected_subtotal OR
       (snapshot->>'discount_minor')::bigint <> posted_discount OR
       (snapshot->>'vat_minor')::bigint <> posted_vat OR
       (snapshot->>'total_minor')::bigint <> sale_total OR
       sale_total <> expected_subtotal - posted_discount + exclusive_vat THEN
      RAISE EXCEPTION 'Sale VAT and discount totals do not reconcile' USING ERRCODE='23514';
    END IF;
  END IF;
  IF line_total IS NULL OR paid IS NULL OR expected_subtotal<>line_total
     OR sale_cost<>line_cost OR sale_total<>paid THEN
    RAISE EXCEPTION 'Sale, lines and payment do not reconcile' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
"""

class Migration(migrations.Migration):
    dependencies = [("core", "0010_tenant_tax_config"), ("sales", "0006_sale_tax_discount")]
    operations = [migrations.RunSQL(SQL, reverse_sql=migrations.RunSQL.noop)]
