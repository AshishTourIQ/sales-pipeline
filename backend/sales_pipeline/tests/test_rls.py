"""Tenant isolation: through the API and at the database level (RLS)."""
from django.db import connection
from rest_framework.test import APIClient

from core.tenancy import set_current_tenant

from .conftest import make_tenant
from .test_api import new_deal


def test_other_tenant_sees_nothing(api, ws):
    d = new_deal(api, ws)["deal"]
    other_tenant, other_users, _ = make_tenant("othertours")
    c = APIClient()
    c.force_authenticate(other_users["param"])
    assert c.get("/api/sales-pipeline/deals/").data == []
    assert c.get(f"/api/sales-pipeline/deals/{d['id']}/").status_code == 404
    r = c.post(f"/api/sales-pipeline/deals/{d['id']}/move/", {"to": "s6"}, format="json")
    assert r.status_code == 404


def test_database_hides_rows_without_tenant(api, ws):
    new_deal(api, ws)
    with connection.cursor() as cur:
        set_current_tenant(ws["tenant"].id)
        cur.execute("SELECT count(*) FROM sales_pipeline_deal")
        assert cur.fetchone()[0] == 1
        set_current_tenant(None)  # no tenant: RLS returns nothing (fail closed)
        cur.execute("SELECT count(*) FROM sales_pipeline_deal")
        assert cur.fetchone()[0] == 0


def test_database_rejects_cross_tenant_write(api, ws):
    new_deal(api, ws)
    other_tenant, _, _ = make_tenant("othertours")  # leaves app.tenant_id = other tenant
    with connection.cursor() as cur:
        cur.execute("UPDATE sales_pipeline_deal SET stage = 'lost'")
        assert cur.rowcount == 0  # the touriq deal is invisible to this tenant
