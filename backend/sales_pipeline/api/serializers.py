"""
Wire format = the frontend's TypeScript types (types.ts) in snake_case.
Output serializers shape the response; input serializers validate requests.
"""
from datetime import datetime

from rest_framework import serializers

from ..config import ACTIVITY_TYPES, BOOTH_SOURCES, INTERESTS, LOSS_REASONS, OFFERS, PAY_STATUS, VISITOR_TYPES
from ..models import Deal, Pipeline, Task
from ..services import stages as stage_list
from ..config import CALL_TYPES, CATEGORIES, TEMPLATES, TRACKS
from ..models import Touchpoint
from ..services.booth import booth_out
from ..services.intake import EVENTS
from ..services.touchpoints import touchpoint_out


class DemoDateField(serializers.CharField):
    """"YYYY-MM-DDTHH:mm" (or just the date), or "". Checked here so the calendar job never meets a bad one."""

    def __init__(self, **kw):
        super().__init__(max_length=16, allow_blank=True, **kw)

    def to_internal_value(self, data):
        v = super().to_internal_value(data)
        if v:
            try:
                datetime.fromisoformat(v)
            except ValueError:
                raise serializers.ValidationError("Use a date and time like 2026-10-14T10:30.")
        return v

STAGE_KEY = {"max_length": 16}


def _s(v) -> str:
    return "" if v is None else str(v)


def _d(v) -> str:
    return v.isoformat() if v else ""


# ---------------- output ----------------

class PipelineOut(serializers.ModelSerializer):
    deal_count = serializers.IntegerField(read_only=True, default=0)
    stages = serializers.SerializerMethodField()

    def get_stages(self, obj) -> list[dict]:
        return stage_list.raw_list(obj)

    class Meta:
        model = Pipeline
        fields = ["id", "name", "template", "pilot_enabled", "stages", "created_at", "deal_count"]


def deal_out(d: Deal) -> dict:
    """Plain function (faster than nested serializers for board-sized lists)."""
    c, ct = d.company, d.contact
    return {
        "id": str(d.id),
        "pipeline_id": str(d.pipeline_id),
        "company": {
            "name": c.name, "website": c.website, "region": c.region, "segment": c.segment, "platform": c.platform,
            "products5": c.products5, "sells_out": c.sells_out, "reachable": c.reachable, "category": c.category,
        },
        "contact": {
            "name": ct.name if ct else "", "title": ct.title if ct else "", "email": ct.email if ct else "",
            "phone": ct.phone if ct else "", "linkedin": ct.linkedin if ct else "",
            "decision_maker": ct.decision_maker if ct else False,
        },
        "source": d.source,
        "event": d.event,
        "interest": d.interest,
        "owner_id": _s(d.owner_id),
        "fit": float(d.fit),
        "stage": d.stage,
        "stage_changed_at": _d(d.stage_changed_at),
        "created_at": _d(d.created_at),
        "history": [
            {"from": h.from_stage or None, "to": h.to_stage, "at": _d(h.at), "by_id": _s(h.by_id) or None, "by_name": h.by_name}
            for h in d.history.all()
        ],
        "activities": [
            {"id": str(a.id), "type": a.type, "text": a.text, "at": _d(a.at), "by_id": _s(a.by_id) or None, "by_name": a.by_name,
             "attendee_ids": list(a.attendees or [])}
            for a in d.activities.all()
        ],
        "snapshot_sent": d.snapshot_sent,
        "demo_date": d.demo_date,
        "payment": d.payment or {"status": "Not invoiced"},
        "value": d.value,
        "package": d.package,
        "locations": d.locations,
        "loss_reason": d.loss_reason,
        "loss_competitor": d.loss_competitor,
        "nurture_reason": d.nurture_reason,
        "reengage_date": _d(d.reengage_date),
        "qual": d.qual or {},
        "pilot_checks": d.pilot_checks or {},
        "onboarding": d.onboarding or {},
        "signed_at": _d(d.signed_at),
        "live_at": _d(d.live_at),
        "first_touch_at": _d(d.first_touch_at),
        "demo_at": _d(d.demo_at),
        "sample": d.is_sample,
        "met_by_id": _s(d.met_by_id),
        "booth": booth_out(d.booth),
        "track": d.track,
        "call_type": d.call_type,
        "account_manager_id": _s(d.account_manager_id),
        "links": d.links or [],
        "commission_pct": float(d.commission_pct) if d.commission_pct is not None else None,
        "commission_in_pct": float(d.commission_in_pct) if d.commission_in_pct is not None else None,
        "meeting_url": d.meeting_url,
        "on_calendar": bool(d.calendar_event_id),
        "touchpoints": [touchpoint_out(t) for t in d.touchpoints.all()],
    }


def task_out(t: Task) -> dict:
    return {
        "id": str(t.id), "deal_id": _s(t.deal_id) or None, "pipeline_id": str(t.pipeline_id), "title": t.title,
        "owner_id": _s(t.owner_id), "due": _d(t.due), "done": t.done, "done_at": _d(t.done_at), "auto": t.auto,
        "auto_closed": t.auto_closed, "rule": t.rule or None, "stage": t.stage or None, "created_at": _d(t.created_at),
        "sample": t.is_sample, "blocking": t.blocking, "template_id": _s(t.template_id) or None,
    }


def template_out(t) -> dict:
    return {
        "id": str(t.id), "pipeline_id": str(t.pipeline_id), "stage": t.stage, "owner_id": str(t.owner_id),
        "title": t.title, "due_in_days": t.due_in_days, "created_at": _d(t.created_at),
    }


def deal_queryset(qs):
    return qs.select_related("company", "contact").prefetch_related("history", "activities", "touchpoints")


def result_out_or_none(r) -> dict | None:
    return result_out(r) if r else None


def result_out(r) -> dict:
    deal = deal_queryset(Deal.objects.filter(id=r.deal.id)).get()
    return {"deal": deal_out(deal), "tasks_created": [task_out(t) for t in r.tasks_created], "tasks_closed": r.tasks_closed,
            "notices": list(getattr(r, "notices", []) or [])}


# ---------------- input ----------------

class CompanyIn(serializers.Serializer):
    name = serializers.CharField(max_length=200, allow_blank=True, required=False)
    website = serializers.CharField(max_length=300, allow_blank=True, required=False)
    region = serializers.CharField(max_length=200, allow_blank=True, required=False)
    segment = serializers.CharField(max_length=80, allow_blank=True, required=False)
    platform = serializers.CharField(max_length=80, allow_blank=True, required=False)
    products5 = serializers.BooleanField(required=False)
    sells_out = serializers.BooleanField(required=False)
    reachable = serializers.BooleanField(required=False)
    category = serializers.ChoiceField(choices=[*CATEGORIES, ""], required=False)


class ContactIn(serializers.Serializer):
    name = serializers.CharField(max_length=200, allow_blank=True, required=False)
    title = serializers.CharField(max_length=200, allow_blank=True, required=False)
    email = serializers.EmailField(allow_blank=True, required=False)
    phone = serializers.CharField(max_length=60, allow_blank=True, required=False)
    linkedin = serializers.CharField(max_length=300, allow_blank=True, required=False)
    decision_maker = serializers.BooleanField(required=False)


class DealCreateIn(serializers.Serializer):
    pipeline_id = serializers.UUIDField()
    entry_stage = serializers.CharField(**STAGE_KEY)
    company = CompanyIn()
    contact = ContactIn(required=False)
    source = serializers.CharField(max_length=80, allow_blank=True, required=False, default="")
    interest = serializers.ChoiceField(choices=[*INTERESTS, ""], required=False, default="")
    owner_id = serializers.CharField(allow_blank=True, required=False, default="")
    note = serializers.CharField(allow_blank=True, required=False, default="")
    demo_date = DemoDateField(required=False, default="")
    event = serializers.CharField(max_length=120, allow_blank=True, required=False, default="")


class PaymentIn(serializers.Serializer):
    status = serializers.ChoiceField(choices=PAY_STATUS, required=False)
    invoice = serializers.CharField(max_length=80, allow_blank=True, required=False)
    amount = serializers.CharField(max_length=40, allow_blank=True, required=False)
    paid_at = serializers.CharField(max_length=10, allow_blank=True, required=False)
    invoiced_at = serializers.CharField(max_length=10, allow_blank=True, required=False)


class BoothPatchIn(serializers.Serializer):
    visitor = serializers.ChoiceField(choices=list(VISITOR_TYPES), required=False)
    answers = serializers.DictField(child=serializers.CharField(max_length=40), required=False)
    offer = serializers.ChoiceField(choices=[*OFFERS, ""], required=False)
    game_played = serializers.BooleanField(required=False)
    game_score = serializers.CharField(max_length=20, allow_blank=True, required=False)
    destination = serializers.CharField(max_length=200, allow_blank=True, required=False)
    runs = serializers.CharField(max_length=300, allow_blank=True, required=False)
    pricing_tool = serializers.CharField(max_length=200, allow_blank=True, required=False)


class BoothContactIn(serializers.Serializer):
    name = serializers.CharField(max_length=200, allow_blank=True, required=False, default="")
    email = serializers.EmailField(allow_blank=True, required=False, default="")
    phone = serializers.CharField(max_length=60, allow_blank=True, required=False, default="")


class BoothLeadIn(BoothPatchIn):
    """The booth sheet. Points and tier are never sent: the server scores the answers."""

    pipeline_id = serializers.UUIDField()
    client_id = serializers.CharField(max_length=64, allow_blank=True, required=False, default="")
    source = serializers.ChoiceField(choices=sorted(BOOTH_SOURCES), required=False, default="Arival booth")
    met_at = serializers.CharField(max_length=16, allow_blank=True, required=False, default="")
    event = serializers.CharField(max_length=120, allow_blank=True, required=False, default="")
    met_by_id = serializers.CharField(allow_blank=True, required=False, default="")
    company = serializers.CharField(max_length=200)
    contact = BoothContactIn(required=False, default=dict)
    visitor = serializers.ChoiceField(choices=list(VISITOR_TYPES))
    booked_at = serializers.CharField(max_length=16, allow_blank=True, required=False, default="")
    followup_owner_id = serializers.CharField(allow_blank=True, required=False, default="")
    followup_due = serializers.DateField(required=False, allow_null=True, default=None)
    note = serializers.CharField(max_length=5000, allow_blank=True, required=False, default="")
    # Comparative analysis (tier C): their website (the analysis finds their competitors itself)
    website = serializers.CharField(max_length=300, allow_blank=True, required=False, default="")

    def to_internal_value(self, data):
        if isinstance(data, dict) and data.get("followup_due") == "":
            data = {**data, "followup_due": None}
        return super().to_internal_value(data)


class DealPatchIn(serializers.Serializer):
    company = CompanyIn(required=False)
    contact = ContactIn(required=False)
    source = serializers.CharField(max_length=80, allow_blank=True, required=False)
    event = serializers.CharField(max_length=120, allow_blank=True, required=False)
    interest = serializers.ChoiceField(choices=[*INTERESTS, ""], required=False)
    owner_id = serializers.CharField(allow_blank=True, required=False)
    package = serializers.CharField(max_length=120, allow_blank=True, required=False)
    value = serializers.CharField(max_length=60, allow_blank=True, required=False)
    locations = serializers.CharField(max_length=60, allow_blank=True, required=False)
    snapshot_sent = serializers.BooleanField(required=False)
    demo_date = DemoDateField(required=False)
    reengage_date = serializers.DateField(required=False, allow_null=True)
    payment = PaymentIn(required=False)
    qual = serializers.DictField(child=serializers.BooleanField(), required=False)
    pilot_checks = serializers.DictField(child=serializers.BooleanField(), required=False)
    onboarding = serializers.DictField(child=serializers.BooleanField(), required=False)
    met_by_id = serializers.CharField(allow_blank=True, required=False)
    booth = BoothPatchIn(required=False)
    account_manager_id = serializers.CharField(allow_blank=True, required=False)
    meeting_url = serializers.CharField(max_length=500, allow_blank=True, required=False)
    links = serializers.ListField(child=serializers.DictField(), required=False, max_length=20)
    commission_pct = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=0, max_value=100, required=False, allow_null=True)
    commission_in_pct = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=0, max_value=100, required=False, allow_null=True)

    def to_internal_value(self, data):
        if isinstance(data, dict) and data.get("reengage_date") == "":
            data = {**data, "reengage_date": None}
        return super().to_internal_value(data)


class MoveIn(serializers.Serializer):
    to = serializers.CharField(**STAGE_KEY)
    loss_reason = serializers.ChoiceField(choices=[*LOSS_REASONS, ""], required=False, default="")
    loss_competitor = serializers.CharField(max_length=120, allow_blank=True, required=False, default="")
    nurture_reason = serializers.CharField(max_length=80, allow_blank=True, required=False, default="")
    reengage_date = serializers.DateField(required=False, allow_null=True)
    demo_date = DemoDateField(required=False, default="")
    note = serializers.CharField(allow_blank=True, required=False, default="")
    # Admin override: move forward although the stage still has open tasks
    force = serializers.BooleanField(required=False, default=False)
    override_reason = serializers.CharField(max_length=500, allow_blank=True, required=False, default="")
    # Moving into "Offer sent": which offer (game, analysis, audit)
    track = serializers.ChoiceField(choices=[*TRACKS, ""], required=False, default="")
    # Moving into the second call (s9): a team demo or the commercial call
    call_type = serializers.ChoiceField(choices=[*CALL_TYPES, ""], required=False, default="")


class StageTaskIn(serializers.Serializer):
    pipeline_id = serializers.UUIDField()
    stage = serializers.CharField(**STAGE_KEY)
    owner_id = serializers.UUIDField()
    title = serializers.CharField(max_length=300)
    due_in_days = serializers.IntegerField(min_value=0, max_value=365, required=False, default=1)


class ActivityIn(serializers.Serializer):
    type = serializers.ChoiceField(choices=ACTIVITY_TYPES)
    text = serializers.CharField(max_length=20000)
    # Calls and meetings: team members who were on it
    attendee_ids = serializers.ListField(child=serializers.CharField(max_length=64), required=False, default=list, max_length=30)


class ActivityPatchIn(serializers.Serializer):
    attendee_ids = serializers.ListField(child=serializers.CharField(max_length=64), required=False, max_length=30)


class CallTypeIn(serializers.Serializer):
    call_type = serializers.ChoiceField(choices=list(CALL_TYPES))


class TransferIn(serializers.Serializer):
    pipeline_id = serializers.UUIDField()
    stage = serializers.CharField(max_length=16, allow_blank=True, required=False, default="")


class TaskCreateIn(serializers.Serializer):
    pipeline_id = serializers.UUIDField()
    deal_id = serializers.UUIDField(required=False, allow_null=True)
    title = serializers.CharField(max_length=300)
    owner_id = serializers.CharField(allow_blank=True, required=False, default="")
    due = serializers.DateField(required=False, allow_null=True)

    def to_internal_value(self, data):
        if isinstance(data, dict) and data.get("due") == "":
            data = {**data, "due": None}
        return super().to_internal_value(data)


class TaskPatchIn(TaskCreateIn):
    pipeline_id = None  # type: ignore[assignment]
    deal_id = None  # type: ignore[assignment]
    title = serializers.CharField(max_length=300, required=False)
    owner_id = serializers.CharField(allow_blank=True, required=False)
    done = serializers.BooleanField(required=False)


class PipelineIn(serializers.Serializer):
    name = serializers.CharField(max_length=120, required=False)
    # Only when creating: which stage template it starts from
    template = serializers.ChoiceField(choices=list(TEMPLATES), required=False, default="touriq")
    pilot_enabled = serializers.BooleanField(required=False)
    stages = serializers.JSONField(required=False)


class StageAddIn(serializers.Serializer):
    name = serializers.CharField(max_length=80)
    phase = serializers.ChoiceField(choices=stage_list.PHASES)
    after = serializers.CharField(max_length=16, allow_blank=True, required=False, default="")
    limit = serializers.IntegerField(min_value=0, max_value=365, required=False, allow_null=True, default=None)
    owner_id = serializers.CharField(allow_blank=True, required=False, default="")
    description = serializers.CharField(max_length=2000, allow_blank=True, required=False, default="")


class StageRemoveIn(serializers.Serializer):
    move_to = serializers.CharField(max_length=16, allow_blank=True, required=False, default="")


class SettingsIn(serializers.Serializer):
    team = serializers.ListField(child=serializers.DictField(), required=False)
    rules = serializers.DictField(child=serializers.BooleanField(), required=False)
    targets = serializers.DictField(required=False)
    booth_followup = serializers.DictField(child=serializers.DictField(), required=False)
    links = serializers.DictField(child=serializers.CharField(max_length=600, allow_blank=True), required=False)
    # {"Arival 2026": 12000}; null or blank removes an event's cost
    event_costs = serializers.DictField(child=serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0, allow_null=True),
                                        required=False)


class TouchpointIn(serializers.Serializer):
    kind = serializers.ChoiceField(choices=[k for k, _ in Touchpoint.KINDS])
    score = serializers.CharField(max_length=40, allow_blank=True, required=False, default="")
    link = serializers.URLField(max_length=600, allow_blank=True, required=False, default="")
    detail = serializers.CharField(max_length=500, allow_blank=True, required=False, default="")


class IntakeContactIn(serializers.Serializer):
    name = serializers.CharField(max_length=200, allow_blank=True, required=False, default="")
    email = serializers.EmailField(allow_blank=True, required=False, default="")
    phone = serializers.CharField(max_length=60, allow_blank=True, required=False, default="")
    title = serializers.CharField(max_length=200, allow_blank=True, required=False, default="")


class IntakeCompanyIn(serializers.Serializer):
    name = serializers.CharField(max_length=200, allow_blank=True, required=False, default="")
    website = serializers.CharField(max_length=300, allow_blank=True, required=False, default="")


class IntakeIn(serializers.Serializer):
    """One event from the game, comparative analysis or audit tool (see docs/INTAKE_API.md)."""

    event = serializers.ChoiceField(choices=list(EVENTS))
    event_id = serializers.CharField(max_length=120, allow_blank=True, required=False, default="")
    pipeline_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    occurred_at = serializers.DateTimeField(required=False, allow_null=True, default=None)
    contact = IntakeContactIn(required=False, default=dict)
    company = IntakeCompanyIn(required=False, default=dict)
    score = serializers.CharField(max_length=40, allow_blank=True, required=False, default="")
    link = serializers.URLField(max_length=600, allow_blank=True, required=False, default="")
    detail = serializers.CharField(max_length=500, allow_blank=True, required=False, default="")
    # New leads only: the trade show where the tool was used ("Arival 2026").
    # Not "event": that is the tool event kind above.
    trade_show = serializers.CharField(max_length=120, allow_blank=True, required=False, default="")

    def validate(self, attrs):
        if not (attrs["contact"].get("email") or attrs["company"].get("name")):
            raise serializers.ValidationError({"detail": "Send contact.email or company.name so the lead can be matched."})
        return attrs


class RecordingLinkIn(serializers.Serializer):
    deal_id = serializers.UUIDField()


class IntakeKeyIn(serializers.Serializer):
    name = serializers.CharField(max_length=80)


class InviteIn(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=["viewer", "contributor", "admin"], default="contributor")
    sales_team = serializers.BooleanField(default=True)


class ImportRowIn(serializers.Serializer):
    company = serializers.CharField(max_length=200)
    contact = serializers.CharField(max_length=200, allow_blank=True, required=False, default="")
    title = serializers.CharField(max_length=200, allow_blank=True, required=False, default="")
    email = serializers.CharField(max_length=254, allow_blank=True, required=False, default="")
    linkedin = serializers.CharField(max_length=300, allow_blank=True, required=False, default="")
    segment = serializers.CharField(max_length=80, allow_blank=True, required=False, default="")
    platform = serializers.CharField(max_length=80, allow_blank=True, required=False, default="")
    region = serializers.CharField(max_length=200, allow_blank=True, required=False, default="")
    source = serializers.CharField(max_length=80, allow_blank=True, required=False, default="")
    fit = serializers.CharField(max_length=10, allow_blank=True, required=False, default="")
    stage = serializers.CharField(max_length=16, required=False, default="s1")
    paid = serializers.BooleanField(required=False, default=False)
    owner = serializers.CharField(max_length=200, allow_blank=True, required=False, default="")
    last = serializers.CharField(max_length=10, allow_blank=True, required=False, default="")
    next = serializers.CharField(max_length=300, allow_blank=True, required=False, default="")
    next_date = serializers.CharField(max_length=10, allow_blank=True, required=False, default="")
    snap = serializers.BooleanField(required=False, default=False)
    demo = serializers.CharField(max_length=10, allow_blank=True, required=False, default="")
    notes = serializers.CharField(allow_blank=True, required=False, default="")
    fu = serializers.CharField(max_length=10, allow_blank=True, required=False, default="")
    # Company type as written in the sheet ("OTA", "Booking platform", "Competitor", ...)
    category = serializers.CharField(max_length=60, allow_blank=True, required=False, default="")


class ImportIn(serializers.Serializer):
    rows = ImportRowIn(many=True)


class AiDraftIn(serializers.Serializer):
    action = serializers.ChoiceField(choices=["brief", "first", "follow", "invite", "tag", "summary", "next"])
    option = serializers.CharField(max_length=10, allow_blank=True, required=False, default="")
    pasted = serializers.CharField(max_length=30000, allow_blank=True, required=False, default="")
