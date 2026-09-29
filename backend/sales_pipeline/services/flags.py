"""
Deal health flags. Same rules as the frontend's computeFlags() (lib/pipeline.ts):
over the stage's day limit, re-engage date passed, late payment.
"""
from django.utils import timezone

from ..models import Deal
from .pipelines import stage_def


def days_in_stage(deal: Deal) -> int:
    return max(0, (timezone.now() - deal.stage_changed_at).days)


def over_limit(deal: Deal) -> tuple[bool, int, int | None]:
    """(is over, days in stage, limit)."""
    sd = stage_def(deal.pipeline, deal.stage)
    days = days_in_stage(deal)
    return (bool(sd.limit) and not sd.lane and days > (sd.limit or 0)), days, sd.limit


def reengage_due(deal: Deal) -> bool:
    return deal.stage == "nurture" and deal.reengage_date is not None and deal.reengage_date <= timezone.localdate()


def payment_late(deal: Deal) -> bool:
    return (deal.payment or {}).get("status") == "Late"
