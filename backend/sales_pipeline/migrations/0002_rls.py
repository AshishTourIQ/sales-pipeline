"""
Row-Level Security: the hard backstop for tenant isolation.

Each table only shows and accepts rows whose tenant_id equals the
transaction-local setting app.tenant_id (set per request by
TenantScopedMixin, per job by core.tenancy.tenant_context).

FORCE makes the policy apply to the table owner (our app role) too. If the
setting is missing, NULLIF turns it into NULL and no rows match: fail closed.
"""
from django.db import migrations

TABLES = [
    "sales_pipeline_pipelinesettings",
    "sales_pipeline_pipeline",
    "sales_pipeline_company",
    "sales_pipeline_contact",
    "sales_pipeline_deal",
    "sales_pipeline_stagehistory",
    "sales_pipeline_activity",
    "sales_pipeline_task",
    "sales_pipeline_dealalert",
]

CONDITION = "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid"

forward = []
backward = []
for t in TABLES:
    forward += [
        f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;",
        f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY;",
        f"CREATE POLICY tenant_isolation ON {t} USING ({CONDITION}) WITH CHECK ({CONDITION});",
    ]
    backward += [
        f"DROP POLICY IF EXISTS tenant_isolation ON {t};",
        f"ALTER TABLE {t} NO FORCE ROW LEVEL SECURITY;",
        f"ALTER TABLE {t} DISABLE ROW LEVEL SECURITY;",
    ]


class Migration(migrations.Migration):
    dependencies = [("sales_pipeline", "0001_initial")]

    operations = [migrations.RunSQL(sql="\n".join(forward), reverse_sql="\n".join(backward))]
