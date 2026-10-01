"""
Speed to lead after the booth. Two moments are stamped on the deal the first time
they happen, so dashboards and alerts read one field instead of re-deriving them:

- first_touch_at: the team reached out. An email, call or meeting logged on the deal
  (not the booth conversation itself), or a person ticking an outreach task: the
  booth follow-up, the "send what was offered" tasks, the first message, a reply.
- demo_at: a demo was booked or held (a demo booked at the booth counts, at the booth).

Tier A leads still untouched after TIER_A_TOUCH_HOURS alert the owner and the GTM lead
(alerts.check_tier_a).
"""
from datetime import timedelta

from django.utils import timezone

from ..config import TIER_A_TOUCH_HOURS, TOUCH_ACTIVITY_TYPES, TOUCH_TASK_RULES
from ..models import Deal, Task
from .scoring import score

# Older untouched leads were dealt with (or not) long ago: no alert storm on the first run
ALERT_LOOKBACK_DAYS = 14


def mark_first_touch(deal_id, at=None) -> None:
    Deal.objects.filter(id=deal_id, first_touch_at__isnull=True).update(first_touch_at=at or timezone.now())


def mark_demo(deal_id, at=None) -> None:
    Deal.objects.filter(id=deal_id, demo_at__isnull=True).update(demo_at=at or timezone.now())


def on_activity(deal_id, type_: str, at=None) -> None:
    if type_ in TOUCH_ACTIVITY_TYPES:
        mark_first_touch(deal_id, at)


def on_task_done(task: Task) -> None:
    if task.deal_id and task.done and not task.auto_closed and task.rule in TOUCH_TASK_RULES:
        mark_first_touch(task.deal_id, task.done_at)


def untouched_tier_a(tenant_id, now=None) -> list[Deal]:
    now = now or timezone.now()
    qs = (Deal.objects.filter(tenant_id=tenant_id, is_sample=False, booth__visitor="operator", first_touch_at__isnull=True,
                              created_at__lte=now - timedelta(hours=TIER_A_TOUCH_HOURS),
                              created_at__gte=now - timedelta(days=ALERT_LOOKBACK_DAYS))
          .exclude(stage__in=["lost", "nurture"]).select_related("company", "owner"))
    # The tier isn't stored (only the answers are): score them, as the board does
    return [d for d in qs if score("operator", d.booth.get("answers") or {}).tier == "A"]
