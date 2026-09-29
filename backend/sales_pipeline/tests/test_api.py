"""End-to-end through the API, in the exact wire format the frontend uses."""
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APIClient

from core.models import PipelineRole
from sales_pipeline.models import Deal, StageHistory, Task

from .conftest import make_tenant


def new_deal(api, ws, **over):
    body = {
        "pipeline_id": str(ws["pipeline"].id), "entry_stage": "s5", "source": "Arival booth", "interest": "Hot",
        "owner_id": str(ws["users"]["param"].id),
        "company": {"name": "Test Harbor Tours", "segment": "Water / boat", "platform": "FareHarbor", "products5": True, "sells_out": False, "reachable": True},
        "contact": {"name": "Jo Test", "title": "Owner", "email": "jo@example.com", "decision_maker": False},
        "note": "Met at the booth",
    }
    body.update(over)
    r = api.post("/api/sales-pipeline/deals/", body, format="json")
    assert r.status_code == 201, r.data
    return r.data


def finish_stage(api, deal_id):
    """Tick every open task of the deal's current stage (the last tick auto-advances)."""
    stage = Deal.objects.get(id=deal_id).stage
    last = None
    for t in Task.objects.filter(deal_id=deal_id, stage=stage, done=False, blocking=True):
        last = api.patch(f"/api/sales-pipeline/tasks/{t.id}/", {"done": True}, format="json")
    return last


def test_booth_capture(api, ws):
    r = new_deal(api, ws)
    d = r["deal"]
    assert d["stage"] == "s5" and d["fit"] == 4.0
    assert [t["title"] for t in r["tasks_created"]] == ["Book the demo: tick when it's booked", "Follow up within 48 hours (booth lead)"]
    assert d["history"][0]["to"] == "s5" and d["history"][0]["from"] is None
    assert d["activities"][0]["text"] == "Met at the booth"


def test_forward_move_blocked_until_tasks_done(api, ws):
    d = new_deal(api, ws)["deal"]
    r = api.post(f"/api/sales-pipeline/deals/{d['id']}/move/", {"to": "s6"}, format="json")
    assert r.status_code == 409 and r.data["code"] == "stage_tasks_open"
    assert "2 open tasks" in r.data["detail"]
    assert Deal.objects.get(id=d["id"]).stage == "s5"


def test_last_tick_auto_advances_with_automation(api, ws):
    d = new_deal(api, ws)["deal"]
    r = finish_stage(api, d["id"])
    assert r.status_code == 200, r.data
    adv = r.data["advanced"]
    moved = adv["deal"]
    assert moved["stage"] == "s6"
    assert moved["owner_id"] == str(ws["users"]["manjit"].id)  # stage owner hand-off
    assert [t["title"] for t in adv["tasks_created"]][-1] == "Hold the demo: tick when it's done"
    assert [h["to"] for h in moved["history"]] == ["s5", "s6"]
    assert "tasks done" in moved["history"][1]["by_name"]


def test_first_tick_does_not_advance(api, ws):
    d = new_deal(api, ws)["deal"]
    t = Task.objects.filter(deal_id=d["id"], blocking=True).first()
    r = api.patch(f"/api/sales-pipeline/tasks/{t.id}/", {"done": True}, format="json")
    assert r.data["advanced"] is None and Deal.objects.get(id=d["id"]).stage == "s5"


def test_lanes_and_backward_always_allowed(api, ws):
    d = new_deal(api, ws)["deal"]
    assert api.post(f"/api/sales-pipeline/deals/{d['id']}/move/", {"to": "s2"}, format="json").status_code == 200
    d2 = new_deal(api, ws, company={"name": "Another Co"})["deal"]
    assert api.post(f"/api/sales-pipeline/deals/{d2['id']}/move/", {"to": "nurture", "reengage_date": "2030-01-01"}, format="json").status_code == 200


def test_reminders_do_not_block(api, ws):
    d = new_deal(api, ws, company={"name": "Outbound Co"}, entry_stage="s4", source="Pre-show outreach")["deal"]
    r = finish_stage(api, d["id"])
    assert r.data["advanced"]["deal"]["stage"] == "s5"
    assert Task.objects.filter(deal_id=d["id"], stage="s4", blocking=False, done=True, auto_closed=True).count() == 3


def test_checklist_also_blocks_and_advances(api, ws):
    d = new_deal(api, ws)["deal"]
    Deal.objects.filter(id=d["id"]).update(stage="s8")
    Task.objects.filter(deal_id=d["id"]).update(done=True)
    r = api.post(f"/api/sales-pipeline/deals/{d['id']}/move/", {"to": "s9"}, format="json")
    assert r.status_code == 409 and "5 checklist items" in r.data["detail"]
    r = api.patch(f"/api/sales-pipeline/deals/{d['id']}/", {"qual": {"volume": True, "dm": True}}, format="json")
    assert r.data["advanced"] is None
    r = api.patch(f"/api/sales-pipeline/deals/{d['id']}/", {"qual": {k: True for k in ["volume", "dm", "platform", "vertical", "budget"]}}, format="json")
    assert r.data["advanced"]["deal"]["stage"] == "s9"


def test_admin_override_needs_reason(api, ws):
    d = new_deal(api, ws)["deal"]
    r = api.post(f"/api/sales-pipeline/deals/{d['id']}/move/", {"to": "s6", "force": True, "override_reason": "Booked by phone"}, format="json")
    assert r.status_code == 403 and r.data["code"] == "override_not_allowed"  # Param is a contributor
    admin = APIClient()
    admin.force_authenticate(ws["users"]["nikunj"])
    r = admin.post(f"/api/sales-pipeline/deals/{d['id']}/move/", {"to": "s6", "force": True}, format="json")
    assert r.data["code"] == "override_reason_required"
    r = admin.post(f"/api/sales-pipeline/deals/{d['id']}/move/", {"to": "s6", "force": True, "override_reason": "Booked by phone"}, format="json")
    assert r.status_code == 200 and r.data["deal"]["stage"] == "s6"
    assert any("admin override" in a["text"] and "Booked by phone" in a["text"] for a in r.data["deal"]["activities"])


def test_stage_task_applies_to_current_and_future_deals(admin_api, ws):
    api = admin_api  # pipeline set-up is admin-only
    guddu = ws["users"]["guddu"]
    pid = str(ws["pipeline"].id)
    existing = new_deal(api, ws, company={"name": "Old Co"}, entry_stage="s1", source="Outbound list", owner_id=str(guddu.id))["deal"]
    other = new_deal(api, ws, company={"name": "Param Co"}, entry_stage="s1", source="Outbound list")["deal"]  # owned by Param
    r = api.post("/api/sales-pipeline/stage-tasks/", {"pipeline_id": pid, "stage": "s1", "owner_id": str(guddu.id), "title": "Check the website", "due_in_days": 2}, format="json")
    assert r.status_code == 201, r.data
    assert [t["deal_id"] for t in r.data["tasks_created"]] == [existing["id"]]
    assert not Task.objects.filter(deal_id=other["id"], title="Check the website").exists()
    # stage 1 has no automatic tasks: ticking the stage task moves it to 2
    t = Task.objects.get(deal_id=existing["id"], title="Check the website")
    adv = api.patch(f"/api/sales-pipeline/tasks/{t.id}/", {"done": True}, format="json").data["advanced"]
    assert adv["deal"]["stage"] == "s2"
    # future deals owned by Guddu entering stage 1 get it too
    new = new_deal(api, ws, company={"name": "New Co"}, entry_stage="s1", source="Outbound list", owner_id=str(guddu.id))
    assert "Check the website" in [t["title"] for t in new["tasks_created"]]
    # removing the stage task removes open copies
    tid = api.get(f"/api/sales-pipeline/stage-tasks/?pipeline={pid}").data[0]["id"]
    removed = api.delete(f"/api/sales-pipeline/stage-tasks/{tid}/").data["tasks_removed"]
    assert len(removed) == 1 and not Task.objects.filter(deal_id=new["deal"]["id"], title="Check the website").exists()


def test_stage_task_rejects_lanes(admin_api, ws):
    api = admin_api  # pipeline set-up is admin-only
    r = api.post("/api/sales-pipeline/stage-tasks/", {"pipeline_id": str(ws["pipeline"].id), "stage": "lost", "owner_id": str(ws["users"]["param"].id), "title": "x"}, format="json")
    assert r.status_code == 400 and r.data["code"] == "invalid_stage"


def test_lost_requires_reason_and_changes_nothing(api, ws):
    d = new_deal(api, ws)["deal"]
    r = api.post(f"/api/sales-pipeline/deals/{d['id']}/move/", {"to": "lost"}, format="json")
    assert r.status_code == 400 and r.data["code"] == "loss_reason_required"
    assert Deal.objects.get(id=d["id"]).stage == "s5"
    assert StageHistory.objects.filter(deal_id=d["id"]).count() == 1
    r = api.post(f"/api/sales-pipeline/deals/{d['id']}/move/", {"to": "lost", "loss_reason": "Unsubscribed"}, format="json")
    assert r.status_code == 200 and r.data["deal"]["loss_reason"] == "Unsubscribed"
    assert r.data["tasks_created"] == []  # no review for unsubscribes


def test_signed_sets_payment(api, ws):
    d = new_deal(api, ws)["deal"]
    admin = APIClient()
    admin.force_authenticate(ws["users"]["nikunj"])
    admin.post(f"/api/sales-pipeline/deals/{d['id']}/move/", {"to": "s10", "force": True, "override_reason": "test"}, format="json")
    r = finish_stage(api, d["id"])
    moved = r.data["advanced"]["deal"]
    assert moved["stage"] == "s11" and moved["payment"]["status"] == "Invoiced"
    assert moved["signed_at"] == timezone.localdate().isoformat()


def test_patch_company_recomputes_fit(api, ws):
    d = new_deal(api, ws)["deal"]
    r = api.patch(f"/api/sales-pipeline/deals/{d['id']}/", {"company": {"platform": "Peek Pro"}, "reengage_date": ""}, format="json")
    assert r.status_code == 200, r.data
    assert r.data["deal"]["fit"] == 3.5 and r.data["deal"]["company"]["platform"] == "Peek Pro"


def test_tasks_crud(api, ws):
    d = new_deal(api, ws)["deal"]
    r = api.post("/api/sales-pipeline/tasks/", {"pipeline_id": str(ws["pipeline"].id), "deal_id": d["id"], "title": "Send the Snapshot", "owner_id": "", "due": ""}, format="json")
    assert r.status_code == 201, r.data
    t = r.data
    r = api.patch(f"/api/sales-pipeline/tasks/{t['id']}/", {"done": True}, format="json")
    assert r.data["task"]["done"] is True and r.data["task"]["done_at"]
    assert api.delete(f"/api/sales-pipeline/tasks/{t['id']}/").status_code == 204


def test_settings_and_team(admin_api, ws):
    api = admin_api  # pipeline set-up is admin-only
    r = api.get("/api/sales-pipeline/settings/")
    assert {m["name"] for m in r.data["team"]} == {"Nikunj", "Param", "Manjit", "Guddu"}
    r = api.patch("/api/sales-pipeline/settings/", {"rules": {"r_capture48": False}, "targets": {"leads": 500}}, format="json")
    assert r.data["rules"]["r_capture48"] is False and r.data["targets"]["leads"] == 500
    r = api.patch("/api/sales-pipeline/settings/", {"team": [{"id": "not-a-user", "name": "X"}]}, format="json")
    assert r.status_code == 400 and r.data["code"] == "unknown_team_member"


def test_pipeline_stage_overrides(admin_api, ws):
    api = admin_api  # pipeline set-up is admin-only
    pid = ws["pipeline"].id
    r = api.patch(f"/api/sales-pipeline/pipelines/{pid}/", {"pilot_enabled": False, "stages": [{"key": "s4", "name": "Emailed", "limit": 10, "owner_id": ""}]}, format="json")
    assert r.status_code == 200, r.data
    s4 = next(x for x in r.data["stages"] if x["key"] == "s4")
    assert (s4["name"], s4["limit"], s4["owner_id"]) == ("Emailed", 10, "")
    d = new_deal(api, ws)["deal"]
    r = api.post(f"/api/sales-pipeline/deals/{d['id']}/move/", {"to": "pilot"}, format="json")
    assert r.status_code == 400 and r.data["code"] == "invalid_stage"


def test_import_dedupes(admin_api, ws):
    api = admin_api  # pipeline set-up is admin-only
    rows = [{"company": "Blue Lagoon Tours", "stage": "s4", "owner": "Guddu", "next": "Call them", "next_date": "2030-01-01"},
            {"company": "Blue Lagoon Tours", "stage": "s4"}, {"company": "Kayak Kings", "stage": "nurture"}]
    r = api.post(f"/api/sales-pipeline/pipelines/{ws['pipeline'].id}/import/", {"rows": rows}, format="json")
    assert r.data == {"created": 2, "skipped": 1}
    blue = Deal.objects.get(company__name="Blue Lagoon Tours")
    assert blue.owner == ws["users"]["guddu"] and Task.objects.filter(deal=blue, title="Call them").exists()


def test_samples(admin_api, ws):
    api = admin_api  # pipeline set-up is admin-only
    pid = ws["pipeline"].id
    assert api.post(f"/api/sales-pipeline/pipelines/{pid}/samples/").data == {"created": 14}
    r = api.get(f"/api/sales-pipeline/deals/?pipeline={pid}")
    assert len(r.data) == 14 and all(d["sample"] for d in r.data)
    assert api.delete(f"/api/sales-pipeline/pipelines/{pid}/samples/").data == {"removed": 14}


def test_viewer_is_read_only(ws):
    viewer = ws["users"]["guddu"]
    viewer.pipeline_role = PipelineRole.VIEWER
    viewer.save()
    c = APIClient()
    c.force_authenticate(viewer)
    assert c.get("/api/sales-pipeline/deals/").status_code == 200
    r = c.post("/api/sales-pipeline/tasks/", {"pipeline_id": str(ws["pipeline"].id), "title": "x"}, format="json")
    assert r.status_code == 403


def test_no_role_no_access(ws):
    u = ws["users"]["guddu"]
    u.pipeline_role = PipelineRole.NONE
    u.save()
    c = APIClient()
    c.force_authenticate(u)
    assert c.get("/api/sales-pipeline/deals/").status_code == 403


def test_users_endpoint_and_team_picker(admin_api, ws):
    api = admin_api  # pipeline set-up is admin-only
    from django.contrib.auth import get_user_model
    get_user_model().objects.create_user(email="new@touriq.test", password="x-Test-12345", username="newbie", full_name="New Rep",
                                         tenant=ws["tenant"], pipeline_role=PipelineRole.CONTRIBUTOR, is_sales_team=False)
    users = api.get("/api/sales-pipeline/users/").data
    new = next(u for u in users if u["email"] == "new@touriq.test")
    assert new["is_sales_team"] is False
    team = api.get("/api/sales-pipeline/settings/").data["team"]
    r = api.patch("/api/sales-pipeline/settings/", {"team": team + [{"id": new["id"], "name": "New Rep"}]}, format="json")
    assert "New Rep" in {m["name"] for m in r.data["team"]}



# ---------------- adding and removing stages ----------------

def stages_of(api, ws):
    return next(p for p in api.get("/api/sales-pipeline/pipelines/").data if p["id"] == str(ws["pipeline"].id))["stages"]


def test_add_custom_stage_after_qualified(admin_api, ws):
    api = admin_api  # pipeline set-up is admin-only
    pid = ws["pipeline"].id
    r = api.post(f"/api/sales-pipeline/pipelines/{pid}/stages/", {"name": "Security review", "phase": "win", "after": "s8", "limit": 5, "owner_id": str(ws["users"]["manjit"].id)}, format="json")
    assert r.status_code == 201, r.data
    key = r.data["stage"]["key"]
    keys = [x["key"] for x in stages_of(api, ws)]
    assert keys[keys.index("s8") + 1] == key and keys[-2:] == ["nurture", "lost"]
    # a deal finishing Qualified now goes to the new stage, owned by Manjit
    d = new_deal(api, ws)["deal"]
    Deal.objects.filter(id=d["id"]).update(stage="s8", qual={k: True for k in ["volume", "dm", "platform", "vertical", "budget"]})
    Task.objects.filter(deal_id=d["id"]).update(done=True)
    t = Task.objects.create(tenant=ws["tenant"], pipeline=ws["pipeline"], deal_id=d["id"], title="x", stage="s8", created_at=timezone.now())
    adv = api.patch(f"/api/sales-pipeline/tasks/{t.id}/", {"done": True}, format="json").data["advanced"]
    assert adv["deal"]["stage"] == key and adv["deal"]["owner_id"] == str(ws["users"]["manjit"].id)
    # custom stages have no automatic tasks; a stage task for it works
    assert adv["tasks_created"] == []
    r = api.post("/api/sales-pipeline/stage-tasks/", {"pipeline_id": str(pid), "stage": key, "owner_id": str(ws["users"]["manjit"].id), "title": "Send the security pack"}, format="json")
    assert r.status_code == 201 and len(r.data["tasks_created"]) == 1


def test_duplicate_or_bad_stage_rejected(admin_api, ws):
    api = admin_api  # pipeline set-up is admin-only
    pid = ws["pipeline"].id
    assert api.post(f"/api/sales-pipeline/pipelines/{pid}/stages/", {"name": "Qualified", "phase": "win"}, format="json").data["code"] == "duplicate_name"
    assert api.post(f"/api/sales-pipeline/pipelines/{pid}/stages/", {"name": "X", "phase": "win", "after": "lost"}, format="json").data["code"] == "invalid_position"


def test_remove_stage_moves_its_deals(admin_api, ws):
    api = admin_api  # pipeline set-up is admin-only
    pid = ws["pipeline"].id
    d = new_deal(api, ws)["deal"]  # in s5 (Replied)
    r = api.post(f"/api/sales-pipeline/pipelines/{pid}/stages/s5/remove/", {}, format="json")
    assert r.status_code == 400 and r.data["code"] == "move_to_required"
    r = api.post(f"/api/sales-pipeline/pipelines/{pid}/stages/s5/remove/", {"move_to": "s6"}, format="json")
    assert r.status_code == 200 and r.data["moved"] == 1
    assert "s5" not in [x["key"] for x in r.data["pipeline"]["stages"]]
    deal = api.get(f"/api/sales-pipeline/deals/{d['id']}/").data
    assert deal["stage"] == "s6" and "removed" in deal["history"][-1]["by_name"]
    assert not Task.objects.filter(deal_id=d["id"], stage="s5", done=False).exists()
    # booth leads (which entered at 5) now start at the next stage that exists
    assert new_deal(api, ws, company={"name": "After Removal Co"}, entry_stage="s6")["deal"]["stage"] == "s6"
    from sales_pipeline.services import stages as st
    ws["pipeline"].refresh_from_db()
    assert st.entry_for_source(ws["pipeline"], "Arival booth") == "s6"


def test_cannot_remove_lanes_or_last_stage(admin_api, ws):
    api = admin_api  # pipeline set-up is admin-only
    pid = ws["pipeline"].id
    assert api.post(f"/api/sales-pipeline/pipelines/{pid}/stages/lost/remove/", {}, format="json").data["code"] == "invalid_stage"
    keys = [x["key"] for x in stages_of(api, ws) if not x.get("lane")]
    for k in keys[:-1]:
        api.post(f"/api/sales-pipeline/pipelines/{pid}/stages/{k}/remove/", {"move_to": keys[-1]}, format="json")
    r = api.post(f"/api/sales-pipeline/pipelines/{pid}/stages/{keys[-1]}/remove/", {}, format="json")
    assert r.data["code"] == "last_stage"


def test_numbers_follow_order_after_removal(admin_api, ws):
    api = admin_api  # pipeline set-up is admin-only
    from sales_pipeline.services import stages as st
    pid = ws["pipeline"].id
    api.post(f"/api/sales-pipeline/pipelines/{pid}/stages/s2/remove/", {}, format="json")
    ws["pipeline"].refresh_from_db()
    nums = {s.key: s.num for s in st.resolved(ws["pipeline"])}
    assert nums["s3"] == 2 and nums["s13"] == 12 and nums["pilot"] is None


# ---------- roles, routing and error shape ----------

def test_contributor_cannot_change_setup(api, ws):
    """Param (contributor) works deals and tasks, but pipeline set-up is admin-only."""
    pid = ws["pipeline"].id
    base = "/api/sales-pipeline"
    blocked = [
        ("patch", "/settings/", {"targets": {"leads": 5}}),
        ("post", "/pipelines/", {"name": "Second"}),
        ("patch", f"/pipelines/{pid}/", {"name": "Renamed"}),
        ("post", f"/pipelines/{pid}/stages/", {"name": "Extra", "phase": "win"}),
        ("post", f"/pipelines/{pid}/stages/s5/remove/", {"move_to": "s6"}),
        ("post", f"/pipelines/{pid}/import/", {"rows": [{"company": "X"}]}),
        ("post", f"/pipelines/{pid}/samples/", {}),
        ("delete", f"/pipelines/{pid}/samples/", None),
        ("post", "/stage-tasks/", {"pipeline_id": str(pid), "stage": "s1", "owner_id": str(ws["users"]["param"].id), "title": "X"}),
    ]
    for method, path, body in blocked:
        r = getattr(api, method)(base + path, body, format="json")
        assert r.status_code == 403 and r.data["code"] == "admin_only", (method, path, r.data)
    # everyday work still allowed
    d = new_deal(api, ws)["deal"]
    assert api.post(f"{base}/tasks/", {"pipeline_id": str(pid), "deal_id": d["id"], "title": "Call"}, format="json").status_code == 201
    assert api.get(f"{base}/settings/").status_code == 200


def test_viewer_403_says_read_only(ws):
    viewer = ws["users"]["guddu"]
    viewer.pipeline_role = PipelineRole.VIEWER
    viewer.save()
    c = APIClient()
    c.force_authenticate(viewer)
    r = c.post("/api/sales-pipeline/deals/", {}, format="json")
    assert r.status_code == 403 and r.data["code"] == "read_only"


def test_sub_routes_only_route_their_own_verb(api, ws):
    d = new_deal(api, ws)["deal"]
    for sub in ("move", "activities", "expansion"):
        assert api.delete(f"/api/sales-pipeline/deals/{d['id']}/{sub}/").status_code == 405
        assert api.patch(f"/api/sales-pipeline/deals/{d['id']}/{sub}/", {}, format="json").status_code == 405
    assert Deal.objects.filter(id=d["id"]).exists()
    # ai-draft runs outside the request transaction, so check it last (its 405 poisons the test's transaction)
    assert api.delete(f"/api/sales-pipeline/deals/{d['id']}/ai-draft/").status_code == 405


def test_import_error_names_the_bad_row(admin_api, ws):
    rows = [{"company": "Fine Co"}, {"company": "Bad Co", "source": "x" * 200}]
    r = admin_api.post(f"/api/sales-pipeline/pipelines/{ws['pipeline'].id}/import/", {"rows": rows}, format="json")
    assert r.status_code == 400 and r.data["detail"].startswith("rows: row 2, source:"), r.data


def test_import_clamps_fit(admin_api, ws):
    r = admin_api.post(f"/api/sales-pipeline/pipelines/{ws['pipeline'].id}/import/", {"rows": [{"company": "Big Fit", "fit": "100"}]}, format="json")
    assert r.status_code == 200 and Deal.objects.get(company__name="Big Fit").fit == 5


def test_bad_uuid_filter_is_400_not_500(api, ws):
    r = api.get("/api/sales-pipeline/deals/?pipeline=not-a-uuid")
    assert r.status_code == 400 and r.data["code"] == "invalid"


def test_expansion_when_replied_stage_removed(admin_api, ws):
    pid = ws["pipeline"].id
    d = new_deal(admin_api, ws, entry_stage="s6")["deal"]
    admin_api.post(f"/api/sales-pipeline/pipelines/{pid}/stages/s5/remove/", {"move_to": "s6"}, format="json")
    r = admin_api.post(f"/api/sales-pipeline/deals/{d['id']}/expansion/", {}, format="json")
    assert r.status_code == 201 and r.data["deal"]["stage"] == "s6"


def test_me_reports_admin_and_ai(api, ws, settings):
    settings.AI_ENABLED = False
    me = api.get("/api/auth/me/").data
    assert me["can_write"] is True and me["can_admin"] is False and me["ai_enabled"] is False
    admin = APIClient()
    admin.force_authenticate(ws["users"]["nikunj"])
    assert admin.get("/api/auth/me/").data["can_admin"] is True
