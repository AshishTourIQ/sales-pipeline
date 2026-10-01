"""Google Calendar events and Recall.ai recorded calls, against fake Google / Recall responses."""
import base64
import hashlib
import hmac
import json
import time

import pytest
from rest_framework.test import APIClient

from sales_pipeline.models import Activity, Deal, RecallMeeting
from sales_pipeline.services import calendar, recall

from .test_api import new_deal

SECRET = "whsec_" + base64.b64encode(b"test-secret-key-0123456789").decode()


# ---------- Google Calendar ----------

class FakeResp:
    def __init__(self, status=200, data=None):
        self.status_code, self._data, self.text = status, data or {}, json.dumps(data or {})

    def json(self):
        return self._data


class FakeGoogle:
    def __init__(self, patch_status=200):
        self.calls, self.patch_status = [], patch_status

    def post(self, url, params=None, json=None, timeout=None):
        self.calls.append(("post", url, params, json))
        return FakeResp(200, {"id": "ev1", "hangoutLink": "https://meet.google.com/abc-defg-hij"})

    def patch(self, url, params=None, json=None, timeout=None):
        self.calls.append(("patch", url, params, json))
        return FakeResp(self.patch_status, {"id": "ev1"})

    def delete(self, url, params=None, timeout=None):
        self.calls.append(("delete", url, params, None))
        return FakeResp(204)


@pytest.fixture
def cal(settings):
    settings.CALENDAR_ENABLED = True
    settings.GOOGLE_CALENDAR_ID = "team@group.calendar.google.com"
    settings.GOOGLE_DELEGATED_USER = ""
    settings.CALENDAR_EVENT_MINUTES = 30
    return settings


def test_event_body(api, ws, cal):
    d = new_deal(api, ws, entry_stage="s6", demo_date="2030-01-10T09:00")["deal"]
    deal = Deal.objects.get(id=d["id"])
    body = calendar.event_body(deal)
    assert body["summary"] == "TourIQ demo: Test Harbor Tours"
    assert body["start"]["dateTime"].startswith("2030-01-10T09:00") and body["end"]["dateTime"].startswith("2030-01-10T09:30")
    assert "attendees" not in body and "conferenceData" not in body  # no delegation: calendar only
    assert f"?deal={deal.id}" in body["description"]
    cal.GOOGLE_DELEGATED_USER = "nikunj@touriq.test"
    body = calendar.event_body(deal)
    assert {"email": "jo@example.com"} in body["attendees"] and "conferenceData" in body


def test_arival_meeting_title(api, ws, cal):
    d = new_deal(api, ws, entry_stage="s6", source="Arival app meeting", demo_date="2030-01-10T09:00")["deal"]
    body = calendar.event_body(Deal.objects.get(id=d["id"]))
    assert body["summary"] == "Arival meeting: Test Harbor Tours" and body["location"] == "Arival"


def test_sync_creates_updates_deletes(api, ws, cal):
    d = new_deal(api, ws, entry_stage="s6", demo_date="2030-01-10T09:00")["deal"]
    g = FakeGoogle()
    assert calendar.sync_deal(Deal.objects.get(id=d["id"]), session=g) == "created"
    deal = Deal.objects.get(id=d["id"])
    assert deal.calendar_event_id == "ev1" and deal.meeting_url == "https://meet.google.com/abc-defg-hij"
    assert calendar.sync_deal(deal, session=g) == "updated" and g.calls[-1][0] == "patch"
    # Removed by hand in Google: recreate
    assert calendar.sync_deal(deal, session=FakeGoogle(patch_status=404)) == "updated"
    Deal.objects.filter(id=deal.id).update(stage="lost")
    assert calendar.sync_deal(Deal.objects.get(id=deal.id), session=g) == "deleted"
    assert Deal.objects.get(id=deal.id).calendar_event_id == ""


def test_changes_queue_a_sync(api, ws, cal, monkeypatch, django_capture_on_commit_callbacks):
    from sales_pipeline import tasks

    sent = []
    monkeypatch.setattr(tasks.sync_calendar_task, "apply_async", lambda args, retry=False: sent.append(args))
    with django_capture_on_commit_callbacks(execute=True):
        d = new_deal(api, ws, entry_stage="s6", demo_date="2030-01-10T09:00")["deal"]
    with django_capture_on_commit_callbacks(execute=True):
        api.patch(f"/api/sales-pipeline/deals/{d['id']}/", {"demo_date": "2030-01-11T10:00"}, format="json")
    with django_capture_on_commit_callbacks(execute=True):
        api.patch(f"/api/sales-pipeline/deals/{d['id']}/", {"value": "500"}, format="json")  # not a time change
    assert [a[1] for a in sent] == [d["id"], d["id"]]


def test_calendar_off_is_quiet(api, ws, settings):
    settings.CALENDAR_ENABLED = False
    d = new_deal(api, ws, entry_stage="s6", demo_date="2030-01-10T09:00")["deal"]
    r = api.post(f"/api/sales-pipeline/deals/{d['id']}/calendar-sync/", {}, format="json")
    assert r.status_code == 503 and r.data["code"] == "calendar_off"


# ---------- Recall: webhook signature ----------

def sign(body: bytes, msg_id="msg_1", ts=None):
    ts = str(int(ts or time.time()))
    key = base64.b64decode(SECRET[len("whsec_"):])
    sig = base64.b64encode(hmac.new(key, f"{msg_id}.{ts}.".encode() + body, hashlib.sha256).digest()).decode()
    return {"webhook-id": msg_id, "webhook-timestamp": ts, "webhook-signature": f"v1,{sig}"}


@pytest.fixture
def rec(settings):
    settings.RECALL_ENABLED = True
    settings.RECALL_API_KEY = "key"
    settings.RECALL_WEBHOOK_SECRET = SECRET
    settings.RECALL_WEBHOOK_TOLERANCE_SECONDS = 300
    settings.AI_ENABLED = False
    return settings


def test_signature(rec):
    body = b'{"event":"bot.done"}'
    recall.verify(sign(body), body)
    h = sign(body)
    recall.verify({"svix-id": h["webhook-id"], "svix-timestamp": h["webhook-timestamp"], "svix-signature": "v1,xxx " + h["webhook-signature"]}, body)
    for bad in (sign(b"other"), sign(body, ts=time.time() - 1000), {}):
        with pytest.raises(Exception) as e:
            recall.verify(bad, body)
        assert getattr(e.value, "code", "") == "invalid_signature"


def test_webhook_records_and_queues(ws, rec, monkeypatch, django_capture_on_commit_callbacks):
    queued = []
    monkeypatch.setattr(recall, "queue", lambda name, t, m: queued.append(name))
    body = json.dumps({"event": "transcript.done", "data": {"data": {"code": "done"}, "bot": {"id": "bot-1"},
                                                             "recording": {"id": "rec-1"}, "transcript": {"id": "tr-1"}}}).encode()
    url = f"/api/sales-pipeline/webhooks/recall/{ws['tenant'].id}/"
    h = {f"HTTP_{k.upper().replace('-', '_')}": v for k, v in sign(body).items()}
    r = APIClient().post(url, body, content_type="application/json", **h)
    assert r.status_code == 200, r.data
    m = RecallMeeting.objects.get(bot_id="bot-1")
    assert (m.status, m.recording_id, m.transcript_id) == ("pending", "rec-1", "tr-1") and queued == ["process_recording_task"]
    # Unsigned or ignored events
    assert APIClient().post(url, body, content_type="application/json").status_code == 401
    other = json.dumps({"event": "bot.joining_call", "data": {"bot": {"id": "bot-2"}}}).encode()
    h2 = {f"HTTP_{k.upper().replace('-', '_')}": v for k, v in sign(other).items()}
    assert APIClient().post(url, other, content_type="application/json", **h2).status_code == 200
    assert not RecallMeeting.objects.filter(bot_id="bot-2").exists()


# ---------- Recall: processing ----------

def fake_recall(monkeypatch, *, meeting_url="https://meet.google.com/abc-defg-hij", title="", participants=None, transcript=True):
    participants = participants if participants is not None else [
        {"id": 1, "name": "Jo Rivera", "email": None, "is_host": False},
        {"id": 2, "name": "Nikunj", "email": None, "is_host": True},
    ]
    bot = {"id": "bot-1", "meeting_url": meeting_url, "status_changes": [], "recordings": [{
        "id": "rec-1", "started_at": "2026-10-13T15:00:00Z", "completed_at": "2026-10-13T15:32:00Z",
        "media_shortcuts": {
            "meeting_metadata": {"data": {"title": title}},
            "participant_events": {"data": {"participants_download_url": "https://dl/participants"}},
            "transcript": {"data": {"download_url": "https://dl/transcript"}} if transcript else None,
        }}]}
    words = [
        {"participant": {"name": "Nikunj"}, "words": [{"text": "Thanks"}, {"text": "for"}, {"text": "joining."}]},
        {"participant": {"name": "Jo Rivera"}, "words": [{"text": "How"}, {"text": "much"}, {"text": "is"}, {"text": "it?"}]},
        {"participant": {"name": "Jo Rivera"}, "words": [{"text": "We"}, {"text": "run"}, {"text": "six"}, {"text": "boats."}]},
    ]

    def get(url, auth=True):
        if "/api/v1/bot/" in url:
            assert auth
            return bot
        assert not auth  # download URLs are pre-signed
        return participants if url.endswith("participants") else words
    monkeypatch.setattr(recall, "_get_json", get)


def make_meeting(ws, **kw):
    return RecallMeeting.objects.create(tenant_id=ws["tenant"].id, bot_id="bot-1", recording_id="rec-1", **kw)


def test_matched_by_meeting_link(api, ws, rec, monkeypatch):
    d = new_deal(api, ws)["deal"]
    Deal.objects.filter(id=d["id"]).update(meeting_url="https://meet.google.com/abc-defg-hij?authuser=0")
    fake_recall(monkeypatch)
    m = make_meeting(ws)
    assert recall.process(ws["tenant"].id, m.id) == "logged"
    m.refresh_from_db()
    assert (m.status, m.matched_by, str(m.deal_id)) == ("logged", "meeting_url", d["id"])
    assert m.transcript == "Nikunj: Thanks for joining.\nJo Rivera: How much is it? We run six boats."
    a = Activity.objects.filter(deal_id=d["id"], type="meeting").get()
    assert "Recorded call" in a.text and "32 min" in a.text and "Jo Rivera" in a.text
    assert a.attendees == [str(ws["users"]["nikunj"].id)]  # team members on the call, by name
    # Running again changes nothing
    assert recall.process(ws["tenant"].id, m.id) == "logged"
    assert Activity.objects.filter(deal_id=d["id"], type="meeting").count() == 1


def test_matched_by_title_email_and_name(api, ws, rec, monkeypatch):
    d = new_deal(api, ws)["deal"]
    fake_recall(monkeypatch, meeting_url="https://zoom.us/j/123456789", title="TourIQ demo: Test Harbor Tours")
    assert recall.process(ws["tenant"].id, make_meeting(ws).id) == "logged"
    assert RecallMeeting.objects.get(bot_id="bot-1").matched_by == "title"
    RecallMeeting.objects.all().delete()
    fake_recall(monkeypatch, meeting_url="", participants=[{"name": "Someone", "email": "JO@example.com"}])
    recall.process(ws["tenant"].id, make_meeting(ws).id)
    assert RecallMeeting.objects.get(bot_id="bot-1").matched_by == "email"
    RecallMeeting.objects.all().delete()
    fake_recall(monkeypatch, meeting_url="", participants=[{"name": "jo test", "email": None}, {"name": "Nikunj", "email": None}])
    recall.process(ws["tenant"].id, make_meeting(ws).id)
    m = RecallMeeting.objects.get(bot_id="bot-1")
    assert (m.matched_by, str(m.deal_id)) == ("name", d["id"])


def test_unmatched_then_linked_by_hand(api, ws, rec, monkeypatch):
    fake_recall(monkeypatch, meeting_url="", participants=[{"name": "A Stranger", "email": None}])
    m = make_meeting(ws)
    assert recall.process(ws["tenant"].id, m.id) == "unmatched"
    listed = api.get("/api/sales-pipeline/recordings/").data
    assert [x["id"] for x in listed] == [str(m.id)] and listed[0]["has_transcript"] is True
    d = new_deal(api, ws, company={"name": "Somewhere Else"})["deal"]
    monkeypatch.setattr(recall, "queue", lambda *a: None)
    r = api.post(f"/api/sales-pipeline/recordings/{m.id}/link/", {"deal_id": d["id"]}, format="json")
    assert r.status_code == 200 and r.data["status"] == "logged" and r.data["matched_by"] == "manual"
    assert api.get("/api/sales-pipeline/recordings/").data == []


def test_waits_for_transcript(api, ws, rec, monkeypatch):
    new_deal(api, ws)
    fake_recall(monkeypatch, transcript=False)
    m = make_meeting(ws)  # from bot.done: no transcript id yet
    RecallMeeting.objects.filter(id=m.id).update(recording_id="")
    assert recall.process(ws["tenant"].id, m.id) == "waiting"
    assert RecallMeeting.objects.get(id=m.id).status == "pending"


def test_dismiss(api, ws, rec):
    m = make_meeting(ws, status="unmatched")
    assert api.post(f"/api/sales-pipeline/recordings/{m.id}/dismiss/", {}, format="json").status_code == 204
    assert RecallMeeting.objects.get(id=m.id).status == "dismissed"


def test_meeting_ref():
    assert recall.meeting_ref("https://meet.google.com/abc-defg-hij?authuser=1") == "abc-defg-hij"
    assert recall.meeting_ref({"meeting_id": "abc-defg-hij", "platform": "google_meet"}) == "abc-defg-hij"
    assert recall.meeting_ref("https://us02web.zoom.us/j/81234567890?pwd=x") == "81234567890"
    assert recall.meeting_ref("") == ""


def test_integrations_in_settings(api, ws, rec):
    s = api.get("/api/sales-pipeline/settings/").data["integrations"]
    assert s["recall"] is True and s["recall_webhook_url"].endswith(f"/webhooks/recall/{ws['tenant'].id}/")
