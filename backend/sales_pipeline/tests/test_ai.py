"""AI drafts with a fake Claude client: no network, no cost."""
from types import SimpleNamespace

import anthropic
import httpx2
import pytest

from sales_pipeline.models import AiDraftLog
from sales_pipeline.services import ai

from .test_api import new_deal


class FakeMessages:
    def __init__(self):
        self.calls = []
        self.next_error = None

    def _usage(self):
        return SimpleNamespace(input_tokens=120, output_tokens=40, cache_read_input_tokens=0)

    def create(self, **kw):
        self.calls.append(("create", kw))
        if self.next_error:
            raise self.next_error
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text="Subject: Hi\n\nDraft body")], usage=self._usage())

    def parse(self, **kw):
        self.calls.append(("parse", kw))
        schema = kw["output_format"]
        if schema is ai.ReplyTag:
            parsed = ai.ReplyTag(tag="interested", interest="Hot", objection="", summary="Wants a demo", response="Great, here's [booking link]")
        else:
            parsed = ai.CallSummary(needs=["Less manual pricing"], objections=[], booking_platform="FareHarbor", locations="2",
                                    decision_maker="Owner", budget_signals="", next_step="Snapshot call", follow_up_email="Thanks!")
        return SimpleNamespace(stop_reason="end_turn", parsed_output=parsed, usage=self._usage())


@pytest.fixture
def fake(settings, monkeypatch):
    settings.AI_ENABLED = True
    settings.AI_MODEL_FAST = "claude-haiku-4-5"
    settings.AI_MODEL_SMART = "claude-sonnet-4-6"
    msgs = FakeMessages()
    monkeypatch.setattr(ai, "_client", SimpleNamespace(messages=msgs))
    return msgs


def draft(api, deal_id, **body):
    return api.post(f"/api/sales-pipeline/deals/{deal_id}/ai-draft/", body, format="json")


def test_first_message_uses_writing_model(api, ws, fake):
    d = new_deal(api, ws)["deal"]
    r = draft(api, d["id"], action="first")
    assert r.status_code == 200, r.data
    assert r.data["text"].startswith("Subject: Hi")
    kind, kw = fake.calls[0]
    assert kind == "create" and kw["model"] == "claude-sonnet-4-6"
    assert kw["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "Test Harbor Tours" in kw["messages"][0]["content"]
    log = AiDraftLog.objects.get()
    assert log.ok and log.input_tokens == 120 and log.model == "claude-sonnet-4-6"


def test_tag_reply_is_structured(api, ws, fake):
    d = new_deal(api, ws)["deal"]
    r = draft(api, d["id"], action="tag", pasted="Yes please, send times")
    assert r.status_code == 200 and r.data["tag"] == "interested"
    assert "Tag: Interested (Hot)" in r.data["text"]
    kind, kw = fake.calls[0]
    assert kind == "parse" and kw["model"] == "claude-haiku-4-5" and kw["output_format"] is ai.ReplyTag
    assert "Yes please, send times" in kw["messages"][0]["content"]


def test_summary_formats_notes(api, ws, fake):
    d = new_deal(api, ws)["deal"]
    r = draft(api, d["id"], action="summary", pasted="Owner, 2 locations, on FareHarbor")
    assert "Booking platform: FareHarbor" in r.data["text"] and "- Less manual pricing" in r.data["text"]


def test_rate_limit_maps_to_code_and_is_logged(api, ws, fake):
    d = new_deal(api, ws)["deal"]
    req = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    fake.next_error = anthropic.RateLimitError("slow down", response=httpx2.Response(429, request=req), body=None)
    r = draft(api, d["id"], action="next")
    assert r.status_code == 429 and r.data["code"] == "rate_limited"
    assert AiDraftLog.objects.get().error_code == "rate_limited"


def test_ai_off_without_key(api, ws, settings):
    settings.AI_ENABLED = False
    d = new_deal(api, ws)["deal"]
    r = draft(api, d["id"], action="brief")
    assert r.status_code == 503 and r.data["code"] == "not_granted"


def test_viewer_cannot_use_ai(ws, fake):
    from rest_framework.test import APIClient

    from core.models import PipelineRole
    u = ws["users"]["guddu"]
    u.pipeline_role = PipelineRole.VIEWER
    u.save()
    c = APIClient()
    c.force_authenticate(u)
    assert c.post("/api/sales-pipeline/deals/00000000-0000-0000-0000-000000000000/ai-draft/", {"action": "next"}, format="json").status_code == 403


def test_other_tenant_cannot_draft_on_my_deal(api, ws, fake):
    from rest_framework.test import APIClient

    from .conftest import make_tenant
    d = new_deal(api, ws)["deal"]
    _, other_users, _ = make_tenant("othertours")
    c = APIClient()
    c.force_authenticate(other_users["param"])
    assert draft(c, d["id"], action="first").status_code == 404
    assert fake.calls == []
