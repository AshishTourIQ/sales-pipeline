"""Step 2: "already in the pipeline?", speed to lead (first touch, demo), Tier A alert, event costs."""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from sales_pipeline.models import Deal, Task
from sales_pipeline.services import alerts, notify
from sales_pipeline.services.duplicates import norm_name

from .conftest import make_tenant
from .test_api import new_deal
from .test_booth import booth

DUP = "/api/sales-pipeline/deals/duplicates/"


@pytest.fixture(autouse=True)
def clean_outbox(settings):
    settings.GTM_LEAD_EMAIL = "gunin@touriq.test"
    notify.OUTBOX.clear()
    yield
    notify.OUTBOX.clear()


# ---------- already in the pipeline? ----------

def test_duplicates_by_email_website_and_name(api, ws):
    d = new_deal(api, ws, company={"name": "Reef Tours LLC", "website": "https://www.reeftours.test/book"},
                 contact={"name": "Ana", "email": "Ana@ReefTours.test"})["deal"]
    by_email = api.get(DUP, {"email": "ana@reeftours.test"}).data
    assert [(x["deal_id"], x["match"]) for x in by_email] == [(d["id"], "email")]
    assert by_email[0]["pipeline_name"] and by_email[0]["stage_name"]
    assert api.get(DUP, {"website": "reeftours.test"}).data[0]["match"] == "website"
    assert api.get(DUP, {"company": "  reef tours, inc. "}).data[0]["match"] == "company"
    assert api.get(DUP, {"company": "Reef Divers"}).data == []
    assert api.get(DUP, {}).data == []


def test_norm_name_ignores_case_punctuation_and_suffixes():
    assert norm_name("The Reef Tours, LLC") == norm_name("reef tours") == "reef tours"
    assert norm_name("Reef Tours Co.") != norm_name("Reef Divers")


def test_duplicates_are_tenant_scoped(api, ws):
    new_deal(api, ws, contact={"name": "Ana", "email": "ana@reeftours.test"})
    _, users, _ = make_tenant("other")
    other = APIClient()
    other.force_authenticate(users["param"])
    assert other.get(DUP, {"email": "ana@reeftours.test"}).data == []


# ---------- speed to lead ----------

def test_booth_conversation_is_not_a_touch_but_an_email_is(api, ws):
    d = booth(api, ws, client_id="s1").data["deal"]
    assert d["first_touch_at"] == ""  # empty dates are "" in the API
    api.post(f"/api/sales-pipeline/deals/{d['id']}/activities/", {"type": "note", "text": "thinking"}, format="json")
    assert Deal.objects.get(id=d["id"]).first_touch_at is None
    api.post(f"/api/sales-pipeline/deals/{d['id']}/activities/", {"type": "email", "text": "Sent the recap"}, format="json")
    first = Deal.objects.get(id=d["id"]).first_touch_at
    assert first is not None
    # Only the first one counts
    api.post(f"/api/sales-pipeline/deals/{d['id']}/activities/", {"type": "call", "text": "Called"}, format="json")
    assert Deal.objects.get(id=d["id"]).first_touch_at == first


def test_ticking_the_booth_follow_up_is_a_touch(api, ws):
    d = booth(api, ws, client_id="s2", followup_owner_id=str(ws["users"]["nikunj"].id)).data["deal"]
    t = Task.objects.get(deal_id=d["id"], rule="r_capture48")
    r = api.patch(f"/api/sales-pipeline/tasks/{t.id}/", {"done": True}, format="json")
    assert r.status_code == 200, r.data
    assert Deal.objects.get(id=d["id"]).first_touch_at is not None


def test_demo_booked_at_the_booth_stamps_demo_at(api, ws):
    d = booth(api, ws, client_id="s3", offer="demo_booked", booked_at="2030-01-10T09:00").data["deal"]
    assert d["demo_at"] and d["first_touch_at"] == ""


# ---------- Tier A alert ----------

def _age(deal_id, hours):
    Deal.objects.filter(id=deal_id).update(created_at=timezone.now() - timedelta(hours=hours))


def test_untouched_tier_a_alerts_once_after_24_hours(api, ws):
    d = booth(api, ws, client_id="a1").data["deal"]
    assert d["booth"]["tier"] == "A"
    r = alerts.RunReport()
    alerts.check_tier_a(ws["tenant"].id, r)
    assert r.tier_a == 0  # too soon
    _age(d["id"], 25)
    alerts.check_tier_a(ws["tenant"].id, r)
    assert r.tier_a == 1
    assert "gunin@touriq.test" in {e.to[0] for e in notify.OUTBOX}
    assert "Harbor Jet Tours" in notify.OUTBOX[0].text
    notify.OUTBOX.clear()
    alerts.check_tier_a(ws["tenant"].id, alerts.RunReport())
    assert notify.OUTBOX == []


def test_touched_or_lower_tier_leads_do_not_alert(api, ws):
    touched = booth(api, ws, client_id="a2").data["deal"]
    api.post(f"/api/sales-pipeline/deals/{touched['id']}/activities/", {"type": "call", "text": "Called"}, format="json")
    tier_d = booth(api, ws, client_id="d1", company="Small Kayaks", answers={}).data["deal"]
    assert tier_d["booth"]["tier"] != "A"
    for x in (touched, tier_d):
        _age(x["id"], 30)
    r = alerts.RunReport()
    alerts.check_tier_a(ws["tenant"].id, r)
    assert r.tier_a == 0


# ---------- event costs ----------

def test_event_costs_saved_and_removed(admin_api, ws):
    url = "/api/sales-pipeline/settings/"
    r = admin_api.patch(url, {"event_costs": {"Arival 2026": "12500", "Spark 2026": 3000}}, format="json")
    assert r.status_code == 200, r.data
    assert r.data["event_costs"] == {"Arival 2026": 12500.0, "Spark 2026": 3000.0}
    r = admin_api.patch(url, {"event_costs": {"Spark 2026": None}}, format="json")
    assert r.data["event_costs"] == {"Arival 2026": 12500.0}


def test_contributors_cannot_set_event_costs(api, ws):
    assert api.patch("/api/sales-pipeline/settings/", {"event_costs": {"Arival 2026": 1}}, format="json").status_code == 403
