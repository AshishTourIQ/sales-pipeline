"""Intake API: the game / analysis / audit tools post events with a per-tenant key."""
from rest_framework.test import APIClient

from sales_pipeline.models import Contact, Deal, Touchpoint

from .conftest import make_tenant
from .test_api import new_deal

URL = "/api/sales-pipeline/intake/"


def make_key(admin_api, name="Pricing game") -> str:
    r = admin_api.post("/api/sales-pipeline/intake-keys/", {"name": name}, format="json")
    assert r.status_code == 201, r.data
    assert r.data["secret"].startswith("spk.") and r.data["key"]["prefix"] in r.data["secret"]
    return r.data["secret"]


def post(key, body, header="bearer"):
    c = APIClient()
    kw = {"HTTP_AUTHORIZATION": f"Bearer {key}"} if header == "bearer" else {"HTTP_X_INTAKE_KEY": key}
    return c.post(URL, body, format="json", **kw)


GAME = {"event": "game_played", "event_id": "game-1", "score": "912", "link": "https://game.touriq.test/r/1",
        "contact": {"name": "Ana Reef", "email": "Ana@ReefTours.test"}, "company": {"name": "Reef Tours", "website": "https://www.reeftours.test"}}


def test_new_lead_lands_in_offer_sent(admin_api, ws):
    key = make_key(admin_api)
    r = post(key, GAME)
    assert r.status_code == 201, r.data
    assert r.data["created"] is True and r.data["stage"] == "offer"
    d = Deal.objects.get(id=r.data["deal_id"])
    assert (d.source, d.track, d.company.name, d.contact.email) == ("Game", "game", "Reef Tours", "ana@reeftours.test")
    tp = Touchpoint.objects.get(deal=d)
    assert (tp.kind, tp.source, tp.score, tp.link) == ("game_played", "intake", "912", "https://game.touriq.test/r/1")
    assert "Intake: Pricing game" in tp.by_name


def test_same_event_twice_is_recorded_once(admin_api, ws):
    key = make_key(admin_api)
    a = post(key, GAME).data
    b = post(key, GAME).data
    assert b["duplicate"] is True and a["deal_id"] == b["deal_id"]
    assert Touchpoint.objects.filter(external_id="game-1").count() == 1


def test_existing_lead_matched_by_email_and_moved(api, admin_api, ws):
    d = new_deal(api, ws)["deal"]  # s5, contact jo@example.com
    key = make_key(admin_api, "Audit tool")
    r = post(key, {"event": "audit_submitted", "contact": {"email": "JO@example.com"}}, header="x")
    assert r.status_code == 200 and r.data["deal_id"] == d["id"] and r.data["created"] is False
    deal = Deal.objects.get(id=d["id"])
    assert deal.stage == "offer" and deal.track == "audit"
    assert "Sent booking data for the audit (Audit tool)." in [a.text for a in deal.activities.all()]


def test_matched_by_website_domain(api, admin_api, ws):
    d = new_deal(api, ws, company={"name": "Blue Fin", "website": "bluefin.test"})["deal"]
    r = post(make_key(admin_api), {"event": "analysis_viewed", "company": {"name": "Blue Fin Charters", "website": "https://www.bluefin.test/tours"}})
    assert r.data["deal_id"] == d["id"]


def test_demo_request_moves_to_demo_booked(api, admin_api, ws):
    d = new_deal(api, ws)["deal"]
    post(make_key(admin_api), {"event": "demo_requested", "contact": {"email": "jo@example.com"}})
    assert Deal.objects.get(id=d["id"]).stage == "s6"


def test_later_stage_never_moves_back(api, admin_api, ws):
    d = new_deal(api, ws)["deal"]
    Deal.objects.filter(id=d["id"]).update(stage="s9")
    post(make_key(admin_api), GAME | {"contact": {"email": "jo@example.com"}, "event_id": ""})
    assert Deal.objects.get(id=d["id"]).stage == "s9"


def test_competitor_never_reopened(admin_api, api, ws):
    r = api.post("/api/sales-pipeline/deals/booth/", {
        "pipeline_id": str(ws["pipeline"].id), "company": "Rival Pricing", "visitor": "competitor",
        "contact": {"email": "spy@rival.test"}}, format="json")
    lost_id = r.data["deal"]["id"]
    out = post(make_key(admin_api), {"event": "game_played", "contact": {"email": "spy@rival.test"}})
    assert out.data["deal_id"] == lost_id and out.data["created"] is False
    assert Deal.objects.get(id=lost_id).stage == "lost"
    assert Deal.objects.filter(contact__email="spy@rival.test").count() == 1


def test_bad_keys(admin_api, ws):
    assert post("nope", GAME).status_code == 401
    key = make_key(admin_api)
    assert post(key[:-2] + "xx", GAME).status_code == 401
    kid = admin_api.get("/api/sales-pipeline/intake-keys/").data[0]["id"]
    assert admin_api.delete(f"/api/sales-pipeline/intake-keys/{kid}/").status_code == 204
    assert post(key, GAME).status_code == 401  # revoked


def test_key_only_reaches_its_own_tenant(admin_api, ws):
    key = make_key(admin_api)
    other, _, _ = make_tenant("other")
    # Swap the tenant id in the key: the secret doesn't exist there
    forged = ".".join(["spk", str(other.id), key.split(".", 2)[2]])
    assert post(forged, GAME).status_code == 401


def test_needs_email_or_company(admin_api, ws):
    r = post(make_key(admin_api), {"event": "game_played", "contact": {"name": "No Email"}})
    assert r.status_code == 400


def test_keys_admin_only(api, ws):
    assert api.get("/api/sales-pipeline/intake-keys/").status_code == 403
    assert api.post("/api/sales-pipeline/intake-keys/", {"name": "x"}, format="json").status_code == 403


def test_rate_limited(admin_api, ws, settings):
    from django.core.cache import cache

    cache.clear()
    settings.INTAKE_RATE = "2/min"
    key = make_key(admin_api)
    codes = [post(key, GAME | {"event_id": f"e{i}"}).status_code for i in range(3)]
    assert codes[-1] == 429
    cache.clear()


def test_manual_touchpoint(api, ws):
    d = new_deal(api, ws)["deal"]
    r = api.post(f"/api/sales-pipeline/deals/{d['id']}/touchpoints/", {"kind": "audit_report_sent", "link": "https://r.test/a"}, format="json")
    assert r.status_code == 201
    assert [(t["kind"], t["source"]) for t in r.data["touchpoints"]] == [("audit_report_sent", "manual")]
    assert Contact.objects.filter(email="jo@example.com").count() == 1


def test_unknown_event_is_refused_not_a_crash(admin_api, ws):
    r = post(make_key(admin_api), GAME | {"event": "bogus", "event_id": "bad-1"})
    assert r.status_code == 400 and "event" in str(r.data)
    assert not Deal.objects.exists()


def test_trade_show_is_stored_as_the_deal_event(admin_api, ws):
    r = post(make_key(admin_api), GAME | {"trade_show": "Arival 2026"})
    assert r.status_code == 201, r.data
    assert Deal.objects.get(id=r.data["deal_id"]).event == "Arival 2026"
    # Without it the tool event kind is never stored as the trade show
    r = post(make_key(admin_api, "Audit"), {"event": "audit_submitted", "contact": {"email": "new@lead.test"}})
    assert Deal.objects.get(id=r.data["deal_id"]).event == ""
