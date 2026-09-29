from django.db import migrations

T = "sales_pipeline_stagetasktemplate"
C = "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid"


class Migration(migrations.Migration):
    dependencies = [("sales_pipeline", "0005_stage_gating")]

    operations = [migrations.RunSQL(
        sql=f"ALTER TABLE {T} ENABLE ROW LEVEL SECURITY; ALTER TABLE {T} FORCE ROW LEVEL SECURITY; "
            f"CREATE POLICY tenant_isolation ON {T} USING ({C}) WITH CHECK ({C});",
        reverse_sql=f"DROP POLICY IF EXISTS tenant_isolation ON {T}; ALTER TABLE {T} NO FORCE ROW LEVEL SECURITY; ALTER TABLE {T} DISABLE ROW LEVEL SECURITY;",
    )]
