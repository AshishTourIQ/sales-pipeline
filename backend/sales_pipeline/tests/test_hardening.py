"""Step 3: rate limits, Recall processed once, job locks, admin-only delete, RLS everywhere, health."""
from datetime import timedelta

import pytest
from django.apps import apps
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from sales_pipeline import tasks
from sales_pipeline.models import Activity, Deal, RecallMeeting, TenantModel
from sales_pipeline.services import calendar, recall
from sales_pipeline.services.errors import ServiceError

from .test_api import new_deal
from .test_intake import GAME, make_key, post
from .test_phase4 import fake_recall, make_meeting, rec  # noqa: F401 (fixture)


# ---------- every tenant table has Row-Level Security ----------

def test_every_tenant_table_has_forced_rls_and_a_policy(db):
    tables = [m._meta.db_table for m in apps.get_models() if issubclass(m, TenantModel) and not m._meta.proxy]
    assert len(tables) >= 12
    with connection.cursor() as cur:
        cur.execute("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY(%s)", [tables])
        rls = {name: (on, forced) for name, on, forced in cur.fetchall()}
        cur.execute("SELECT tablename FROM pg_policies WHERE policyname = 'tenant_isolation'")
        policies = {r[0] for r in cur.fetchall()}
    missing = [t for t in tables if rls.get(t) != (True, True) or t not in policies]
    assert missing == [], f"Tables without forced RLS + tenant_isolation policy: {missing}"


# ---------- sign-in rate limits ----------

def test_login_is_rate_limited_per_email(ws, settings):
    settings.LOGIN_EMAIL_RATE = "3/hour"
    c = APIClient()
    codes = [c.post("/api/auth/token/", {"email": "param@touriq.test", "password": "wrong"}, format="json").status_code for _ in range(4)]
    assert codes[:3] == [401, 401, 401] and codes[3] == 429


def test_invite_endpoints_are_rate_limited_per_address(db, settings):
    settings.AUTH_RATE = "2/min"
    c = APIClient()
    codes = [c.post("/api/auth/invite/check/", {"token": "nope"}, format="json").status_code for _ in range(3)]
    assert codes[-1] == 429


# ---------- intake limits ----------

def test_made_up_keys_get_an_address_blocked(admin_api, ws, settings):
    settings.INTAKE_BAD_KEY_LIMIT = 3
    good = make_key(admin_api)
    for i in range(3):
        assert post(f"spk.{ws['tenant'].id}.guess{i}", GAME).status_code == 401
    # Now even a real key from that address waits
    assert post(good, GAME).status_code == 429


def test_one_address_cannot_dodge_the_limit_with_random_keys(db, settings):
    settings.INTAKE_IP_RATE = "3/min"
    settings.INTAKE_BAD_KEY_LIMIT = 100
    codes = [post(f"spk.00000000-0000-0000-0000-000000000000.k{i}", GAME).status_code for i in range(4)]
    assert codes[:3] == [401] * 3 and codes[3] == 429


def test_daily_cap_per_key(admin_api, ws, settings):
    settings.INTAKE_DAILY_RATE = "2/day"
    key = make_key(admin_api)
    codes = [post(key, GAME | {"event_id": f"d{i}"}).status_code for i in range(3)]
    assert codes[-1] == 429


# ---------- Recall: one run per recording ----------

def test_a_second_run_does_nothing_while_the_first_is_working(api, ws, rec, monkeypatch):  # noqa: F811
    d = new_deal(api, ws)["deal"]
    Deal.objects.filter(id=d["id"]).update(meeting_url="https://meet.google.com/abc-defg-hij")
    fake_recall(monkeypatch)
    m = make_meeting(ws)
    assert recall.claim(m.id) is True
    assert recall.claim(m.id) is False  # bot.done and transcript.done both queued a run
    # The other run sees it taken and leaves it alone: no fetch, no second activity
    assert recall.process(ws["tenant"].id, m.id) == "processing"
    assert not Activity.objects.filter(deal_id=d["id"], type="meeting").exists()


def test_dismissed_while_fetching_is_not_logged(api, ws, rec, monkeypatch):  # noqa: F811
    d = new_deal(api, ws)["deal"]
    Deal.objects.filter(id=d["id"]).update(meeting_url="https://meet.google.com/abc-defg-hij")
    fake_recall(monkeypatch)
    real = recall.fetch
    m = make_meeting(ws)

    def fetch_then_dismiss(meeting):
        f = real(meeting)
        RecallMeeting.objects.filter(id=m.id).update(status="dismissed")
        return f
    monkeypatch.setattr(recall, "fetch", fetch_then_dismiss)
    assert recall.process(ws["tenant"].id, m.id) == "dismissed"
    assert not Activity.objects.filter(deal_id=d["id"], type="meeting").exists()


def test_stuck_processing_is_retried(api, ws, rec, monkeypatch):  # noqa: F811
    d = new_deal(api, ws)["deal"]
    Deal.objects.filter(id=d["id"]).update(meeting_url="https://meet.google.com/abc-defg-hij")
    fake_recall(monkeypatch)
    m = make_meeting(ws, status="processing", attempts=1)
    RecallMeeting.objects.filter(id=m.id).update(updated_at=timezone.now() - timedelta(minutes=30))
    out = tasks.process_pending_recordings_task()
    assert out[ws["tenant"].slug] == ["logged"]


# ---------- scheduled jobs don't overlap ----------

def test_single_run_lock():
    with tasks.single_run("demo", 1) as first:
        with tasks.single_run("demo", 1) as second:
            assert (first, second) == (True, False)
    with tasks.single_run("demo", 1) as again:
        assert again is True


# ---------- demo dates ----------

def test_bad_demo_date_is_refused(api, ws):
    d = new_deal(api, ws)["deal"]
    r = api.patch(f"/api/sales-pipeline/deals/{d['id']}/", {"demo_date": "next tuesday"}, format="json")
    assert r.status_code == 400
    assert api.patch(f"/api/sales-pipeline/deals/{d['id']}/", {"demo_date": "2026-10-14T10:30"}, format="json").status_code == 200


def test_calendar_body_explains_a_bad_stored_date(api, ws):
    d = Deal.objects.get(id=new_deal(api, ws)["deal"]["id"])
    d.demo_date = "soon"
    with pytest.raises(ServiceError) as e:
        calendar.event_body(d)
    assert e.value.code == "bad_demo_date"


# ---------- deleting a deal ----------

def test_only_admins_delete_deals(api, admin_api, ws):
    d = new_deal(api, ws)["deal"]
    assert api.delete(f"/api/sales-pipeline/deals/{d['id']}/").status_code == 403
    assert admin_api.delete(f"/api/sales-pipeline/deals/{d['id']}/").status_code == 204


# ---------- health ----------

def test_health(db):
    r = APIClient().get("/healthz/")
    assert r.status_code == 200 and r.json() == {"ok": True, "database": "ok", "cache": "ok"}
