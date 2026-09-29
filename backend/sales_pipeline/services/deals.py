"""
Deal lifecycle. All automation runs here, inside one transaction per call:
owner hand-off, stage history, auto-closing tasks, rule tasks, payment on
signing. The frontend mock adapter mirrors this; keep them in step.
"""
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from ..config import ACTIVITY_CAP, BOOTH_SOURCES, INTERESTS, LOSS_REASONS
from ..models import Activity, Company, Contact, Deal, Pipeline, StageHistory, StageTaskTemplate, Task
from . import stages
from .errors import ServiceError
from .gating import advance_target, gated, requirements
from .pipelines import rules_for, stage_def, stage_enabled
from .rules import RuleExtra, rule_tasks

User = get_user_model()

COMPANY_FIELDS = ["name", "website", "region", "segment", "platform", "products5", "sells_out", "reachable"]
CONTACT_FIELDS = ["name", "title", "email", "phone", "linkedin", "decision_maker"]


@dataclass(frozen=True)
class Actor:
    """Who is making the change: a signed-in user, or a label like 'Lead Tracker import'."""

    user: object | None
    name: str

    @classmethod
    def of(cls, user) -> "Actor":
        return cls(user=user, name=getattr(user, "display_name", "") or "")


@dataclass
class DealResult:
    deal: Deal
    tasks_created: list[Task] = field(default_factory=list)
    tasks_closed: list[str] = field(default_factory=list)


# ---------- helpers ----------

def fit_score(c: dict | Company) -> Decimal:
    """The 5-point rule: water, 5+ products, FareHarbor (Peek Pro = half), sells out, reachable buyer."""
    g = (lambda k: c.get(k)) if isinstance(c, dict) else (lambda k: getattr(c, k))
    s = Decimal(0)
    if g("segment") == "Water / boat":
        s += 1
    if g("products5"):
        s += 1
    if g("platform") == "FareHarbor":
        s += 1
    elif g("platform") == "Peek Pro":
        s += Decimal("0.5")
    if g("sells_out"):
        s += 1
    if g("reachable"):
        s += 1
    return s


def _owner(tenant_id, owner_id: str | None):
    if not owner_id:
        return None
    u = User.objects.filter(tenant_id=tenant_id, id=owner_id).first()
    if u is None:
        raise ServiceError("That owner isn't part of this workspace.", code="invalid_owner")
    return u


def _pipeline(tenant_id, pipeline_id) -> Pipeline:
    p = Pipeline.objects.filter(tenant_id=tenant_id, id=pipeline_id).first()
    if p is None:
        raise ServiceError("Pipeline not found.", code="not_found", status=404)
    return p


def _history(deal: Deal, frm: str, to: str, actor: Actor, at=None) -> StageHistory:
    return StageHistory.objects.create(
        tenant_id=deal.tenant_id, deal=deal, from_stage=frm, to_stage=to,
        at=at or timezone.now(), by=actor.user, by_name=actor.name,
    )


def add_activity(deal: Deal, type_: str, text: str, actor: Actor, at=None) -> Activity:
    a = Activity.objects.create(
        tenant_id=deal.tenant_id, deal=deal, type=type_, text=text, at=at or timezone.now(),
        by=actor.user, by_name=actor.name,
    )
    # Keep only the newest ACTIVITY_CAP entries per deal
    stale = list(Activity.objects.filter(deal=deal).order_by("-at", "-id").values_list("id", flat=True)[ACTIVITY_CAP:])
    if stale:
        Activity.objects.filter(id__in=stale).delete()
    return a


def _task(deal: Deal, title: str, owner, due: date | None, actor: Actor, *, auto: bool, rule: str = "", stage: str = "",
          sample=False, created_at=None, blocking: bool = True, template=None) -> Task:
    return Task.objects.create(
        tenant_id=deal.tenant_id, pipeline_id=deal.pipeline_id, deal=deal, title=title, owner=owner, due=due,
        auto=auto, rule=rule, stage=stage or deal.stage, is_sample=sample, blocking=blocking, template=template,
        created_by=actor.user, created_at=created_at or timezone.now(),
    )


def template_tasks(deal: Deal, stage: str, owner, actor: Actor) -> list[Task]:
    """Stage tasks ("Guddu must do X in stage 1") for a deal entering `stage` owned by `owner`."""
    if owner is None:
        return []
    today = timezone.localdate()
    return [
        _task(deal, t.title, owner, today + timedelta(days=t.due_in_days), actor, auto=True, stage=stage, template=t)
        for t in StageTaskTemplate.objects.filter(tenant_id=deal.tenant_id, pipeline_id=deal.pipeline_id, stage=stage, owner=owner, active=True)
    ]


def _apply_rules(deal: Deal, to: str, extra: RuleExtra, owner, actor: Actor, rules: dict[str, bool]) -> tuple[list[Task], list[str]]:
    closed: list[str] = []
    if rules.get("r_autoclose", True):
        stale = Task.objects.filter(deal=deal, done=False, auto=True).exclude(stage=to)
        closed = [str(i) for i in stale.values_list("id", flat=True)]
        stale.update(done=True, auto_closed=True, done_at=timezone.now())
    created = [_task(deal, t.title, owner, t.due, actor, auto=True, rule=t.rule, stage=to, blocking=t.blocking) for t in rule_tasks(to, rules, extra)]
    created += template_tasks(deal, to, owner, actor)
    return created, closed


# ---------- create ----------

@transaction.atomic
def create_deal(tenant_id, actor: Actor, data: dict, *, company: Company | None = None) -> DealResult:
    """New deal. Pass company= to open another deal on an existing company (expansion)."""
    pipeline = _pipeline(tenant_id, data["pipeline_id"])
    entry = data["entry_stage"]
    if not stage_enabled(pipeline, entry) or stage_def(pipeline, entry).lane:
        raise ServiceError("A new lead can't start in that stage.", code="invalid_stage")
    owner = _owner(tenant_id, data.get("owner_id"))
    if company is None:
        comp = {k: (data.get("company") or {}).get(k) for k in COMPANY_FIELDS}
        if not (comp.get("name") or "").strip():
            raise ServiceError("Add the company name to save.", code="company_required")
        comp["name"] = comp["name"].strip()
        company = Company.objects.create(tenant_id=tenant_id, **{k: v for k, v in comp.items() if v is not None})
    ct = {k: v for k, v in (data.get("contact") or {}).items() if k in CONTACT_FIELDS and v is not None}
    contact = Contact.objects.create(tenant_id=tenant_id, company=company, **ct) if any(ct.get(k) for k in ("name", "email", "phone", "title")) else None

    now = timezone.now()
    deal = Deal.objects.create(
        tenant_id=tenant_id, pipeline=pipeline, company=company, contact=contact, stage=entry, stage_changed_at=now,
        owner=owner, source=data.get("source", ""), interest=data.get("interest", "") if data.get("interest") in INTERESTS else "",
        fit=fit_score(company), demo_date=data.get("demo_date") or "", created_by=actor.user, created_at=now,
    )
    _history(deal, "", entry, actor, at=now)
    if data.get("note"):
        add_activity(deal, "note", data["note"], actor)

    rules = rules_for(tenant_id)
    booth = deal.source in BOOTH_SOURCES
    created, _ = _apply_rules(deal, entry, RuleExtra(demo_date=deal.demo_date, booth=booth), owner, actor, rules)
    if booth and rules.get("r_capture48", True):
        created.append(_task(deal, "Follow up within 48 hours (booth lead)", owner, timezone.localdate() + timedelta(days=2), actor, auto=True, rule="r_capture48", stage=entry))
    return DealResult(deal, created, [])


# ---------- move ----------

@transaction.atomic
def move_deal(tenant_id, deal_id, actor: Actor, data: dict) -> DealResult:
    deal = Deal.objects.select_for_update().filter(tenant_id=tenant_id, id=deal_id).first()
    if deal is None:
        raise ServiceError("Deal not found.", code="not_found", status=404)
    to = data["to"]
    if deal.stage == to:
        return DealResult(deal)
    pipeline = deal.pipeline
    if not stage_enabled(pipeline, to):
        raise ServiceError("That stage isn't used in this pipeline.", code="invalid_stage")
    loss_reason = data.get("loss_reason") or ""
    if to == "lost" and not loss_reason:
        raise ServiceError("A loss reason is required.", code="loss_reason_required")
    if loss_reason and loss_reason not in LOSS_REASONS:
        raise ServiceError("Unknown loss reason.", code="invalid_loss_reason")

    frm = deal.stage
    override_note = ""
    if gated(pipeline, frm, to) and not data.get("system"):
        req = requirements(deal)
        if not req.done:
            here = stage_def(pipeline, frm).name
            if not data.get("force"):
                raise ServiceError(f"Finish the {req.describe()} in {here} first. The deal moves on by itself when they're done.",
                                   code="stage_tasks_open", status=409)
            if getattr(actor.user, "pipeline_role", "") != "admin":
                raise ServiceError("Only an admin can move a deal forward with open tasks.", code="override_not_allowed", status=403)
            reason = (data.get("override_reason") or "").strip()
            if not reason:
                raise ServiceError("Give a reason for moving with open tasks.", code="override_reason_required")
            override_note = f"Moved on from {here} with {req.describe()} still open (admin override). Reason: {reason}"

    rules = rules_for(tenant_id)
    sd = stage_def(pipeline, to)
    owner = _owner(tenant_id, sd.owner_id) if rules.get("r_owner", True) and sd.owner_id else deal.owner
    now = timezone.now()

    deal.stage, deal.stage_changed_at, deal.owner = to, now, owner
    if loss_reason:
        deal.loss_reason, deal.loss_competitor = loss_reason, data.get("loss_competitor") or ""
    if data.get("nurture_reason"):
        deal.nurture_reason = data["nurture_reason"]
    if data.get("reengage_date"):
        deal.reengage_date = data["reengage_date"]
    if data.get("demo_date"):
        deal.demo_date = data["demo_date"]
    if to == "s11" and rules.get("r_signed", True):
        if (deal.payment or {}).get("status", "Not invoiced") == "Not invoiced":
            deal.payment = {**(deal.payment or {}), "status": "Invoiced", "invoiced_at": timezone.localdate().isoformat()}
        deal.signed_at = deal.signed_at or timezone.localdate()
    if to == "s13" and not deal.live_at:
        deal.live_at = timezone.localdate()
    if to == "lost" and loss_reason == "Unsubscribed" and deal.contact_id:
        Contact.objects.filter(id=deal.contact_id).update(opted_out=True)
    deal.save()

    _history(deal, frm, to, actor, at=now)
    if override_note:
        add_activity(deal, "note", override_note, actor)
    if data.get("note"):
        add_activity(deal, "note", data["note"], actor)
    created, closed = _apply_rules(
        deal, to, RuleExtra(demo_date=data.get("demo_date") or "", reengage_date=data.get("reengage_date"), loss_reason=loss_reason),
        owner, actor, rules,
    )
    return DealResult(deal, created, closed)


def maybe_advance(tenant_id, deal_id, actor: Actor) -> DealResult | None:
    """If everything for the deal's current stage is done, move it to the next main stage."""
    deal = Deal.objects.filter(tenant_id=tenant_id, id=deal_id).select_related("pipeline").first()
    if deal is None:
        return None
    target = advance_target(deal)
    if not target or not stage_enabled(deal.pipeline, target) or not requirements(deal).done:
        return None
    label = f"{actor.name} (all {stage_def(deal.pipeline, deal.stage).name} tasks done)" if actor.name else "All stage tasks done"
    return move_deal(tenant_id, deal.id, Actor(actor.user, label), {"to": target})


# ---------- update ----------

@transaction.atomic
def update_deal(tenant_id, deal_id, actor: Actor, data: dict) -> Deal:
    deal = Deal.objects.select_for_update().filter(tenant_id=tenant_id, id=deal_id).first()
    if deal is None:
        raise ServiceError("Deal not found.", code="not_found", status=404)

    if "company" in data:
        c = deal.company
        for k in COMPANY_FIELDS:
            if k in data["company"] and data["company"][k] is not None:
                setattr(c, k, data["company"][k])
        if not c.name.strip():
            raise ServiceError("The company name can't be empty.", code="company_required")
        c.save()
        deal.fit = fit_score(c)
    if "contact" in data:
        ct = {k: v for k, v in data["contact"].items() if k in CONTACT_FIELDS and v is not None}
        if deal.contact:
            for k, v in ct.items():
                setattr(deal.contact, k, v)
            deal.contact.save()
        elif any(ct.get(k) for k in ("name", "email", "phone", "title")):
            deal.contact = Contact.objects.create(tenant_id=tenant_id, company=deal.company, **ct)
    if "owner_id" in data:
        deal.owner = _owner(tenant_id, data["owner_id"])
    for k in ("source", "package", "value", "locations", "snapshot_sent", "demo_date", "qual", "pilot_checks", "onboarding"):
        if k in data:
            setattr(deal, k, data[k])
    if "interest" in data:
        deal.interest = data["interest"] if data["interest"] in INTERESTS else ""
    if "reengage_date" in data:
        deal.reengage_date = data["reengage_date"] or None
    if "payment" in data:
        pay = {**(deal.payment or {}), **data["payment"]}
        if pay.get("status") == "Paid" and not pay.get("paid_at"):
            pay["paid_at"] = timezone.localdate().isoformat()
        deal.payment = pay
    deal.save()
    return deal


@transaction.atomic
def create_expansion(tenant_id, deal_id, actor: Actor) -> DealResult:
    """New deal on the same company (more locations, add-ons, another product)."""
    src = Deal.objects.filter(tenant_id=tenant_id, id=deal_id).select_related("company", "contact").first()
    if src is None:
        raise ServiceError("Deal not found.", code="not_found", status=404)
    result = create_deal(tenant_id, actor, {
        "pipeline_id": src.pipeline_id, "entry_stage": stages.resolve(src.pipeline, "s5"), "source": "Existing client (expansion)", "interest": "Warm",
        "owner_id": str(src.owner_id) if src.owner_id else "",
        "note": "Expansion deal: more locations, add-ons or another product",
    }, company=src.company)
    if src.contact_id:
        result.deal.contact_id = src.contact_id
        result.deal.save(update_fields=["contact"])
    return result
