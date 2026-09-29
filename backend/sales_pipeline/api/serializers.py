"""
Wire format = the frontend's TypeScript types (types.ts) in snake_case.
Output serializers shape the response; input serializers validate requests.
"""
from rest_framework import serializers

from ..config import ACTIVITY_TYPES, INTERESTS, LOSS_REASONS, PAY_STATUS
from ..models import Deal, Pipeline, Task
from ..services import stages as stage_list

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
            "products5": c.products5, "sells_out": c.sells_out, "reachable": c.reachable,
        },
        "contact": {
            "name": ct.name if ct else "", "title": ct.title if ct else "", "email": ct.email if ct else "",
            "phone": ct.phone if ct else "", "linkedin": ct.linkedin if ct else "",
            "decision_maker": ct.decision_maker if ct else False,
        },
        "source": d.source,
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
            {"id": str(a.id), "type": a.type, "text": a.text, "at": _d(a.at), "by_id": _s(a.by_id) or None, "by_name": a.by_name}
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
        "sample": d.is_sample,
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
    return qs.select_related("company", "contact").prefetch_related("history", "activities")


def result_out_or_none(r) -> dict | None:
    return result_out(r) if r else None


def result_out(r) -> dict:
    deal = deal_queryset(Deal.objects.filter(id=r.deal.id)).get()
    return {"deal": deal_out(deal), "tasks_created": [task_out(t) for t in r.tasks_created], "tasks_closed": r.tasks_closed}


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
    demo_date = serializers.CharField(max_length=16, allow_blank=True, required=False, default="")


class PaymentIn(serializers.Serializer):
    status = serializers.ChoiceField(choices=PAY_STATUS, required=False)
    invoice = serializers.CharField(max_length=80, allow_blank=True, required=False)
    amount = serializers.CharField(max_length=40, allow_blank=True, required=False)
    paid_at = serializers.CharField(max_length=10, allow_blank=True, required=False)
    invoiced_at = serializers.CharField(max_length=10, allow_blank=True, required=False)


class DealPatchIn(serializers.Serializer):
    company = CompanyIn(required=False)
    contact = ContactIn(required=False)
    source = serializers.CharField(max_length=80, allow_blank=True, required=False)
    interest = serializers.ChoiceField(choices=[*INTERESTS, ""], required=False)
    owner_id = serializers.CharField(allow_blank=True, required=False)
    package = serializers.CharField(max_length=120, allow_blank=True, required=False)
    value = serializers.CharField(max_length=60, allow_blank=True, required=False)
    locations = serializers.CharField(max_length=60, allow_blank=True, required=False)
    snapshot_sent = serializers.BooleanField(required=False)
    demo_date = serializers.CharField(max_length=16, allow_blank=True, required=False)
    reengage_date = serializers.DateField(required=False, allow_null=True)
    payment = PaymentIn(required=False)
    qual = serializers.DictField(child=serializers.BooleanField(), required=False)
    pilot_checks = serializers.DictField(child=serializers.BooleanField(), required=False)
    onboarding = serializers.DictField(child=serializers.BooleanField(), required=False)

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
    demo_date = serializers.CharField(max_length=16, allow_blank=True, required=False, default="")
    note = serializers.CharField(allow_blank=True, required=False, default="")
    # Admin override: move forward although the stage still has open tasks
    force = serializers.BooleanField(required=False, default=False)
    override_reason = serializers.CharField(max_length=500, allow_blank=True, required=False, default="")


class StageTaskIn(serializers.Serializer):
    pipeline_id = serializers.UUIDField()
    stage = serializers.CharField(**STAGE_KEY)
    owner_id = serializers.UUIDField()
    title = serializers.CharField(max_length=300)
    due_in_days = serializers.IntegerField(min_value=0, max_value=365, required=False, default=1)


class ActivityIn(serializers.Serializer):
    type = serializers.ChoiceField(choices=ACTIVITY_TYPES)
    text = serializers.CharField(max_length=20000)


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


class ImportIn(serializers.Serializer):
    rows = ImportRowIn(many=True)


class AiDraftIn(serializers.Serializer):
    action = serializers.ChoiceField(choices=["brief", "first", "follow", "tag", "summary", "next"])
    option = serializers.CharField(max_length=10, allow_blank=True, required=False, default="")
    pasted = serializers.CharField(max_length=30000, allow_blank=True, required=False, default="")
