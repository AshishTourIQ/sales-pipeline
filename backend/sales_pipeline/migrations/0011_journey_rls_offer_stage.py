"""
Row-Level Security for the new tables, and the new optional "Offer sent" stage
added after Replied (s5) in every existing pipeline's stage list.

Stage lists live behind RLS, so the connection is scoped to each tenant in turn.
"""
from django.db import migrations

TABLES = ["sales_pipeline_touchpoint", "sales_pipeline_intakekey"]
C = "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid"

OFFER = {"key": "offer", "name": "Offer sent", "phase": "engage", "limit": 14, "owner_id": "", "optional": True}


def add_offer(apps, schema_editor):
    Tenant = apps.get_model("core", "Tenant")
    Pipeline = apps.get_model("sales_pipeline", "Pipeline")
    User = apps.get_model("core", "User")
    with schema_editor.connection.cursor() as cur:
        for t in Tenant.objects.all():
            cur.execute("SELECT set_config('app.tenant_id', %s, false)", [str(t.id)])
            param = User.objects.filter(tenant_id=t.id, username="param").values_list("id", flat=True).first()
            for p in Pipeline.objects.filter(tenant_id=t.id):
                items = list(p.stages or []) if isinstance(p.stages, list) else None
                if items is None or any(isinstance(s, dict) and s.get("key") == "offer" for s in items):
                    continue
                keys = [s.get("key") for s in items if isinstance(s, dict)]
                # After Replied; else before Demo booked; else before the side lanes
                pos = keys.index("s5") + 1 if "s5" in keys else keys.index("s6") if "s6" in keys else len(
                    [k for k in keys if k not in ("nurture", "lost")])
                items.insert(pos, {**OFFER, "owner_id": str(param) if param else ""})
                p.stages = items
                p.save(update_fields=["stages"])
        cur.execute("SELECT set_config('app.tenant_id', '', false)")


def remove_offer(apps, schema_editor):
    Tenant = apps.get_model("core", "Tenant")
    Pipeline = apps.get_model("sales_pipeline", "Pipeline")
    with schema_editor.connection.cursor() as cur:
        for t in Tenant.objects.all():
            cur.execute("SELECT set_config('app.tenant_id', %s, false)", [str(t.id)])
            for p in Pipeline.objects.filter(tenant_id=t.id):
                if isinstance(p.stages, list):
                    p.stages = [s for s in p.stages if not (isinstance(s, dict) and s.get("key") == "offer")]
                    p.save(update_fields=["stages"])
        cur.execute("SELECT set_config('app.tenant_id', '', false)")


forward, backward = [], []
for t in TABLES:
    forward += [f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;", f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY;",
                f"CREATE POLICY tenant_isolation ON {t} USING ({C}) WITH CHECK ({C});"]
    backward += [f"DROP POLICY IF EXISTS tenant_isolation ON {t};", f"ALTER TABLE {t} NO FORCE ROW LEVEL SECURITY;",
                 f"ALTER TABLE {t} DISABLE ROW LEVEL SECURITY;"]


class Migration(migrations.Migration):
    dependencies = [("sales_pipeline", "0010_journey"), ("core", "0001_initial")]

    operations = [
        migrations.RunSQL(sql="\n".join(forward), reverse_sql="\n".join(backward)),
        migrations.RunPython(add_offer, remove_offer),
    ]
