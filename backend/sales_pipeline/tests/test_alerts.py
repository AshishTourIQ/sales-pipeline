"""Scheduled checks: each breach is reported once, to the right people."""
from datetime import timedelta

import pytest
from django.utils import timezone

from sales_pipeline import tasks
from sales_pipeline.models import Deal, Task
from sales_pipeline.services import alerts, notify

from .test_api import new_deal


@pytest.fixture(autouse=True)
def clean_outbox(settings):
    settings.GTM_LEAD_EMAIL = "gunin@touriq.test"
    notify.OUTBOX.clear()
    yield
    notify.OUTBOX.clear()


def age(deal_id, days):
    Deal.objects.filter(id=deal_id).update(stage_changed_at=timezone.now() - timedelta(days=days))


def test_stuck_deal_alerts_owner_and_gtm_once(api, ws):
    d = new_deal(api, ws)["deal"]  # stage 5 Replied, limit 2 days, owner Param
    age(d["id"], 5)
    r = alerts.RunReport()
    alerts.check_stuck(ws["tenant"].id, r)
    assert r.stuck == 1
    to = sorted(e.to[0] for e in notify.OUTBOX)
    assert to == ["gunin@touriq.test", "param@touriq.test"]
    assert "Test Harbor Tours" in notify.OUTBOX[0].text and "?deal=" in notify.OUTBOX[0].text
    # second run: already reported
    notify.OUTBOX.clear()
    alerts.check_stuck(ws["tenant"].id, alerts.RunReport())
    assert notify.OUTBOX == []


def test_moving_stage_resets_the_alert(api, ws):
    d = new_deal(api, ws)["deal"]
    age(d["id"], 5)
    alerts.check_stuck(ws["tenant"].id, alerts.RunReport())
    from .test_api import finish_stage
    finish_stage(api, d["id"])  # auto-advances to s6
    age(d["id"], 10)  # demo booked limit is 7
    notify.OUTBOX.clear()
    r = alerts.RunReport()
    alerts.check_stuck(ws["tenant"].id, r)
    assert r.stuck == 1  # a new breach in a new stage is reported again


def test_within_limit_no_alert(api, ws):
    new_deal(api, ws)
    r = alerts.RunReport()
    alerts.check_stuck(ws["tenant"].id, r)
    assert r.stuck == 0 and notify.OUTBOX == []


def test_nurture_due_emails_owner(api, ws):
    d = new_deal(api, ws)["deal"]
    api.post(f"/api/sales-pipeline/deals/{d['id']}/move/", {"to": "nurture", "reengage_date": timezone.localdate().isoformat()}, format="json")
    r = alerts.RunReport()
    alerts.check_nurture(ws["tenant"].id, r)
    assert r.nurture == 1 and notify.OUTBOX[0].to == ["param@touriq.test"]


def test_late_payment_creates_one_task(api, ws):
    d = new_deal(api, ws)["deal"]
    api.patch(f"/api/sales-pipeline/deals/{d['id']}/", {"payment": {"status": "Late", "invoice": "INV-7"}}, format="json")
    for _ in range(2):
        alerts.check_late_payments(ws["tenant"].id, alerts.RunReport())
    t = Task.objects.get(deal_id=d["id"], title__contains="INV-7")
    assert t.blocking is False  # a reminder: never blocks the stage (e.g. going live from onboarding)


def test_email_failure_does_not_undo_the_run(api, ws, settings, monkeypatch):
    """A failed send is logged; other recipients' alerts stay claimed, so nobody is re-emailed next run."""
    from django.core.mail import EmailMultiAlternatives

    from sales_pipeline.models import DealAlert

    def down(self, fail_silently=False):
        raise OSError("SMTP server is down")

    monkeypatch.setattr(EmailMultiAlternatives, "send", down)
    settings.EMAIL_ENABLED, settings.EMAIL_HOST_USER = True, "alerts@touriq.test"
    d = new_deal(api, ws)["deal"]
    age(d["id"], 5)
    alerts.check_stuck(ws["tenant"].id, alerts.RunReport())  # must not raise
    assert DealAlert.objects.filter(deal_id=d["id"]).count() == 1


def test_digest_lists_due_tasks(api, ws):
    d = new_deal(api, ws)["deal"]  # booth tasks due in 2 days: not in the digest
    Task.objects.filter(deal_id=d["id"], title__startswith="Follow up").update(due=timezone.localdate() - timedelta(days=1))
    r = alerts.RunReport()
    alerts.send_digests(ws["tenant"].id, r)
    assert r.digests == 1
    assert notify.OUTBOX[0].to == ["param@touriq.test"] and "1 overdue" in notify.OUTBOX[0].text


def test_sample_deals_never_alert(api, ws):
    api.post(f"/api/sales-pipeline/pipelines/{ws['pipeline'].id}/samples/")
    Deal.objects.update(stage_changed_at=timezone.now() - timedelta(days=60))
    r = alerts.RunReport()
    alerts.check_stuck(ws["tenant"].id, r)
    assert r.stuck == 0


def test_celery_task_runs_per_tenant(api, ws):
    d = new_deal(api, ws)["deal"]
    age(d["id"], 5)
    out = tasks.run_checks_task.apply().get()
    assert out["stuck"]["touriq"]["stuck"] == 1
