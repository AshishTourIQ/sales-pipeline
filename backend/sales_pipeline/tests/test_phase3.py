"""Involvement (call attendees, account manager), team demo vs commercial call, links, partner pipelines."""
from datetime import timedelta

from django.utils import timezone

from sales_pipeline.config import DEFAULT_RULES
from sales_pipeline.models import Deal, Task
from sales_pipeline.services.rules import RuleExtra, rule_tasks

from .test_api import new_deal

today = timezone.localdate()


def titles(ts):
    return [t.title for t in ts]


# ---------- rules ----------

def test_second_call_tasks_by_type():
    team = rule_tasks("s9", DEFAULT_RULES, RuleExtra(call_type="team_demo"))
    assert titles(team)[-2:] == ["Hold the team demo: tick when it's done", "After the team demo: book the commercial call"]
    assert [t.blocking for t in team] == [True, True, True, False]
    com = rule_tasks("s9", DEFAULT_RULES, RuleExtra(call_type="commercial"))
    assert titles(com)[0] == "Prepare pricing: package, locations, per-location fee, revenue share"
    assert com[2].due == today + timedelta(7)
    assert titles(rule_tasks("s9", DEFAULT_RULES)) == ["Build the Pricing Snapshot on their data", "Hold the second call"]


def test_partner_and_referral_stage_tasks():
    assert titles(rule_tasks("pt3", DEFAULT_RULES))[0].startswith("Send the intro")
    assert titles(rule_tasks("rf3", DEFAULT_RULES)) == ["Agree the commission % and terms (both ways)", "Get the referral agreement signed: tick when signed"]
    assert rule_tasks("pt3", {**DEFAULT_RULES, "r_partner": False}) == []


# ---------- attendees and involvement ----------

def test_call_attendees(api, ws):
    d = new_deal(api, ws)["deal"]
    ids = [str(ws["users"]["nikunj"].id), str(ws["users"]["manjit"].id)]
    r = api.post(f"/api/sales-pipeline/deals/{d['id']}/activities/", {"type": "call", "text": "Demo call", "attendee_ids": ids}, format="json")
    assert r.status_code == 201
    call = next(a for a in r.data["activities"] if a["text"] == "Demo call")
    assert call["attendee_ids"] == ids
    # Fix the list later
    r = api.patch(f"/api/sales-pipeline/activities/{call['id']}/", {"attendee_ids": ids[:1]}, format="json")
    assert next(a for a in r.data["activities"] if a["id"] == call["id"])["attendee_ids"] == ids[:1]
    # Notes have no attendees
    r = api.post(f"/api/sales-pipeline/deals/{d['id']}/activities/", {"type": "note", "text": "n", "attendee_ids": ids}, format="json")
    assert next(a for a in r.data["activities"] if a["text"] == "n")["attendee_ids"] == []


def test_unknown_attendee_rejected(api, ws):
    d = new_deal(api, ws)["deal"]
    r = api.post(f"/api/sales-pipeline/deals/{d['id']}/activities/", {"type": "meeting", "text": "x", "attendee_ids": ["00000000-0000-0000-0000-000000000000"]}, format="json")
    assert r.status_code == 400 and r.data["code"] == "invalid_attendee"


def test_account_manager_links_commission(api, ws):
    d = new_deal(api, ws)["deal"]
    r = api.patch(f"/api/sales-pipeline/deals/{d['id']}/", {
        "account_manager_id": str(ws["users"]["manjit"].id), "commission_pct": "12.5",
        "links": [{"label": "Their audit", "url": "docs.example.com/a"}, {"label": "", "url": ""}],
        "company": {"category": "operator"},
    }, format="json")
    assert r.status_code == 200, r.data
    out = r.data["deal"]
    assert out["account_manager_id"] == str(ws["users"]["manjit"].id) and out["commission_pct"] == 12.5
    assert out["links"] == [{"label": "Their audit", "url": "https://docs.example.com/a"}]
    assert out["company"]["category"] == "operator"


# ---------- team demo / commercial call ----------

def _to_s9(api, ws, **move):
    d = new_deal(api, ws, entry_stage="s8")["deal"]
    Deal.objects.filter(id=d["id"]).update(qual={k: True for k in ["volume", "dm", "platform", "vertical", "budget"]})
    Task.objects.filter(deal_id=d["id"]).update(done=True)
    r = api.post(f"/api/sales-pipeline/deals/{d['id']}/move/", {"to": "s9", **move}, format="json")
    assert r.status_code == 200, r.data
    return r


def test_move_to_second_call_with_type(api, ws):
    r = _to_s9(api, ws, call_type="commercial")
    assert r.data["deal"]["call_type"] == "commercial"
    assert "Send the pricing summary before the call" in [t["title"] for t in r.data["tasks_created"]]


def test_switch_team_demo_to_commercial(api, ws):
    d = _to_s9(api, ws, call_type="team_demo").data["deal"]
    r = api.post(f"/api/sales-pipeline/deals/{d['id']}/call-type/", {"call_type": "commercial"}, format="json")
    assert r.status_code == 200, r.data
    assert r.data["deal"]["call_type"] == "commercial"
    assert len(r.data["tasks_closed"]) == 4  # the open team-demo tasks
    assert not Task.objects.filter(deal_id=d["id"], title__startswith="Hold the team demo", done=False).exists()
    assert Task.objects.filter(deal_id=d["id"], title="Hold the commercial call: tick when it's done", done=False).exists()
    assert "Next call: Commercial call (was Team demo)." in [a["text"] for a in r.data["deal"]["activities"]]


def test_call_type_only_in_second_call(api, ws):
    d = new_deal(api, ws)["deal"]
    r = api.post(f"/api/sales-pipeline/deals/{d['id']}/call-type/", {"call_type": "commercial"}, format="json")
    assert r.status_code == 400 and r.data["code"] == "invalid_stage"


# ---------- links in settings and AI ----------

def test_workspace_links(admin_api, api, ws):
    r = admin_api.patch("/api/sales-pipeline/settings/", {"links": {"booking_link": "cal.com/touriq/demo", "nope": "x"}}, format="json")
    assert r.status_code == 200 and r.data["links"] == {"booking_link": "https://cal.com/touriq/demo"}
    assert api.patch("/api/sales-pipeline/settings/", {"links": {"booking_link": "x"}}, format="json").status_code == 403

    from sales_pipeline.services.ai import build_prompt

    d = new_deal(api, ws)["deal"]
    deal = Deal.objects.get(id=d["id"])
    prompt = build_prompt("invite", deal)
    assert "https://cal.com/touriq/demo" in prompt and "confirms their TourIQ demo" in prompt


def test_competitor_category_blocks_outreach(api, ws):
    from sales_pipeline.services.ai import build_prompt
    from sales_pipeline.services.errors import ServiceError

    d = new_deal(api, ws, company={"name": "Rival Co", "category": "competitor"})["deal"]
    deal = Deal.objects.get(id=d["id"])
    try:
        build_prompt("first", deal)
        raise AssertionError("should refuse")
    except ServiceError as e:
        assert e.code == "do_not_contact"
    assert "Company type: Competitor" in build_prompt("next", deal)


# ---------- partnerships and referrals pipelines ----------

def _pipeline(admin_api, template, name):
    r = admin_api.post("/api/sales-pipeline/pipelines/", {"name": name, "template": template}, format="json")
    assert r.status_code == 201, r.data
    return r.data


def test_partner_pipeline_template(admin_api, ws):
    p = _pipeline(admin_api, "partners", "Partnerships")
    assert p["template"] == "partners" and p["pilot_enabled"] is False
    assert [s["key"] for s in p["stages"]] == ["pt1", "pt2", "pt3", "pt4", "pt5", "pt6", "nurture", "lost"]
    r = _pipeline(admin_api, "referrals", "Referrals")
    assert [s["name"] for s in r["stages"][:4]] == ["Identified", "Intro call", "Agreement", "Active partner"]


def test_transfer_deal_between_pipelines(admin_api, ws):
    p = _pipeline(admin_api, "partners", "Partnerships")
    d = new_deal(admin_api, ws)["deal"]
    r = admin_api.post(f"/api/sales-pipeline/deals/{d['id']}/transfer/", {"pipeline_id": p["id"]}, format="json")
    assert r.status_code == 200, r.data
    out = r.data["deal"]
    assert out["pipeline_id"] == p["id"] and out["stage"] == "pt1"
    assert out["history"][-1]["from"] == "s5" and "moved from TourIQ" in out["history"][-1]["by_name"]
    assert not Task.objects.filter(deal_id=d["id"], done=False, auto=True, pipeline_id=ws["pipeline"].id).exists()
    assert Task.objects.filter(deal_id=d["id"]).exclude(pipeline_id=p["id"]).count() == 0


def test_booth_handoffs_go_to_the_right_pipeline(admin_api, ws):
    base = {"pipeline_id": str(ws["pipeline"].id), "contact": {"email": ""}}
    plat = admin_api.post("/api/sales-pipeline/deals/booth/", {**base, "company": "Ventrata", "visitor": "platform"}, format="json").data["deal"]
    cons = admin_api.post("/api/sales-pipeline/deals/booth/", {**base, "company": "Jason RM", "visitor": "consultant"}, format="json").data["deal"]
    assert plat["company"]["category"] == "booking_platform" and cons["company"]["category"] == "revenue_manager"
    partners = _pipeline(admin_api, "partners", "Partnerships")
    referrals = _pipeline(admin_api, "referrals", "Referrals")
    assert admin_api.post(f"/api/sales-pipeline/pipelines/{partners['id']}/handoffs/", {}, format="json").data["moved"] == 1
    assert admin_api.post(f"/api/sales-pipeline/pipelines/{referrals['id']}/handoffs/", {}, format="json").data["moved"] == 1
    assert Deal.objects.get(id=plat["id"]).pipeline_id.hex == partners["id"].replace("-", "")
    assert Deal.objects.get(id=cons["id"]).stage == "rf1"
    # A sales pipeline takes no hand-offs
    r = admin_api.post(f"/api/sales-pipeline/pipelines/{ws['pipeline'].id}/handoffs/", {}, format="json")
    assert r.status_code == 400 and r.data["code"] == "invalid_template"


# ---------- Section 7: contact types ----------

def test_channels_template_for_otas(admin_api, ws):
    p = _pipeline(admin_api, "channels", "Channels")
    assert [s["name"] for s in p["stages"][:5]] == ["Identified", "Partnerships contact", "Intro call", "Channel agreement", "Channel live"]
    assert titles(rule_tasks("ch4", DEFAULT_RULES))[-1] == "Get the channel agreement signed: tick when signed"


def test_ota_handoff_goes_to_channels(admin_api, ws):
    d = new_deal(admin_api, ws, company={"name": "Viator", "category": "ota"})["deal"]
    Deal.objects.filter(id=d["id"]).update(stage="nurture", nurture_reason="Partner hand-off")
    ch = _pipeline(admin_api, "channels", "Channels")
    assert admin_api.post(f"/api/sales-pipeline/pipelines/{ch['id']}/handoffs/", {}, format="json").data["moved"] == 1
    assert Deal.objects.get(id=d["id"]).stage == "ch1"


def test_two_way_commission(api, ws):
    d = new_deal(api, ws)["deal"]
    r = api.patch(f"/api/sales-pipeline/deals/{d['id']}/", {"commission_pct": "10", "commission_in_pct": "15"}, format="json")
    assert (r.data["deal"]["commission_pct"], r.data["deal"]["commission_in_pct"]) == (10.0, 15.0)


def test_competitor_never_moves_into_sales(api, admin_api, ws):
    from sales_pipeline.models import Contact

    d = new_deal(api, ws)["deal"]  # s5 with open tasks
    r = api.patch(f"/api/sales-pipeline/deals/{d['id']}/", {"company": {"category": "competitor"}}, format="json")
    out = r.data["deal"]
    assert out["stage"] == "lost" and out["loss_reason"] == "Not a prospect"
    assert not Task.objects.filter(deal_id=d["id"], done=False).exists()
    assert Contact.objects.get(deals__id=d["id"]).opted_out is True
    for to in ("s4", "nurture"):
        r = api.post(f"/api/sales-pipeline/deals/{d['id']}/move/", {"to": to, "reengage_date": "2030-01-01"}, format="json")
        # Nurture too: its re-engage date would later ask someone to contact them
        assert (r.status_code, r.data.get("code")) == (409, "competitor")
    p = _pipeline(admin_api, "partners", "Partnerships")
    assert admin_api.post(f"/api/sales-pipeline/deals/{d['id']}/transfer/", {"pipeline_id": p["id"]}, format="json").data["code"] == "competitor"


def test_new_competitor_deal_lands_in_lost(api, ws):
    r = new_deal(api, ws, company={"name": "Walkway", "category": "competitor"})
    assert r["deal"]["stage"] == "lost" and r["tasks_created"] == []


def test_import_company_type(admin_api, ws):
    from sales_pipeline.models import Contact

    rows = [
        {"company": "Walkway", "contact": "Sam", "email": "sam@walkway.test", "category": "Competitor", "stage": "s4", "next": "Send intro"},
        {"company": "Viator", "category": "OTA", "stage": "s1"},
        {"company": "FareHarbor", "category": "Booking platform"},
        {"company": "Jason Pricing", "category": "Revenue manager"},
        {"company": "Reef Tours", "category": "Tour operator"},
    ]
    r = admin_api.post(f"/api/sales-pipeline/pipelines/{ws['pipeline'].id}/import/", {"rows": rows}, format="json")
    assert r.status_code == 200 and r.data["created"] == 5
    cats = {d.company.name: d.company.category for d in Deal.objects.filter(pipeline=ws["pipeline"]).select_related("company")}
    assert cats == {"Walkway": "competitor", "Viator": "ota", "FareHarbor": "booking_platform", "Jason Pricing": "revenue_manager", "Reef Tours": "operator"}
    w = Deal.objects.get(company__name="Walkway")
    assert w.stage == "lost" and not Task.objects.filter(deal=w).exists() and Contact.objects.get(email="sam@walkway.test").opted_out


def test_partner_drafts_fit_the_contact_type(api, ws):
    from sales_pipeline.services.ai import build_prompt

    d = new_deal(api, ws, company={"name": "GetYourGuide", "category": "ota"})["deal"]
    p = build_prompt("first", Deal.objects.get(id=d["id"]))
    assert "head of partnerships or integrations at this OTA" in p and "Pricing Snapshot" not in p
    d2 = new_deal(api, ws, company={"name": "Jason RM", "category": "revenue_manager"})["deal"]
    assert "commission" in build_prompt("brief", Deal.objects.get(id=d2["id"]))
    d3 = new_deal(api, ws, company={"name": "Reef Tours", "category": "operator"})["deal"]
    assert "Pricing Snapshot" in build_prompt("first", Deal.objects.get(id=d3["id"]))
