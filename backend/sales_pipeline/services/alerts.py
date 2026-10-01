"""
Scheduled checks (run by Celery Beat, one tenant at a time inside tenant_context).

- stuck deals     → email the owner AND the GTM lead, once per breach
- nurture due     → email the owner once per check-back date
- late payment    → a task for the owner (never blocks onboarding), once per invoice
- daily digest    → each team member's overdue + due-today tasks
- Tier A untouched → email the owner AND the GTM lead when nobody reached out in time

Each alert is recorded in DealAlert first; the unique (deal, kind) constraint
means a breach is only ever reported once, even if jobs overlap or retry.
"""
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.utils import timezone

from ..config import TIER_A_TOUCH_HOURS
from ..models import Deal, DealAlert, Task
from .deals import Actor, _task
from .flags import days_in_stage, over_limit, payment_late, reengage_due
from .notify import deal_url, render, send_email
from .pipelines import stage_def, team_users
from .speed import untouched_tier_a

User = get_user_model()
SYSTEM = Actor(None, "Pipeline automation")


@dataclass
class RunReport:
    stuck: int = 0
    nurture: int = 0
    late_payment_tasks: int = 0
    tier_a: int = 0
    emails: int = 0
    digests: int = 0
    details: list[str] = field(default_factory=list)


def _claim(deal: Deal, kind: str) -> bool:
    """Record an alert; False if it was already sent before."""
    try:
        with transaction.atomic():
            DealAlert.objects.create(tenant_id=deal.tenant_id, deal=deal, kind=kind[:40])
        return True
    except IntegrityError:
        return False


def _active_deals(tenant_id):
    return Deal.objects.filter(tenant_id=tenant_id, is_sample=False).select_related("company", "pipeline", "owner")


def check_stuck(tenant_id, report: RunReport) -> None:
    by_recipient: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for d in _active_deals(tenant_id).exclude(stage__in=["nurture", "lost", "s13"]):
        over, days, limit = over_limit(d)
        if not over or not _claim(d, f"stuck:{d.stage}:{d.stage_changed_at:%Y%m%d%H%M}"):
            continue
        report.stuck += 1
        row = (
            d.company.name,
            f"{stage_def(d.pipeline, d.stage).name}: {days} days in stage (limit {limit}). Owner: {d.owner.display_name if d.owner else 'nobody'}",
            deal_url(d.id),
        )
        for to in {getattr(d.owner, "email", ""), settings.GTM_LEAD_EMAIL}:
            if to:
                by_recipient[to].append(row)
    for to, rows in by_recipient.items():
        html, text = render(
            f"{len(rows)} deal{'s' if len(rows) != 1 else ''} past the stage time limit",
            "These deals have been in their stage longer than the playbook allows. Pick a next step or move them on.",
            rows,
        )
        send_email([to], f"Stuck deals: {', '.join(r[0] for r in rows[:3])}{'…' if len(rows) > 3 else ''}", html, text)
        report.emails += 1


def check_nurture(tenant_id, report: RunReport) -> None:
    by_owner: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for d in _active_deals(tenant_id).filter(stage="nurture", reengage_date__isnull=False):
        if not reengage_due(d) or not _claim(d, f"nurture:{d.reengage_date:%Y%m%d}"):
            continue
        report.nurture += 1
        if d.owner and d.owner.email:
            by_owner[d.owner.email].append((d.company.name, f"Check-back date {d.reengage_date:%d %b}. Reason: {d.nurture_reason or 'not set'}", deal_url(d.id)))
    for to, rows in by_owner.items():
        html, text = render("Time to re-engage", "These Nurture deals reached their check-back date. A fresh Pricing Snapshot is a good reason to reach out.", rows)
        send_email([to], f"Re-engage: {', '.join(r[0] for r in rows[:3])}", html, text)
        report.emails += 1


def check_late_payments(tenant_id, report: RunReport) -> None:
    for d in _active_deals(tenant_id):
        if not payment_late(d):
            continue
        invoice = (d.payment or {}).get("invoice") or "first"
        if not _claim(d, f"late:{invoice}"):
            continue
        _task(d, f"Chase the late payment (invoice {invoice})", d.owner, timezone.localdate(), SYSTEM, auto=False, blocking=False)
        report.late_payment_tasks += 1


def check_tier_a(tenant_id, report: RunReport) -> None:
    by_recipient: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    now = timezone.now()
    for d in untouched_tier_a(tenant_id, now):
        if not _claim(d, "tier_a_untouched"):
            continue
        report.tier_a += 1
        hours = int((now - d.created_at).total_seconds() // 3600)
        row = (d.company.name, f"Tier A, met {hours} hours ago; nobody has reached out yet. Owner: {d.owner.display_name if d.owner else 'nobody'}",
               deal_url(d.id))
        for to in {getattr(d.owner, "email", ""), settings.GTM_LEAD_EMAIL}:
            if to:
                by_recipient[to].append(row)
    for to, rows in by_recipient.items():
        html, text = render(
            f"{len(rows)} Tier A lead{'s' if len(rows) != 1 else ''} not contacted",
            f"The best leads from the booth, and nobody has emailed, called or ticked the follow-up within {TIER_A_TOUCH_HOURS} hours.",
            rows,
        )
        send_email([to], f"Tier A not contacted: {', '.join(r[0] for r in rows[:3])}{'…' if len(rows) > 3 else ''}", html, text)
        report.emails += 1


def send_digests(tenant_id, report: RunReport) -> None:
    today = timezone.localdate()
    for u in team_users(tenant_id):
        if not u.email:
            continue
        tasks = list(
            Task.objects.filter(tenant_id=tenant_id, owner=u, done=False, due__lte=today, is_sample=False)
            .select_related("deal__company").order_by("due")
        )
        if not tasks:
            continue
        overdue = sum(1 for t in tasks if t.due < today)
        rows = [
            (t.title, f"{t.deal.company.name if t.deal else 'No deal'} · {'due today' if t.due == today else f'{(today - t.due).days}d overdue'}",
             deal_url(t.deal_id) if t.deal_id else settings.FRONTEND_URL)
            for t in tasks
        ]
        html, text = render(
            f"Good morning {u.display_name}: {len(tasks)} task{'s' if len(tasks) != 1 else ''} for today",
            f"{overdue} overdue, {len(tasks) - overdue} due today.",
            rows,
        )
        send_email([u.email], f"Your pipeline today: {len(tasks)} tasks ({overdue} overdue)", html, text)
        report.digests += 1


def run_checks(tenant_id) -> RunReport:
    report = RunReport()
    check_stuck(tenant_id, report)
    check_nurture(tenant_id, report)
    check_late_payments(tenant_id, report)
    check_tier_a(tenant_id, report)
    return report


def prune_alerts(tenant_id, days: int = 180) -> int:
    n, _ = DealAlert.objects.filter(tenant_id=tenant_id, sent_at__lt=timezone.now() - timedelta(days=days)).delete()
    return n


__all__ = ["run_checks", "send_digests", "prune_alerts", "RunReport", "days_in_stage"]
