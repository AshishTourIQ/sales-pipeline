"""
Intake API: the game, comparative analysis and audit tools report what a lead did.

Each tool gets its own key (Settings → Integrations). Key text: "spk.<tenant id>.<secret>";
only sha256(secret) is stored. The tenant id in the key lets the lookup run inside that
tenant's Row-Level Security scope.

One event = one Touchpoint. The lead is matched by contact email, then company website
domain, then company name; if nothing matches, a company, contact and deal are created
at "Offer sent" on the event's track (a demo request starts at Demo booked). A deal still
before "Offer sent" moves there; a demo request moves it to Demo booked. The same
event_id twice is recorded once.
"""
import hashlib
import re
import secrets
import uuid
from dataclasses import dataclass
from urllib.parse import urlparse

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from core.tenancy import set_current_tenant

from ..models import Company, Contact, Deal, IntakeKey, Pipeline, Touchpoint
from . import stages, touchpoints
from .deals import Actor, create_deal, move_deal
from .errors import ServiceError
from .pipelines import stage_def, stage_enabled

EVENTS = {
    # event: (touchpoint kind, lead source for new leads, track)
    "game_played": ("game_played", "Game", "game"),
    "analysis_viewed": ("analysis_viewed", "Comparative analysis", "analysis"),
    "analysis_sent": ("analysis_sent", "Comparative analysis", "analysis"),
    "audit_submitted": ("audit_submitted", "Audit", "audit"),
    "audit_report_sent": ("audit_report_sent", "Audit", "audit"),
    "demo_requested": ("demo_requested", "Inbound (website, video)", ""),
}
PREFIX = "spk"


# ---------- keys ----------

def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def create_key(tenant_id, actor: Actor, name: str) -> tuple[IntakeKey, str]:
    """Returns the key row and the full key text (shown once, never stored)."""
    name = (name or "").strip()
    if not name:
        raise ServiceError("Name the key after the tool that uses it, e.g. \"Pricing game\".", code="name_required")
    secret = secrets.token_urlsafe(32)
    k = IntakeKey.objects.create(tenant_id=tenant_id, name=name[:80], key_hash=_hash(secret), prefix=secret[:8], created_by=actor.user)
    return k, f"{PREFIX}.{tenant_id}.{secret}"


def key_out(k: IntakeKey) -> dict:
    return {"id": str(k.id), "name": k.name, "prefix": k.prefix, "active": k.active,
            "created_at": k.created_at.isoformat(), "last_used_at": k.last_used_at.isoformat() if k.last_used_at else ""}


def authenticate(raw: str) -> IntakeKey:
    """Resolve a key and scope this transaction to its tenant. Raises 401 on anything wrong."""
    bad = ServiceError("Invalid or revoked intake key.", code="invalid_key", status=401)
    parts = (raw or "").strip().split(".", 2)
    if len(parts) != 3 or parts[0] != PREFIX:
        raise bad
    try:
        tenant_id = uuid.UUID(parts[1])
    except ValueError:
        raise bad
    set_current_tenant(tenant_id)
    k = IntakeKey.objects.filter(tenant_id=tenant_id, key_hash=_hash(parts[2]), active=True).first()
    if k is None:
        raise bad
    IntakeKey.objects.filter(id=k.id).update(last_used_at=timezone.now())
    return k


# ---------- matching ----------

def _domain(url: str) -> str:
    u = (url or "").strip().lower()
    if not u:
        return ""
    host = urlparse(u if "//" in u else f"//{u}").hostname or ""
    return re.sub(r"^www\.", "", host)


def _find_company(tenant_id, name: str, website: str) -> Company | None:
    d = _domain(website)
    if d:
        # Narrow in the database first (the domain is inside the stored website), then compare exactly
        for c in Company.objects.filter(tenant_id=tenant_id, website__icontains=d).only("id", "website")[:200]:
            if _domain(c.website) == d:
                return Company.objects.get(id=c.id)
    if name.strip():
        return Company.objects.filter(tenant_id=tenant_id, name__iexact=name.strip()).first()
    return None


def _open_deal(tenant_id, pipeline: Pipeline, *, contact: Contact | None, company: Company | None) -> Deal | None:
    """The newest deal for this person or company that isn't Lost (a Nurture deal comes back)."""
    q = Q()
    if contact:
        q |= Q(contact=contact)
    if company:
        q |= Q(company=company)
    if not q:
        return None
    return (Deal.objects.filter(q, tenant_id=tenant_id, pipeline=pipeline, is_sample=False).exclude(stage="lost")
            .order_by("-created_at").first())


# ---------- the event ----------

@dataclass
class IntakeResult:
    deal: Deal
    touchpoint: Touchpoint | None
    created: bool
    duplicate: bool = False


@transaction.atomic
def handle_event(key: IntakeKey, data: dict) -> IntakeResult:
    tenant_id = key.tenant_id
    actor = Actor(None, f"Intake: {key.name}")
    kind, source, track = EVENTS[data["event"]]
    event_id = (data.get("event_id") or "").strip()
    if event_id:
        dup = Touchpoint.objects.filter(tenant_id=tenant_id, external_id=event_id).select_related("deal").first()
        if dup:
            return IntakeResult(dup.deal, dup, created=False, duplicate=True)

    if data.get("pipeline_id"):
        pipeline = Pipeline.objects.filter(tenant_id=tenant_id, id=data["pipeline_id"]).first()
        if pipeline is None:
            raise ServiceError("Pipeline not found.", code="not_found", status=404)
    else:
        pipeline = Pipeline.objects.filter(tenant_id=tenant_id).order_by("created_at").first()
        if pipeline is None:
            raise ServiceError("This workspace has no pipeline yet.", code="no_pipeline", status=409)

    ct_in, co_in = data.get("contact") or {}, data.get("company") or {}
    email = (ct_in.get("email") or "").strip().lower()
    contact = Contact.objects.filter(tenant_id=tenant_id, email__iexact=email).select_related("company").first() if email else None
    company = contact.company if contact else _find_company(tenant_id, co_in.get("name") or "", co_in.get("website") or "")
    deal = _open_deal(tenant_id, pipeline, contact=contact, company=company)
    if deal is None and contact and contact.opted_out:
        # Never reopen someone who asked not to be contacted (or a competitor): just log the step
        deal = Deal.objects.filter(tenant_id=tenant_id, contact=contact).order_by("-created_at").first()
    created = False

    if deal is None:
        name = (co_in.get("name") or "").strip() or (company.name if company else "") or (email.split("@")[-1] if email else "")
        if not name:
            raise ServiceError("Send the company name or the contact's email.", code="company_required")
        entry = stages.resolve(pipeline, "s6") if not track else ("offer" if stage_enabled(pipeline, "offer") else stages.entry_for_source(pipeline, source))
        result = create_deal(tenant_id, actor, {
            "pipeline_id": pipeline.id, "entry_stage": entry, "source": data.get("source") or source, "event": data.get("trade_show") or "",
            "owner_id": stage_def(pipeline, entry).owner_id, "track": track,
            "company": {"name": name, "website": (co_in.get("website") or "").strip()},
            # A known contact is re-used below instead of creating a second one
            "contact": {} if contact else {"name": (ct_in.get("name") or "").strip(), "email": email,
                                           "phone": (ct_in.get("phone") or "").strip(), "title": (ct_in.get("title") or "").strip()},
            "note": f"New lead from {key.name}.",
        }, company=company)
        deal, created = result.deal, True
        if contact and deal.contact_id != contact.id:
            deal.contact = contact
            deal.save(update_fields=["contact"])
    else:
        # Fill gaps we now know, never overwrite what the team entered
        if deal.contact_id and email and not deal.contact.email:
            Contact.objects.filter(id=deal.contact_id).update(email=email)
        if co_in.get("website") and not deal.company.website:
            Company.objects.filter(id=deal.company_id).update(website=co_in["website"].strip()[:300])

    tp = touchpoints.record(deal, kind, actor, source="intake", at=data.get("occurred_at"), score=str(data.get("score") or ""),
                            link=data.get("link") or "", detail=data.get("detail") or "", external_id=event_id)

    # Move the deal along, unless they asked never to be contacted
    opted_out = bool(deal.contact_id and Contact.objects.filter(id=deal.contact_id, opted_out=True).exists())
    if not created and not opted_out:
        route = stages.main_keys(pipeline)
        here = route.index(deal.stage) if deal.stage in route else -1
        if deal.stage == "nurture":
            here = -1
        target = ""
        if not track:
            s6 = stages.resolve(pipeline, "s6")
            if s6 in route and here < route.index(s6):
                target = s6
        elif "offer" in route and here < route.index("offer"):
            target = "offer"
        if target:
            move_deal(tenant_id, deal.id, actor, {"to": target, "system": True, "track": track,
                                                  "note": f"{touchpoints.KIND_LABELS[kind]} ({key.name})."})
            deal.refresh_from_db()
        elif track and not deal.track and deal.stage == "offer":
            Deal.objects.filter(id=deal.id).update(track=track)
    return IntakeResult(deal, tp, created=created)
