"""
Convert each pipeline's stages from the old {key: overrides} map to the ordered
stage list used by services/stages.py.

The tables are behind Row-Level Security, so we scope the connection to each
tenant in turn (app.tenant_id) while converting its pipelines.
"""
from django.db import migrations

TEMPLATE = [
    # key, name, phase, limit, optional, lane
    ("s1", "Target list", "find", 3, False, False),
    ("s2", "Contact found", "find", 2, False, False),
    ("s3", "Researched", "find", 2, False, False),
    ("s4", "Outreach sent", "engage", 14, False, False),
    ("s5", "Replied", "engage", 2, False, False),
    ("s6", "Demo booked", "engage", 7, False, False),
    ("s7", "Demo done", "win", 1, False, False),
    ("s8", "Qualified", "win", 3, False, False),
    ("s9", "Second call", "win", 10, False, False),
    ("pilot", "Pilot", "win", 30, True, False),
    ("s10", "Proposal", "win", 14, False, False),
    ("s11", "Signed", "win", 1, False, False),
    ("s12", "Onboarding", "launch", 21, False, False),
    ("s13", "Live", "launch", None, False, False),
    ("nurture", "Nurture", "lanes", None, False, True),
    ("lost", "Lost", "lanes", None, False, True),
]


def to_list(old):
    old = old or {}
    out = []
    for key, name, phase, limit, optional, lane in TEMPLATE:
        o = old.get(key) or {}
        entry = {"key": key, "name": o.get("name") or name, "phase": phase,
                 "limit": o["limit"] if "limit" in o else limit, "owner_id": o.get("owner_id") or ""}
        if optional:
            entry["optional"] = True
        if lane:
            entry["lane"] = True
        out.append(entry)
    return out


def forward(apps, schema_editor):
    Tenant = apps.get_model("core", "Tenant")
    Pipeline = apps.get_model("sales_pipeline", "Pipeline")
    with schema_editor.connection.cursor() as cur:
        for t in Tenant.objects.all():
            cur.execute("SELECT set_config('app.tenant_id', %s, false)", [str(t.id)])
            for p in Pipeline.objects.filter(tenant_id=t.id):
                if isinstance(p.stages, dict):
                    p.stages = to_list(p.stages)
                    p.save(update_fields=["stages"])
        cur.execute("SELECT set_config('app.tenant_id', '', false)")


class Migration(migrations.Migration):
    dependencies = [("sales_pipeline", "0007_dynamic_stages"), ("core", "0001_initial")]

    operations = [migrations.RunPython(forward, migrations.RunPython.noop)]
