"""Booth lead form: scoring on save, routing by visitor and offer, follow-ups, settings."""
from datetime import timedelta

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from sales_pipeline.models import Contact, Deal, Task

TOP = {"booking": "fareharbor", "volume": "over_5m", "role": "decider", "timeline": "under_3m",
       "locations": "3_plus", "sellouts": "often", "pricing": "fixed", "drivers": "yes"}
URL = "/api/sales-pipeline/deals/booth/"


def booth(api, ws, **over):
    body = {
        "pipeline_id": str(ws["pipeline"].id), "client_id": "", "source": "Arival booth", "met_at": "2026-10-13T10:05",
        "met_by_id": str(ws["users"]["guddu"].id), "company": "Harbor Jet Tours",
        "contact": {"name": "Jo Rivera", "email": "jo@harborjet.test", "phone": "555-0100"},
        "destination": "Key West", "runs": "Jet ski and sunset cruises", "pricing_tool": "None",
        "visitor": "operator", "answers": TOP, "offer": "", "game_played": False, "game_score": "",
        "booked_at": "", "followup_owner_id": "", "followup_due": "", "note": "Busiest on Saturdays",
    }
    body.update(over)
    return api.post(URL, body, format="json")


def test_operator_tier_a_books_demo(api, ws):
    r = booth(api, ws, offer="demo_booked", booked_at="2030-01-10T09:00", followup_owner_id=str(ws["users"]["nikunj"].id))
    assert r.status_code == 201, r.data
    d = r.data["deal"]
    b = d["booth"]
    assert (b["points"], b["tier"], b["capped"], b["complete"]) == (19, "A", False, True)
    assert b["answers"] == TOP and b["offer"] == "demo_booked"
    assert d["stage"] == "s6" and d["demo_date"] == "2030-01-10T09:00"
    assert d["interest"] == "Hot" and d["owner_id"] == str(ws["users"]["nikunj"].id)
    assert d["met_by_id"] == str(ws["users"]["guddu"].id)
    # Filled from the answers: platform, decision-maker, region, locations
    assert d["company"]["platform"] == "FareHarbor" and d["company"]["region"] == "Key West"
    assert d["contact"]["decision_maker"] is True and d["locations"] == "3+"
    titles = [t["title"] for t in r.data["tasks_created"]]
    assert "Send the demo invite and deck to Jo Rivera (booth, tier A)" in titles
    assert "Follow up within 48 hours (booth lead)" not in titles  # replaced by the form's own follow-up
    assert any("Tier A (19 points)" in a["text"] for a in d["activities"])
    assert any(a["text"] == "Busiest on Saturdays" for a in d["activities"])


def test_points_never_taken_from_client(api, ws):
    r = booth(api, ws, answers={"role": "staff", "booking": "other"}, points=19, tier="A")
    assert r.data["deal"]["booth"]["tier"] == "D"


def test_cap_and_default_offer(api, ws):
    r = booth(api, ws, answers={**TOP, "role": "manager"})
    b = r.data["deal"]["booth"]
    assert (b["tier_before_cap"], b["tier"], b["capped"], b["offer"]) == ("A", "B", True, "audit")
    d = r.data["deal"]
    assert d["stage"] == "offer" and d["track"] == "audit"
    titles = [t["title"] for t in r.data["tasks_created"]]
    assert titles[0] == "Send the audit form for their booking data" and "Demo booked: tick when they book" in titles


def test_follow_up_due_from_tier_defaults(api, ws):
    r = booth(api, ws, answers={"role": "decider", "booking": "fareharbor", "volume": "1m_5m"},  # 8 points: C
              followup_owner_id=str(ws["users"]["manjit"].id))
    assert r.data["deal"]["stage"] == "offer" and r.data["deal"]["track"] == "analysis"
    t = next(t for t in r.data["tasks_created"] if "comparative analysis" in t["title"])
    assert t["due"] == (timezone.localdate() + timedelta(days=3)).isoformat()
    assert t["owner_id"] == str(ws["users"]["manjit"].id)


def test_demo_given_goes_to_demo_done(api, ws):
    assert booth(api, ws, offer="demo_given").data["deal"]["stage"] == "s7"


def test_competitor_is_never_contacted(api, ws):
    r = booth(api, ws, visitor="competitor", followup_owner_id=str(ws["users"]["param"].id))
    d = r.data["deal"]
    assert d["stage"] == "lost" and d["loss_reason"] == "Not a prospect" and d["booth"]["tier"] == "D"
    assert r.data["tasks_created"] == []  # no follow-up, no 90-day review
    assert Contact.objects.get(deals__id=d["id"]).opted_out is True
    ai = api.post(f"/api/sales-pipeline/deals/{d['id']}/ai-draft/", {"action": "first"}, format="json")
    assert ai.status_code in (409, 503)  # 503 when AI isn't configured in this environment


def test_partner_hand_off(api, ws):
    r = booth(api, ws, visitor="platform", company="Ventrata", followup_owner_id=str(ws["users"]["nikunj"].id))
    d = r.data["deal"]
    assert d["stage"] == "nurture" and d["nurture_reason"] == "Partner hand-off"
    assert d["booth"]["tier"] == "" and d["booth"]["answers"] == {}
    assert "Hand Jo Rivera to the partnerships team" in [t["title"] for t in r.data["tasks_created"]]


def test_press_hand_off(api, ws):
    d = booth(api, ws, visitor="press", followup_owner_id=str(ws["users"]["param"].id)).data["deal"]
    assert d["stage"] == "nurture" and d["nurture_reason"] == "Press hand-off"


def test_retry_with_same_client_id_returns_same_deal(api, ws):
    a = booth(api, ws, client_id="dev-123").data["deal"]["id"]
    b = booth(api, ws, client_id="dev-123").data["deal"]["id"]
    assert a == b and Deal.objects.filter(booth__client_id="dev-123").count() == 1


def test_database_refuses_a_second_deal_with_the_same_client_id(api, ws):
    booth(api, ws, client_id="dev-9")
    d = Deal.objects.get(id=booth(api, ws, client_id="dev-10").data["deal"]["id"])
    d.booth = {**d.booth, "client_id": "dev-9"}
    with pytest.raises(IntegrityError), transaction.atomic():
        d.save()
    # Leads saved without a client_id (older forms) are not affected
    booth(api, ws)
    booth(api, ws)


def test_company_required(api, ws):
    r = booth(api, ws, company="  ")
    assert r.status_code == 400


def test_rescore_from_drawer(api, ws):
    d = booth(api, ws).data["deal"]
    r = api.patch(f"/api/sales-pipeline/deals/{d['id']}/", {"booth": {"answers": {**TOP, "volume": "under_250k", "timeline": "none"}}}, format="json")
    assert r.status_code == 200, r.data
    b = r.data["deal"]["booth"]
    assert (b["points"], b["tier"]) == (13, "B")
    assert r.data["deal"]["stage"] == d["stage"]  # re-scoring never moves the deal


def test_followup_settings(api, admin_api, ws):
    s = api.get("/api/sales-pipeline/settings/").data["booth_followup"]
    assert s["A"] == {"owner_id": str(ws["users"]["nikunj"].id), "days": 0}
    assert s["D"] == {"owner_id": str(ws["users"]["param"].id), "days": 7}
    r = admin_api.patch("/api/sales-pipeline/settings/", {"booth_followup": {"A": {"owner_id": str(ws["users"]["guddu"].id), "days": 1}}}, format="json")
    assert r.status_code == 200 and r.data["booth_followup"]["A"] == {"owner_id": str(ws["users"]["guddu"].id), "days": 1}
    assert r.data["booth_followup"]["B"]["days"] == 2  # others untouched
    # Contributors can't change set-up
    assert api.patch("/api/sales-pipeline/settings/", {"booth_followup": {"A": {"days": 5}}}, format="json").status_code == 403


def test_follow_up_blocks_until_done(api, ws):
    # Demo booked: the form's own follow-up task, blocking
    d = booth(api, ws, offer="demo_booked", followup_owner_id=str(ws["users"]["manjit"].id)).data["deal"]
    assert Task.objects.filter(deal_id=d["id"], rule="r_capture48", blocking=True).count() == 1


def test_booth_journey_steps(api, ws):
    d = booth(api, ws, answers={"role": "staff"}, game_played=True, game_score="840").data["deal"]  # tier D, game
    assert d["stage"] == "offer" and d["track"] == "game"
    assert [(t["kind"], t["source"], t["score"]) for t in d["touchpoints"]] == [("game_played", "booth", "840")]
    d2 = booth(api, ws, company="Demo Co", offer="demo_booked", booked_at="2030-02-01T10:00").data["deal"]
    assert [t["kind"] for t in d2["touchpoints"]] == ["demo_booked"]


def test_offer_sent_ticks_through_to_demo(api, ws):
    """Ticking every blocking task of "Offer sent" moves the deal to Demo booked."""
    d = booth(api, ws, answers={"role": "staff"}, followup_owner_id=str(ws["users"]["param"].id)).data["deal"]
    last = None
    for t in Task.objects.filter(deal_id=d["id"], stage="offer", done=False, blocking=True):
        last = api.patch(f"/api/sales-pipeline/tasks/{t.id}/", {"done": True}, format="json")
    moved = last.data["advanced"]["deal"]
    assert moved["stage"] == "s6" and moved["track"] == "game"
    assert "demo_booked" in [t["kind"] for t in moved["touchpoints"]]


def test_move_into_offer_is_not_gated(api, ws):
    from .test_api import new_deal
    d = new_deal(api, ws)["deal"]  # s5 with open tasks
    r = api.post(f"/api/sales-pipeline/deals/{d['id']}/move/", {"to": "offer", "track": "analysis"}, format="json")
    assert r.status_code == 200, r.data
    assert r.data["deal"]["track"] == "analysis"
    assert [t["title"] for t in r.data["tasks_created"]][0] == "Run the comparative analysis and send it"


def test_event_saved_and_editable(api, ws):
    d = booth(api, ws, event="Spark 2026", source="Spark booth").data["deal"]
    assert (d["event"], d["source"]) == ("Spark 2026", "Spark booth")
    r = api.patch(f"/api/sales-pipeline/deals/{d['id']}/", {"event": " Arival 2026 "}, format="json")
    assert r.data["deal"]["event"] == "Arival 2026"
    # A future event: its own name, the generic booth source
    d2 = booth(api, ws, company="Future Co", event="ITB Berlin 2027", source="Event booth").data["deal"]
    assert (d2["event"], d2["source"]) == ("ITB Berlin 2027", "Event booth")
    # Leads that didn't come from an event have none
    from .test_api import new_deal
    assert new_deal(api, ws, source="Outbound list", entry_stage="s1")["deal"]["event"] == ""


# ---------- Game only: the game link email ----------

def test_game_only_not_played_emails_the_link(api, ws, settings):
    from django.core import mail

    settings.EMAIL_ENABLED, settings.EMAIL_HOST_USER, settings.GAME_LINK = True, "ai@test.example", "https://game.test/play"
    mail.outbox.clear()
    r = booth(api, ws, answers={"role": "staff"}, event="Arival 2026", followup_owner_id=str(ws["users"]["param"].id),
              contact={"name": "Jo Rivera", "email": "jo@harborjettours.com", "phone": ""})  # tier D
    assert r.status_code == 201, r.data
    d = r.data["deal"]
    assert d["booth"]["offer"] == "game" and d["stage"] == "offer"
    assert r.data["notices"] == ["Game link emailed to jo@harborjettours.com."]
    assert len(mail.outbox) == 1
    m = mail.outbox[0]
    assert m.to == ["jo@harborjettours.com"] and "https://game.test/play" in m.body and "at Arival 2026" in m.body
    assert m.reply_to == ["param@touriq.test"]
    assert [t["kind"] for t in d["touchpoints"]] == ["game_link_sent"]
    send = Task.objects.get(deal_id=d["id"], title="Send them the game link and the demo link")
    assert send.done  # the email was the task


def test_game_already_played_sends_nothing(api, ws, settings):
    from django.core import mail

    settings.EMAIL_ENABLED = True
    mail.outbox.clear()
    r = booth(api, ws, answers={"role": "staff"}, game_played=True, game_score="840")
    assert mail.outbox == [] and r.data["notices"] == []
    assert Task.objects.filter(deal_id=r.data["deal"]["id"], title="Send their game result and the demo link", done=False).exists()


def test_game_link_needs_an_email_and_setup(api, ws, settings):
    from django.core import mail

    settings.EMAIL_ENABLED = True
    mail.outbox.clear()
    r = booth(api, ws, answers={"role": "staff"}, contact={"name": "No Mail", "email": "", "phone": ""})
    assert "No email address" in r.data["notices"][0] and mail.outbox == []
    settings.EMAIL_ENABLED = False
    r = booth(api, ws, company="Other Co", answers={"role": "staff"})
    assert "isn't set up" in r.data["notices"][0]
    # Still saved, and the send task stays open for a person
    assert Task.objects.filter(deal_id=r.data["deal"]["id"], title="Send them the game link and the demo link", done=False).exists()


# ---------- Tier C: comparative analysis request ----------

def test_analysis_request_is_saved_and_email_drafted(api, ws, settings):
    from django.core import mail

    settings.EMAIL_ENABLED = True
    mail.outbox.clear()
    answers = {"role": "decider", "booking": "fareharbor", "volume": "1m_5m"}  # 8 points: tier C
    r = booth(api, ws, answers=answers, website="harborjet.test")
    assert r.status_code == 201, r.data
    d = r.data["deal"]
    assert d["booth"]["offer"] == "analysis"
    assert d["booth"]["analysis"] == {"website": "https://harborjet.test", "status": "requested"}
    assert d["company"]["website"] == "https://harborjet.test"
    assert [t["kind"] for t in d["touchpoints"]] == ["analysis_requested"]
    draft = next(a["text"] for a in d["activities"] if a["text"].startswith("Draft email"))
    assert "Your comparative analysis: Harbor Jet Tours" in draft and "top competitors" in draft and "[report link]" in draft
    assert mail.outbox == []  # drafted only: nothing is sent until the report tool is connected
    assert r.data["notices"] == ["Comparative analysis requested for https://harborjet.test. The report email is drafted on the deal."]
