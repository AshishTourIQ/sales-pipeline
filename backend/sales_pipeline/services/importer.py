"""
Lead Tracker import. The browser parses the CSV and sends normalised rows
(see frontend lib/csv.ts); the server validates, dedupes and creates records.
"""
import math
from datetime import date, datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from ..models import Company, Contact, Deal
from . import stages
from .deals import Actor, _history, _task, add_activity, fit_score
from .errors import ServiceError
from .pipelines import stage_def

User = get_user_model()
MAX_ROWS = 5000


def _date(v: str) -> date | None:
    try:
        return date.fromisoformat(v) if v else None
    except ValueError:
        return None


@transaction.atomic
def import_rows(tenant_id, pipeline, actor: Actor, rows: list[dict]) -> dict:
    if len(rows) > MAX_ROWS:
        raise ServiceError(f"Import at most {MAX_ROWS} rows at a time.", code="too_many_rows")
    existing = {n.lower() for n in Deal.objects.filter(tenant_id=tenant_id, pipeline=pipeline).values_list("company__name", flat=True)}
    users = {u.username.lower(): u for u in User.objects.filter(tenant_id=tenant_id)}
    users.update({u.display_name.lower(): u for u in users.values()})
    label = Actor(actor.user, f"{actor.name} (import)" if actor.name else "Lead Tracker import")
    created = skipped = 0

    for r in rows:
        name = (r.get("company") or "").strip()
        if not name:
            continue
        if name.lower() in existing:
            skipped += 1
            continue
        existing.add(name.lower())
        # Lead Tracker stages are built-in keys; a removed one maps to the next stage that exists
        stage = stages.resolve(pipeline, r.get("stage") or "s1")
        last = _date(r.get("last", ""))
        at = timezone.make_aware(datetime.combine(last, time(12))) if last else timezone.now()
        owner = users.get((r.get("owner") or "").strip().lower())
        if owner is None:
            oid = stage_def(pipeline, stage).owner_id
            owner = User.objects.filter(id=oid).first() if oid else None

        company = Company.objects.create(
            tenant_id=tenant_id, name=name, region=r.get("region", ""), segment=r.get("segment", ""),
            platform=r.get("platform", ""), reachable=bool(r.get("email") or r.get("linkedin")),
        )
        contact = None
        if r.get("contact") or r.get("email"):
            contact = Contact.objects.create(
                tenant_id=tenant_id, company=company, name=r.get("contact", ""), title=r.get("title", ""),
                email=r.get("email", ""), linkedin=r.get("linkedin", ""),
            )
        try:
            fit = float(r["fit"]) if r.get("fit") not in (None, "") else float(fit_score(company))
        except (TypeError, ValueError):
            fit = float(fit_score(company))
        fit = min(max(fit, 0.0), 5.0) if math.isfinite(fit) else float(fit_score(company))
        paid = bool(r.get("paid"))
        next_date = _date(r.get("next_date", ""))
        deal = Deal.objects.create(
            tenant_id=tenant_id, pipeline=pipeline, company=company, contact=contact, stage=stage, stage_changed_at=at,
            owner=owner, source=r.get("source", ""), fit=round(fit, 1), snapshot_sent=bool(r.get("snap")),
            demo_date=f"{r['demo']}T09:00" if _date(r.get("demo", "")) else "",
            payment={"status": "Paid" if paid else "Invoiced" if stages.reached_or_past(pipeline, stage, "s11") else "Not invoiced"},
            loss_reason="Other" if stage == "lost" else "",
            reengage_date=(next_date or timezone.localdate() + timedelta(days=60)) if stage == "nurture" else None,
            created_by=actor.user, created_at=at,
        )
        _history(deal, "", stage, label, at=at)
        if r.get("notes"):
            add_activity(deal, "note", r["notes"], label, at=at)
        add_activity(deal, "note", "Imported from the Lead Tracker", label)
        if r.get("next"):
            _task(deal, r["next"], owner, next_date, actor, auto=False, stage=stage)
        fu = _date(r.get("fu", ""))
        if fu:
            _task(deal, "Follow-up call or meeting", owner, fu, actor, auto=False, stage=stage)
        created += 1
    return {"created": created, "skipped": skipped}
