"""
Celery jobs. Each job loops over tenants and runs inside tenant_context, so
Row-Level Security applies exactly as it does for web requests.
Schedule: CELERY_BEAT_SCHEDULE in config/settings.py.
"""
import logging

from celery import shared_task

from core.models import Tenant
from core.tenancy import tenant_context

from .services import alerts

log = logging.getLogger(__name__)


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
    """Stuck deals, nurture due, late payments. Each check commits on its own, so
    a failure in one never rolls back the 'already sent' records of another."""
    out = {}
    for name, check in (("stuck", alerts.check_stuck), ("nurture", alerts.check_nurture), ("late_payments", alerts.check_late_payments)):
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
    return _each_tenant(run)


@shared_task(name="sales_pipeline.prune_alerts")
def prune_alerts_task():
    return _each_tenant(alerts.prune_alerts)
