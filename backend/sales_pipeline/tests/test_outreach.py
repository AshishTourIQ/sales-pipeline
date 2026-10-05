"""Outreach tracker: import, verify, paste → approve → send, P1 owner, one Arival app sender, reply checks."""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from sales_pipeline.models import Company, Contact, Deal, OutreachDraft
from sales_pipeline.services import outreach as o
from sales_pipeline.services.pipelines import create_pipeline

today = timezone.localdate()
CAMPAIGN = "Arival 2026"

# Dummy rows only (never the real tracker)
ROWS = [
    {"ext_id": "C001", "name": "Jane Doe", "title": "Owner", "email": "jane@example.com", "country": "United States",
     "company": "Example Boat Tours", "segment": "Tour / Activity Operator", "priority": "P2", "role_type": "Decision maker",
     "competitor": "No", "lead_review": "After research"},
    {"ext_id": "C002", "name": "Sam Roe", "title": "CEO", "email": "sam@example.com", "company": "Example Boat Tours",
     "segment": "Tour / Activity Operator", "priority": "P1", "competitor": "No", "lead_review": "Yes"},
    {"ext_id": "C003", "name": "Pat Poe", "title": "Partnerships", "email": "pat@example.org", "company": "Example Booking",
     "segment": "Booking Platform / Connectivity", "priority": "P2", "competitor": "No"},
    {"ext_id": "C004", "name": "Rival Person", "title": "CEO", "email": "x@rival.example", "company": "Rival Pricing",
     "segment": "Other Technology", "priority": "Skip", "competitor": "Yes - do not contact"},
]
RESEARCH = [{"company": "Example Boat Tours", "website": "https://example.com", "booking_platform": "FareHarbor",
             "example_tour": "Sunset cruise", "listed_price": "$89", "sources": "https://example.com/tours"}]


def client(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def imported(admin_api, ws):
    create_pipeline(ws["tenant"].id, "Integrations", "partners")
    r = admin_api.post("/api/sales-pipeline/outreach/import/", {"campaign": CAMPAIGN, "contacts": ROWS, "research": RESEARCH}, format="json")
    assert r.status_code == 200, r.data
    return r.data


def row(api, ext):
    return next(x for x in api.get("/api/sales-pipeline/outreach/").data if x["ext_id"] == ext)


def ready(admin_api, api, ext="C001"):
    """Verify the company research and the person."""
    c = row(api, ext)
    assert admin_api.patch(f"/api/sales-pipeline/outreach/companies/{c['company']['id']}/research/", {"verified": True}, format="json").status_code == 200
    r = api.patch(f"/api/sales-pipeline/outreach/contacts/{c['id']}/", {"verify": {"company": True, "person": True, "contact_info": True}}, format="json")
    assert r.status_code == 200
    return r.data


def test_import_one_deal_per_company_routed_by_segment(imported, api, ws):
    assert imported == {"companies_created": 3, "deals_created": 3, "contacts_created": 4, "contacts_updated": 0, "skipped": 0}
    boat = Deal.objects.get(company__name="Example Boat Tours")
    assert boat.pipeline == ws["pipeline"] and boat.stage == "s1" and boat.event == CAMPAIGN
    assert Deal.objects.get(company__name="Example Booking").pipeline.template == "partners"
    rival = Deal.objects.get(company__name="Rival Pricing")
    assert rival.stage == "lost" and rival.company.category == "competitor"
    assert Company.objects.get(name="Example Boat Tours").research["listed_price"] == "$89"
    assert row(api, "C004")["next"]["key"] == "none"
    assert row(api, "C001")["next"]["key"] == "verify"


def test_reimport_updates_instead_of_duplicating(imported, admin_api):
    again = admin_api.post("/api/sales-pipeline/outreach/import/", {"campaign": CAMPAIGN, "contacts": ROWS}, format="json").data
    assert again["contacts_created"] == 0 and again["contacts_updated"] == 4 and again["deals_created"] == 0
    assert Contact.objects.filter(campaign=CAMPAIGN).count() == 4


def test_duplicate_row_does_not_overwrite_the_original(imported, admin_api):
    dup = {**ROWS[0], "ext_id": "C010", "priority": "Skip"}
    admin_api.post("/api/sales-pipeline/outreach/import/", {"campaign": CAMPAIGN, "contacts": [dup]}, format="json")
    assert Contact.objects.get(ext_id="C001").priority == "P2"
    assert Contact.objects.get(ext_id="C010").priority == "Skip"


def test_import_is_admin_only(api):
    assert api.post("/api/sales-pipeline/outreach/import/", {"campaign": CAMPAIGN, "contacts": ROWS}, format="json").status_code == 403


def test_no_draft_before_verification(imported, api):
    c = row(api, "C001")
    r = api.post(f"/api/sales-pipeline/outreach/contacts/{c['id']}/drafts/", {"channel": "li_msg", "body": "Hi"}, format="json")
    assert r.status_code == 409 and r.data["code"] == "research_not_verified"


def test_research_change_undoes_verification(imported, admin_api, api):
    c = ready(admin_api, api)
    assert c["next"]["key"] == "write"
    r = api.patch(f"/api/sales-pipeline/outreach/companies/{c['company']['id']}/research/", {"research": {"listed_price": "$99"}}, format="json")
    assert r.data[0]["company"]["research_verified_at"] == ""


def test_paste_approve_send_flow(imported, admin_api, api, ws):
    c = ready(admin_api, api)
    cid = c["id"]
    # Can't tick Sent without an approved draft
    r = api.post(f"/api/sales-pipeline/outreach/contacts/{cid}/step/", {"step": "li_msg", "value": today.isoformat()}, format="json")
    assert r.data["code"] == "no_approved_draft"
    c = api.post(f"/api/sales-pipeline/outreach/contacts/{cid}/drafts/", {"channel": "li_msg", "body": "Hi Jane"}, format="json").data
    d = c["drafts"][0]
    assert d["status"] == "pending" and c["next"]["key"] == "approval"
    # Param isn't an approver
    assert api.patch(f"/api/sales-pipeline/outreach/drafts/{d['id']}/", {"action": "approve"}, format="json").data["code"] == "not_approver"
    # Manjit made an approver by the admin; asks for changes, then approves the fix
    manjit = ws["users"]["manjit"]
    assert admin_api.patch(f"/api/sales-pipeline/users/{manjit.id}/", {"can_approve_outreach": True}, format="json").data["can_approve"]
    manjit.refresh_from_db()
    m = client(manjit)
    c = m.patch(f"/api/sales-pipeline/outreach/drafts/{d['id']}/", {"action": "changes", "note": "Name the tour"}, format="json").data
    assert c["next"]["key"] == "fix"
    api.patch(f"/api/sales-pipeline/outreach/drafts/{d['id']}/", {"body": "Hi Jane, about the Sunset cruise"}, format="json")
    c = m.patch(f"/api/sales-pipeline/outreach/drafts/{d['id']}/", {"action": "approve"}, format="json").data
    assert c["drafts"][0]["status"] == "approved" and c["next"]["key"] == "send"
    c = api.post(f"/api/sales-pipeline/outreach/contacts/{cid}/step/", {"step": "li_msg", "value": today.isoformat()}, format="json").data
    assert c["drafts"][0]["status"] == "sent" and c["steps"]["li_msg"] == today.isoformat()
    assert c["next"]["key"] == "ask_linkedin" and c["follow_up_due"] == (today + timedelta(2)).isoformat()
    deal = Deal.objects.get(company__name="Example Boat Tours")
    assert deal.activities.filter(text__startswith="LinkedIn: message sent").exists()


def test_self_approval_blocked(imported, admin_api, api, ws):
    c = ready(admin_api, api)
    manjit = ws["users"]["manjit"]
    manjit.can_approve_outreach = True
    manjit.save()
    m = client(manjit)
    c = m.post(f"/api/sales-pipeline/outreach/contacts/{c['id']}/drafts/", {"channel": "email", "subject": "Hi", "body": "Hello"}, format="json").data
    assert c["steps"]["em_draft"] == today.isoformat()
    r = m.patch(f"/api/sales-pipeline/outreach/drafts/{c['drafts'][0]['id']}/", {"action": "approve"}, format="json")
    assert r.data["code"] == "self_approval"


def test_p1_only_owner(imported, admin_api, api, ws):
    c = ready(admin_api, api, "C002")
    r = api.post(f"/api/sales-pipeline/outreach/contacts/{c['id']}/drafts/", {"channel": "email", "body": "Hi"}, format="json")
    assert r.data["code"] == "p1_owner_missing"
    nikunj = ws["users"]["nikunj"]
    admin_api.patch("/api/sales-pipeline/settings/", {"outreach": {"p1_user_id": str(nikunj.id)}}, format="json")
    r = api.post(f"/api/sales-pipeline/outreach/contacts/{c['id']}/drafts/", {"channel": "email", "body": "Hi"}, format="json")
    assert r.status_code == 403 and r.data["code"] == "p1_only"
    # The P1 owner may send without a draft
    c = admin_api.post(f"/api/sales-pipeline/outreach/contacts/{c['id']}/step/", {"step": "li_note", "value": today.isoformat()}, format="json").data
    assert c["steps"]["li_note"] == today.isoformat()
    # Only an admin changes the priority (so P1 can't be downgraded to get around it)
    assert api.patch(f"/api/sales-pipeline/outreach/contacts/{c['id']}/", {"priority": "P3"}, format="json").status_code == 403


def test_one_arival_app_sender(imported, admin_api, api, ws):
    c = ready(admin_api, api)
    # Only the people picked in Settings send Arival app messages
    api.post(f"/api/sales-pipeline/outreach/contacts/{c['id']}/drafts/", {"channel": "app", "body": "Hi"}, format="json")
    d = OutreachDraft.objects.get(contact_id=c["id"], status="pending")
    admin_api.patch(f"/api/sales-pipeline/outreach/drafts/{d.id}/", {"action": "approve"}, format="json")
    r = api.post(f"/api/sales-pipeline/outreach/contacts/{c['id']}/step/", {"step": "app_sent", "value": today.isoformat()}, format="json")
    assert r.status_code == 403 and r.data["code"] == "not_app_sender"
    senders = [str(ws["users"][n].id) for n in ("param", "guddu")]
    assert admin_api.patch("/api/sales-pipeline/settings/", {"outreach": {"app_sender_ids": senders}}, format="json").data["outreach"]["app_sender_ids"] == senders
    for _ in range(2):
        c = api.post(f"/api/sales-pipeline/outreach/contacts/{c['id']}/drafts/", {"channel": "app", "body": "Hi"}, format="json").data
        admin_api.patch(f"/api/sales-pipeline/outreach/drafts/{c['drafts'][-1]['id']}/", {"action": "approve"}, format="json")
        if c["steps"].get("app_sent"):
            break
        c = api.post(f"/api/sales-pipeline/outreach/contacts/{c['id']}/step/", {"step": "app_sent", "value": today.isoformat()}, format="json").data
    assert c["app_sender_name"] == "Param"
    g = client(ws["users"]["guddu"])
    api.post(f"/api/sales-pipeline/outreach/contacts/{c['id']}/drafts/", {"channel": "app", "body": "Hi again"}, format="json")
    d = OutreachDraft.objects.filter(contact_id=c["id"], status="pending").first()
    admin_api.patch(f"/api/sales-pipeline/outreach/drafts/{d.id}/", {"action": "approve"}, format="json")
    r = g.post(f"/api/sales-pipeline/outreach/contacts/{c['id']}/step/", {"step": "app_sent", "value": today.isoformat()}, format="json")
    assert r.status_code == 409 and r.data["code"] == "other_sender"


def test_skip_and_competitor_never_messaged(imported, api):
    c = row(api, "C004")
    r = api.post(f"/api/sales-pipeline/outreach/contacts/{c['id']}/drafts/", {"channel": "email", "body": "Hi"}, format="json")
    assert r.data["code"] == "do_not_contact"


def test_linkedin_no_reply_two_days_then_email(imported, admin_api, api):
    ready(admin_api, api)
    ct = Contact.objects.get(ext_id="C001")
    ct.steps = {"li_msg": (today - timedelta(1)).isoformat()}
    ct.save()
    assert o.next_action(ct, [])["key"] == "ask_linkedin"
    c = api.post(f"/api/sales-pipeline/outreach/contacts/{ct.id}/reply-check/", {"channel": "linkedin", "replied": False}, format="json").data
    assert c["next"]["key"] == "wait"
    ct.refresh_from_db()
    assert o.next_action(ct, [], today + timedelta(1))["key"] == "email"
    # Email sent: follow-up after 7 days
    ct.steps = {**ct.steps, "em_sent": today.isoformat()}
    assert o.next_action(ct, [], today + timedelta(7))["key"] == "follow"
    c = api.post(f"/api/sales-pipeline/outreach/contacts/{ct.id}/reply-check/", {"channel": "email", "replied": True}, format="json").data
    assert c["next"]["key"] == "book"
