"""
Celery jobs. Each job loops over tenants and runs inside tenant_context, so
Row-Level Security applies exactly as it does for web requests.
Schedule: CELERY_BEAT_SCHEDULE in config/settings.py.
"""
import logging
from contextlib import contextmanager

from celery import shared_task
from django.core.cache import cache

from core.models import Tenant
from core.tenancy import tenant_context

from .services import alerts

log = logging.getLogger(__name__)


@contextmanager
def single_run(name: str, minutes: int):
    """Skip a scheduled job while the previous run is still going (a slow run must not overlap the next).
    The lock expires by itself, so a killed worker can't block the job for good."""
    key = f"job-lock:{name}"
    got = cache.add(key, "1", minutes * 60)
    try:
        yield got
    finally:
        if got:
            cache.delete(key)


def _each_tenant(fn):
    results = {}
    for t in Tenant.objects.all().only("id", "slug"):
        try:
            with tenant_context(t.id):
                results[t.slug] = fn(t.id)
        except Exception:  # one tenant failing must not stop the others
            log.exception("Job failed for tenant %s", t.slug)
            results[t.slug] = "error"
    return results


@shared_task(name="sales_pipeline.run_checks")
def run_checks_task():
    """Stuck deals, nurture due, late payments, untouched Tier A leads. Each check commits on its own, so
    a failure in one never rolls back the 'already sent' records of another."""
    with single_run("run_checks", 30) as mine:
        if not mine:
            return "skipped: still running"
        return _run_checks()


def _run_checks():
    out = {}
    for name, check in (("stuck", alerts.check_stuck), ("nurture", alerts.check_nurture), ("late_payments", alerts.check_late_payments),
                        ("tier_a", alerts.check_tier_a)):
        def run(tid, check=check):
            r = alerts.RunReport()
            check(tid, r)
            return vars(r)
        out[name] = _each_tenant(run)
    return out


@shared_task(name="sales_pipeline.daily_digest")
def daily_digest_task():
    def run(tid):
        r = alerts.RunReport()
        alerts.send_digests(tid, r)
        return r.digests
    with single_run("daily_digest", 60) as mine:
        return _each_tenant(run) if mine else "skipped: still running"


@shared_task(name="sales_pipeline.prune_alerts")
def prune_alerts_task():
    return _each_tenant(alerts.prune_alerts)


# ---------- Google Calendar and Recall (queued by the services, not scheduled) ----------

@shared_task(name="sales_pipeline.sync_calendar", bind=True, max_retries=3)
def sync_calendar_task(self, tenant_id, deal_id, event_id=""):
    """Create / move / remove a deal's calendar event. event_id: for a deal that was deleted.
    Google down or slow: tried again after 1, 2 and 4 minutes. A bad demo date isn't retried."""
    from .models import Deal
    from .services import calendar
    from .services.errors import ServiceError

    try:
        with tenant_context(tenant_id):
            deal = Deal.objects.filter(id=deal_id).select_related("company", "contact", "owner").first()
            if deal is None:
                if event_id:
                    calendar.delete_event(event_id)
                return "gone"
            return calendar.sync_deal(deal)
    except ServiceError as e:
        if e.code in ("bad_demo_date", "calendar_off"):
            log.warning("Calendar sync skipped for deal %s: %s", deal_id, e)
            return e.code
        raise self.retry(exc=e, countdown=60 * 2 ** self.request.retries)
    except Exception as e:  # network errors
        raise self.retry(exc=e, countdown=60 * 2 ** self.request.retries)


@shared_task(name="sales_pipeline.process_recording")
def process_recording_task(tenant_id, meeting_id):
    from .services import recall

    return recall.process(tenant_id, meeting_id)


@shared_task(name="sales_pipeline.summarise_recording")
def summarise_recording_task(tenant_id, meeting_id):
    from .models import RecallMeeting
    from .services import recall

    with tenant_context(tenant_id):
        m = RecallMeeting.objects.filter(id=meeting_id).values("deal_id", "transcript").first()
    if m and m["deal_id"]:
        recall.summarise(tenant_id, m["deal_id"], m["transcript"])


@shared_task(name="sales_pipeline.process_pending_recordings")
def process_pending_recordings_task():
    """Recordings still waiting (worker was down, or the transcript wasn't ready yet)."""
    from .services import recall

    if not recall.enabled():
        return {}
    with single_run("process_pending_recordings", 30) as mine:
        return _process_pending() if mine else "skipped: still running"


def _process_pending() -> dict:
    from datetime import timedelta

    from django.utils import timezone

    from .models import RecallMeeting
    from .services import recall

    # process() opens its own tenant transactions (and calls Claude outside them)
    out = {}
    now = timezone.now()
    for t in Tenant.objects.all().only("id", "slug"):
        try:
            with tenant_context(t.id):
                # A run that died mid-way (worker killed, time limit) gets another go
                RecallMeeting.objects.filter(status="processing", updated_at__lt=now - timedelta(minutes=recall.STALE_PROCESSING_MINUTES)).update(
                    status="pending", updated_at=now - timedelta(minutes=5))
                ids = list(RecallMeeting.objects.filter(status="pending", attempts__lt=recall.MAX_ATTEMPTS + 1,
                                                        updated_at__lt=now - timedelta(minutes=2)).values_list("id", flat=True)[:20])
            out[t.slug] = [recall.process(t.id, i) for i in ids]
        except Exception:
            log.exception("Recording retry failed for tenant %s", t.slug)
            out[t.slug] = "error"
    return out
