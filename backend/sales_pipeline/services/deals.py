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

from ..config import (
    ACTIVITY_CAP, ATTENDED_TYPES, BOOTH_SOURCES, CALL_TYPES, CATEGORIES, CATEGORY_TEMPLATE, DEAL_LINKS_MAX, INTERESTS,
    LOSS_REASONS, SYSTEM_LOSS_REASONS,
)
from ..models import Activity, Company, Contact, Deal, Pipeline, StageHistory, StageTaskTemplate, Task
from . import stages
from .errors import ServiceError
from .gating import advance_target, gated, requirements
from .pipelines import rules_for, stage_def, stage_enabled
from .rules import RuleExtra, rule_tasks
from . import calendar, speed, touchpoints

User = get_user_model()

COMPANY_FIELDS = ["name", "website", "region", "segment", "platform", "products5", "sells_out", "reachable", "category"]
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
    # Things to tell the person who made the change (e.g. "Game link emailed to …")
    notices: list[str] = field(default_factory=list)


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


def clean_attendees(tenant_id, ids) -> list[str]:
    """Team members on a call or meeting: known users of this workspace, no repeats."""
    want = [str(i) for i in (ids or []) if i]
    if not want:
        return []
    valid = {str(i) for i in User.objects.filter(tenant_id=tenant_id, id__in=want).values_list("id", flat=True)}
    if len(valid) != len(set(want)):
        raise ServiceError("Someone on the call isn't part of this workspace.", code="invalid_attendee")
    return list(dict.fromkeys(want))


def add_activity(deal: Deal, type_: str, text: str, actor: Actor, at=None, attendees=None, touch: bool = True) -> Activity:
    """touch=False: not the team reaching out (the booth conversation itself), so no first-touch stamp."""
    a = Activity.objects.create(
        tenant_id=deal.tenant_id, deal=deal, type=type_, text=text, at=at or timezone.now(),
        by=actor.user, by_name=actor.name,
        attendees=clean_attendees(deal.tenant_id, attendees) if type_ in ATTENDED_TYPES else [],
    )
    if touch:
        speed.on_activity(deal.id, type_, a.at)
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
def create_deal(tenant_id, actor: Actor, data: dict, *, company: Company | None = None, allow_lane: bool = False,
                capture_task: bool = True) -> DealResult:
    """
    New deal. Pass company= to open another deal on an existing company (expansion).
    allow_lane lets the booth form file hand-offs straight into Nurture / Lost (with
    nurture_reason / reengage_date / loss_reason in data); capture_task=False skips the
    generic 48-hour booth task when the caller creates its own follow-up.
    """
    pipeline = _pipeline(tenant_id, data["pipeline_id"])
    entry = data["entry_stage"]
    if not stage_enabled(pipeline, entry) or (stage_def(pipeline, entry).lane and not allow_lane):
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
        owner=owner, source=data.get("source", ""), event=(data.get("event") or "").strip()[:120], interest=data.get("interest", "") if data.get("interest") in INTERESTS else "",
        fit=fit_score(company), demo_date=data.get("demo_date") or "", created_by=actor.user, created_at=now,
        nurture_reason=data.get("nurture_reason") or "", reengage_date=data.get("reengage_date"),
        loss_reason=data.get("loss_reason") or "", track=(data.get("track") or "") if entry == "offer" else "",
    )
    _history(deal, "", entry, actor, at=now)
    if data.get("note"):
        add_activity(deal, "note", data["note"], actor)

    rules = rules_for(tenant_id)
    booth = deal.source in BOOTH_SOURCES
    extra = RuleExtra(demo_date=deal.demo_date, booth=booth, reengage_date=deal.reengage_date, loss_reason=deal.loss_reason,
                      offer=deal.track, offer_due=data.get("offer_due"), game_played=data.get("game_played"))
    created, _ = _apply_rules(deal, entry, extra, owner, actor, rules)
    if booth and capture_task and rules.get("r_capture48", True):
        created.append(_task(deal, "Follow up within 48 hours (booth lead)", owner, timezone.localdate() + timedelta(days=2), actor, auto=True, rule="r_capture48", stage=entry))
    calendar.queue_sync(deal)
    if company.category == "competitor" and deal.stage != "lost":
        mark_competitor(tenant_id, deal, actor)
        deal.refresh_from_db()
        return DealResult(deal, [], [str(t.id) for t in created])
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
    if loss_reason and loss_reason not in LOSS_REASONS and not (data.get("system") and loss_reason in SYSTEM_LOSS_REASONS):
        raise ServiceError("Unknown loss reason.", code="invalid_loss_reason")

    frm = deal.stage
    # Not Nurture either: it sets a re-engage date, which later asks someone to contact them
    if to != "lost" and deal.company.category == "competitor":
        raise ServiceError("This company is a competitor: do not contact. It stays in Lost.", code="competitor", status=409)
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
    if to == "s9" and data.get("call_type"):
        deal.call_type = data["call_type"]
    if to == "offer" and data.get("track"):
        deal.track = data["track"]
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
    # The demo steps of the journey
    if to == "s6":
        touchpoints.record(deal, "demo_booked", actor, once=True, detail=deal.demo_date.replace("T", " ") if deal.demo_date else "")
    elif to == "s7":
        touchpoints.record(deal, "demo_held", actor, once=True)
    if override_note:
        add_activity(deal, "note", override_note, actor)
    if data.get("note"):
        add_activity(deal, "note", data["note"], actor)
    created, closed = _apply_rules(
        deal, to, RuleExtra(demo_date=data.get("demo_date") or "", reengage_date=data.get("reengage_date"), loss_reason=loss_reason,
                            offer=deal.track if to == "offer" else "", call_type=deal.call_type if to == "s9" else ""),
        owner, actor, rules,
    )
    if data.get("demo_date") or to == "lost" or deal.calendar_event_id:
        calendar.queue_sync(deal)
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
        if c.category and c.category not in CATEGORIES:
            raise ServiceError("Unknown company type.", code="invalid_category")
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
    if "met_by_id" in data:
        deal.met_by = _owner(tenant_id, data["met_by_id"])
    if "account_manager_id" in data:
        deal.account_manager = _owner(tenant_id, data["account_manager_id"])
    if "commission_pct" in data:
        deal.commission_pct = data["commission_pct"]
    if "commission_in_pct" in data:
        deal.commission_in_pct = data["commission_in_pct"]
    if "links" in data:
        deal.links = clean_links(data["links"])
    if "booth" in data:
        from .booth import patch_booth  # booth imports this module

        if not deal.booth:
            raise ServiceError("This deal wasn't captured with the booth form.", code="not_booth")
        deal.booth = patch_booth(deal.booth, data["booth"])
    if "event" in data:
        deal.event = (data["event"] or "").strip()[:120]
    for k in ("source", "package", "value", "locations", "snapshot_sent", "demo_date", "qual", "pilot_checks", "onboarding", "meeting_url"):
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
    if "demo_date" in data or "meeting_url" in data:
        calendar.queue_sync(deal)
    if deal.company.category == "competitor":
        mark_competitor(tenant_id, deal, actor)
    return deal


def mark_competitor(tenant_id, deal: Deal, actor: Actor) -> None:
    """A competitor is never contacted: contact opted out, open tasks closed, deal to Lost."""
    if deal.contact_id:
        Contact.objects.filter(id=deal.contact_id).update(opted_out=True)
    Task.objects.filter(deal=deal, done=False).update(done=True, auto_closed=True, done_at=timezone.now())
    if deal.stage != "lost":
        move_deal(tenant_id, deal.id, Actor(actor.user, f"{actor.name} (competitor: do not contact)".strip()),
                  {"to": "lost", "loss_reason": "Not a prospect", "system": True})


def clean_links(links) -> list[dict]:
    out = []
    for item in links or []:
        url = str((item or {}).get("url") or "").strip()
        if not url:
            continue
        if not url.lower().startswith(("http://", "https://")):
            url = f"https://{url}"
        out.append({"label": str(item.get("label") or "").strip()[:80] or "Link", "url": url[:600]})
    if len(out) > DEAL_LINKS_MAX:
        raise ServiceError(f"Keep it to {DEAL_LINKS_MAX} links per deal.", code="too_many_links")
    return out


@transaction.atomic
def set_call_type(tenant_id, deal_id, actor: Actor, call_type: str) -> DealResult:
    """
    Second call (s9): switch between a team demo and the commercial call. The open tasks of
    the old kind are closed and the new kind's are added (e.g. after the team demo, the
    commercial call).
    """
    deal = Deal.objects.select_for_update().filter(tenant_id=tenant_id, id=deal_id).first()
    if deal is None:
        raise ServiceError("Deal not found.", code="not_found", status=404)
    if call_type not in CALL_TYPES:
        raise ServiceError("Choose a team demo or the commercial call.", code="invalid_call_type")
    if deal.stage != "s9":
        raise ServiceError("The next call is set while the deal is in the second-call stage.", code="invalid_stage")
    if deal.call_type == call_type:
        return DealResult(deal)
    before = deal.call_type
    deal.call_type = call_type
    deal.save(update_fields=["call_type", "updated_at"])
    stale = Task.objects.filter(deal=deal, stage="s9", rule="r_second", done=False)
    closed = [str(i) for i in stale.values_list("id", flat=True)]
    stale.update(done=True, auto_closed=True, done_at=timezone.now())
    rules = rules_for(tenant_id)
    created = [_task(deal, t.title, deal.owner, t.due, actor, auto=True, rule=t.rule, stage="s9", blocking=t.blocking)
               for t in rule_tasks("s9", rules, RuleExtra(call_type=call_type))]
    add_activity(deal, "note", f"Next call: {CALL_TYPES[call_type]}" + (f" (was {CALL_TYPES[before]})." if before in CALL_TYPES else "."), actor)
    return DealResult(deal, created, closed)


@transaction.atomic
def transfer_deal(tenant_id, deal_id, actor: Actor, pipeline_id, stage: str = "") -> DealResult:
    """
    Move a deal to another pipeline (e.g. a partner hand-off into Partnerships). It starts
    at that pipeline's first stage (or `stage`); its tasks go with it and the old
    automatic ones close. History keeps the old stages.
    """
    deal = Deal.objects.select_for_update().filter(tenant_id=tenant_id, id=deal_id).select_related("pipeline").first()
    if deal is None:
        raise ServiceError("Deal not found.", code="not_found", status=404)
    target = _pipeline(tenant_id, pipeline_id)
    if deal.company.category == "competitor":
        raise ServiceError("This company is a competitor: do not contact.", code="competitor", status=409)
    if target.id == deal.pipeline_id:
        raise ServiceError("The deal is already in that pipeline.", code="same_pipeline")
    main = stages.main_keys(target)
    to = stage or next((k for k in main if not stage_def(target, k).optional), "")
    if not to or to not in main:
        raise ServiceError("Choose a stage in that pipeline.", code="invalid_stage")
    source_name, frm = deal.pipeline.name, deal.stage
    rules = rules_for(tenant_id)
    sd = stage_def(target, to)
    owner = _owner(tenant_id, sd.owner_id) if rules.get("r_owner", True) and sd.owner_id else deal.owner
    Task.objects.filter(deal=deal, done=False, auto=True).update(done=True, auto_closed=True, done_at=timezone.now())
    Task.objects.filter(deal=deal).update(pipeline=target)
    now = timezone.now()
    deal.pipeline, deal.stage, deal.stage_changed_at, deal.owner = target, to, now, owner
    deal.track, deal.call_type = "", ""
    deal.save()
    label = Actor(actor.user, f"{actor.name} (moved from {source_name})" if actor.name else f"Moved from {source_name}")
    _history(deal, frm, to, label, at=now)
    add_activity(deal, "note", f"Moved from the {source_name} pipeline to {target.name}.", actor)
    created, closed = _apply_rules(deal, to, RuleExtra(), owner, actor, rules)
    return DealResult(deal, created, closed)


def import_handoffs(tenant_id, target: Pipeline, actor: Actor) -> int:
    """Bring partner hand-offs (Nurture, "Partner hand-off") whose company type fits this pipeline."""
    cats = [c for c, t in CATEGORY_TEMPLATE.items() if t == target.template]
    if not cats:
        raise ServiceError("Only a Partnerships, Channels or Referrals pipeline takes partner hand-offs.", code="invalid_template")
    ids = list(Deal.objects.filter(tenant_id=tenant_id, stage="nurture", nurture_reason="Partner hand-off", company__category__in=cats)
               .exclude(pipeline=target).values_list("id", flat=True))
    for i in ids:
        transfer_deal(tenant_id, i, actor, target.id)
    return len(ids)


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
