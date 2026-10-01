"""
Booth lead form: one visitor per sheet, saved straight into the pipeline.

Visitor type routes first:
  operator            → scored; the offer decides the stage (demo booked → Demo booked,
                        demo given → Demo done, audit / analysis / game → the booth entry stage)
  consultant, platform → Nurture, "Partner hand-off", with a hand-off task
  press               → Nurture, "Press hand-off", with a task
  competitor          → Lost, "Not a prospect", contact marked do-not-contact, no tasks
  vendor              → Lost, "Not a prospect", no tasks

The follow-up owner and due date come from the form (pre-filled from the tier's
defaults in Settings). A client_id makes a retried save return the first deal.
"""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import connection, transaction
from django.db.models.fields.json import KeyTextTransform
from django.utils import timezone

from ..config import (
    BOOTH_FOLLOWUP_DEFAULTS, FOLLOWUP_KEYS, NOT_PROSPECT_VISITORS, OFFER_FOR_TIER, OFFERS, PARTNER_VISITORS,
    PLATFORM_FOR_BOOKING, TIER_INTEREST, TRACKS, VISITOR_CATEGORY, VISITOR_TYPES,
)
from ..models import Contact, Deal, Task
from . import stages, touchpoints
from .deals import Actor, DealResult, _owner, _pipeline, _task, add_activity, create_deal
from .errors import ServiceError
from .pipelines import get_settings, stage_def, stage_enabled
from .scoring import clean_answers, option_label, score

User = get_user_model()

ROLE_TITLE = {"decider": "Owner / GM", "manager": "Manager", "staff": "Staff"}
LOCATIONS = {"3_plus": "3+", "2": "2", "1": "1"}


# ---------- follow-up defaults (Settings → Booth form) ----------

def followup_defaults(tenant_id) -> dict[str, dict]:
    """{key: {"owner_id", "days"}}: stored values over the config defaults (owners by username)."""
    stored = get_settings(tenant_id).booth_followup or {}
    usernames = {u: str(i) for u, i in User.objects.filter(tenant_id=tenant_id, is_active=True).values_list("username", "id")}
    out = {}
    for key in FOLLOWUP_KEYS:
        uname, days = BOOTH_FOLLOWUP_DEFAULTS[key]
        s = stored.get(key) or {}
        out[key] = {
            "owner_id": str(s["owner_id"]) if "owner_id" in s else usernames.get(uname, ""),
            "days": int(s.get("days", days)),
        }
    return out


def set_followup_defaults(tenant_id, data: dict) -> None:
    s = get_settings(tenant_id)
    valid = {str(i) for i in User.objects.filter(tenant_id=tenant_id).values_list("id", flat=True)}
    current = followup_defaults(tenant_id)
    for key, v in (data or {}).items():
        if key not in FOLLOWUP_KEYS or not isinstance(v, dict):
            continue
        owner = str(v.get("owner_id", current[key]["owner_id"]) or "")
        if owner and owner not in valid:
            raise ServiceError("That person isn't part of this workspace.", code="invalid_owner")
        try:
            days = max(0, min(60, int(v.get("days", current[key]["days"]))))
        except (TypeError, ValueError):
            raise ServiceError("Days must be a whole number.", code="invalid_days")
        current[key] = {"owner_id": owner, "days": days}
    s.booth_followup = current
    s.save(update_fields=["booth_followup"])


# ---------- output ----------

def booth_out(booth: dict | None) -> dict | None:
    """The stored sheet plus its score (always recomputed, so a points change re-scores every lead)."""
    if not booth:
        return None
    sc = score(booth.get("visitor", "operator"), booth.get("answers"))
    return {
        "client_id": booth.get("client_id", ""), "visitor": booth.get("visitor", "operator"),
        "answers": clean_answers(booth.get("answers")), "offer": booth.get("offer", ""),
        "game_played": bool(booth.get("game_played")), "game_score": booth.get("game_score", ""),
        "met_at": booth.get("met_at", ""), "destination": booth.get("destination", ""), "runs": booth.get("runs", ""),
        "pricing_tool": booth.get("pricing_tool", ""),
        "points": sc.points, "tier_before_cap": sc.tier_before_cap, "capped": sc.capped, "tier": sc.tier, "complete": sc.complete,
        "analysis": booth.get("analysis") or None,
    }


PATCHABLE = ["visitor", "answers", "offer", "game_played", "game_score", "destination", "runs", "pricing_tool"]


def patch_booth(stored: dict, patch: dict) -> dict:
    """Re-score or correct the sheet on an existing deal. The stage doesn't move."""
    out = {**(stored or {})}
    for k in PATCHABLE:
        if k in patch:
            out[k] = patch[k]
    if out.get("visitor") not in VISITOR_TYPES:
        raise ServiceError("Unknown visitor type.", code="invalid_visitor")
    if out.get("offer") and out["offer"] not in OFFERS:
        raise ServiceError("Unknown offer.", code="invalid_offer")
    out["answers"] = clean_answers(out.get("answers"))
    return out


# ---------- create ----------

def _followup_title(visitor: str, offer: str, who: str, tier: str) -> str:
    if visitor in PARTNER_VISITORS:
        return f"Hand {who} to the partnerships team"
    if visitor == "press":
        return f"Follow up with {who} (press / Arival)"
    tag = f"booth, tier {tier}"
    return {
        "demo_booked": f"Send the demo invite and deck to {who} ({tag})",
        "audit": f"Send the audit form to {who} ({tag})",
        "analysis": f"Run the comparative analysis and send it to {who} ({tag})",
        "game": f"Send {who} their game result and the demo link ({tag})",
    }.get(offer, f"Follow up with {who} ({tag})")


def _clean_url(v: str) -> str:
    u = (v or "").strip()[:300]
    return u if not u or u.lower().startswith(("http://", "https://")) else f"https://{u}"


def _request_analysis(deal: Deal, actor: Actor, data: dict) -> str:
    """Save the lead's website for the report (it finds their competitors itself) and draft the email that will carry it."""
    from . import client_mail

    website = _clean_url(data.get("website", ""))
    if website and not deal.company.website:
        deal.company.website = website
        deal.company.save(update_fields=["website"])
    deal.booth = {**deal.booth, "analysis": {"website": website, "status": "requested"}}
    deal.save(update_fields=["booth", "updated_at"])
    touchpoints.record(deal, "analysis_requested", actor, source="booth", link=website, detail=website)
    subject, text = client_mail.analysis_draft(deal, website)
    add_activity(deal, "note", f"Draft email (not sent yet: goes out with the report once the analysis tool is connected)\n\n"
                               f"Subject: {subject}\n\n{text}", actor)
    if not website:
        return "Comparative analysis saved without their website: add it on the deal so the report can run."
    return f"Comparative analysis requested for {website}. The report email is drafted on the deal."


def _email_game_link(deal: Deal, result: DealResult, actor: Actor, event: str) -> str:
    """Send the game link; on success log it and tick the "send them the game link" task. Returns the notice."""
    from . import client_mail

    email = deal.contact.email if deal.contact_id else ""
    if not email:
        return "No email address, so the game link wasn't sent. Add their email and send it by hand."
    if deal.contact.opted_out or deal.company.category == "competitor":
        return "Not emailed: this contact is do-not-contact."
    subject, html, text = client_mail.game_invite(deal, event=event)
    reply_to = getattr(deal.owner, "email", "") or getattr(deal.met_by, "email", "")
    sent = client_mail.send(email, subject, html, text, reply_to=reply_to)
    if not sent.ok:
        return f"The game link wasn't emailed: {sent.detail}. Send it by hand."
    link = client_mail.game_link(deal.tenant_id)
    touchpoints.record(deal, "game_link_sent", actor, source="booth", link=link, detail=f"Emailed to {email}")
    add_activity(deal, "email", f"Game link emailed to {email}: {subject}\n{link}", actor)
    task = next((t for t in result.tasks_created if t.title.startswith("Send them the game link")), None)
    if task:
        Task.objects.filter(id=task.id).update(done=True, done_at=timezone.now())
        task.done = True
    return f"Game link emailed to {email}" + (f" ({sent.detail})." if sent.detail else ".")


def _summary(data: dict, sc, offer: str, met_by_name: str) -> str:
    visitor = data["visitor"]
    parts = [f"Booth lead ({data.get('source') or 'booth'})" + (f", met by {met_by_name}" if met_by_name else "")
             + (f" on {data['met_at'].replace('T', ' ')}" if data.get("met_at") else "") + "."]
    parts.append(f"Visitor: {VISITOR_TYPES[visitor]}.")
    if sc.tier:
        cap = f", capped from {sc.tier_before_cap}" if sc.capped else ""
        parts.append(f"Tier {sc.tier} ({sc.points} points{cap}{'' if sc.complete else ', some questions unanswered'}).")
    if offer:
        parts.append(f"Offer: {OFFERS[offer]}.")
    if data.get("game_played"):
        parts.append("Played the game" + (f", score {data['game_score']}" if data.get("game_score") else "") + ".")
    for label, key in (("Destination", "destination"), ("Runs", "runs"), ("Pricing tool", "pricing_tool")):
        if data.get(key):
            parts.append(f"{label}: {data[key]}.")
    return " ".join(parts)


@transaction.atomic
def create_booth_lead(tenant_id, actor: Actor, data: dict) -> DealResult:
    client_id = str(data.get("client_id") or "")
    if client_id:
        # Two saves of the same form at once (two tabs, a retry racing the first try) wait
        # here in turn, so the second finds the first deal. The unique constraint backs it up.
        with connection.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [f"booth:{tenant_id}:{client_id}"])
        existing = (Deal.objects.filter(tenant_id=tenant_id, booth__has_key="client_id")
                    .alias(cid=KeyTextTransform("client_id", "booth")).filter(cid=client_id).first())
        if existing:
            return DealResult(existing)

    visitor = data["visitor"]
    if visitor not in VISITOR_TYPES:
        raise ServiceError("Unknown visitor type.", code="invalid_visitor")
    name = (data.get("company") or "").strip()
    if not name:
        raise ServiceError("Add the company name to save.", code="company_required")
    answers = clean_answers(data.get("answers")) if visitor == "operator" else {}
    sc = score(visitor, answers)
    offer = ""
    if visitor == "operator":
        offer = data.get("offer") or OFFER_FOR_TIER[sc.tier]
    elif visitor == "vendor" and data.get("game_played"):
        offer = "game"
    if offer and offer not in OFFERS:
        raise ServiceError("Unknown offer.", code="invalid_offer")

    pipeline = _pipeline(tenant_id, data["pipeline_id"])
    met_by = _owner(tenant_id, data.get("met_by_id")) if data.get("met_by_id") else actor.user
    follow_owner = _owner(tenant_id, data.get("followup_owner_id")) if data.get("followup_owner_id") else None

    # Where the deal starts
    lane_fields: dict = {}
    if visitor in NOT_PROSPECT_VISITORS:
        entry = "lost"
        lane_fields = {"loss_reason": "Not a prospect"}
    elif visitor in PARTNER_VISITORS or visitor == "press":
        entry = "nurture"
        # The hand-off itself is the follow-up task; the re-engage check comes later
        lane_fields = {"nurture_reason": "Press hand-off" if visitor == "press" else "Partner hand-off",
                       "reengage_date": timezone.localdate() + timedelta(days=60)}
    elif offer == "demo_booked":
        entry = stages.resolve(pipeline, "s6")
    elif offer == "demo_given":
        entry = stages.resolve(pipeline, "s7")
    elif offer in TRACKS and stage_enabled(pipeline, "offer"):
        entry = "offer"
    else:
        entry = stages.entry_for_source(pipeline, data.get("source") or "Arival booth")
    if entry not in ("lost", "nurture") and not stage_enabled(pipeline, entry):
        entry = stages.main_keys(pipeline)[0]

    fkey = "partner" if visitor in PARTNER_VISITORS else "press" if visitor == "press" else sc.tier or "D"
    due = data.get("followup_due")
    if not due and visitor not in NOT_PROSPECT_VISITORS:
        due = timezone.localdate() + timedelta(days=followup_defaults(tenant_id)[fkey]["days"])

    platform = PLATFORM_FOR_BOOKING.get(answers.get("booking", ""), "")
    contact = data.get("contact") or {}
    role = answers.get("role", "")
    result = create_deal(tenant_id, actor, {
        "pipeline_id": pipeline.id, "entry_stage": entry, "source": data.get("source") or "Arival booth", "event": data.get("event") or "",
        "interest": TIER_INTEREST.get(sc.tier, "") if visitor == "operator" else "",
        "owner_id": str(follow_owner.id) if follow_owner else stage_def(pipeline, entry).owner_id,
        "company": {"name": name, "region": (data.get("destination") or "").strip(), "platform": platform,
                    "sells_out": answers.get("sellouts") == "often", "reachable": role == "decider",
                    "category": VISITOR_CATEGORY.get(visitor, "")},
        "contact": {"name": (contact.get("name") or "").strip(), "email": (contact.get("email") or "").strip(),
                    "phone": (contact.get("phone") or "").strip(), "title": ROLE_TITLE.get(role, ""),
                    "decision_maker": role == "decider"},
        "demo_date": (data.get("booked_at") or "") if offer == "demo_booked" else "",
        # In "Offer sent" the stage's own "send the …" task is the follow-up, due when the form says
        "track": offer if entry == "offer" else "", "offer_due": due if entry == "offer" else None,
        "game_played": bool(data.get("game_played")) if offer == "game" else None,
        **lane_fields,
    }, allow_lane=True, capture_task=False)
    deal = result.deal

    deal.met_by = met_by
    deal.locations = LOCATIONS.get(answers.get("locations", ""), "")
    deal.booth = {
        "client_id": client_id, "visitor": visitor, "answers": answers, "offer": offer,
        "game_played": bool(data.get("game_played")), "game_score": (data.get("game_score") or "").strip(),
        "met_at": data.get("met_at") or timezone.localtime().strftime("%Y-%m-%dT%H:%M"),
        "destination": (data.get("destination") or "").strip(), "runs": (data.get("runs") or "").strip(),
        "pricing_tool": (data.get("pricing_tool") or "").strip(),
    }
    deal.save()
    if visitor == "competitor" and deal.contact_id:
        Contact.objects.filter(id=deal.contact_id).update(opted_out=True)

    met_name = getattr(met_by, "display_name", "") if met_by else ""
    add_activity(deal, "meeting", _summary({**data, "met_at": deal.booth["met_at"]}, sc, offer, met_name), actor, touch=False)
    if offer == "audit" and data.get("booked_at"):
        add_activity(deal, "note", f"Audit booked for {data['booked_at'].replace('T', ' ')}.", actor)
    if (data.get("note") or "").strip():
        add_activity(deal, "note", data["note"].strip(), actor)

    # Journey steps from the booth
    if data.get("game_played"):
        touchpoints.record(deal, "game_played", actor, source="booth", score=deal.booth["game_score"])
    if offer == "demo_booked":
        touchpoints.record(deal, "demo_booked", actor, source="booth", detail=deal.demo_date.replace("T", " "))
    elif offer == "demo_given":
        touchpoints.record(deal, "demo_held", actor, source="booth", detail="Demo given at the booth")

    # Comparative analysis: keep what the report needs, draft its email (the report tool isn't connected yet)
    if offer == "analysis":
        result.notices.append(_request_analysis(deal, actor, data))

    # Game only and not played yet: email them the game link now
    if offer == "game" and not data.get("game_played"):
        result.notices.append(_email_game_link(deal, result, actor, data.get("event") or ""))

    # The follow-up, except for people we never contact (in "Offer sent" the stage tasks are the follow-up)
    if visitor not in NOT_PROSPECT_VISITORS and follow_owner and entry != "offer":
        who = deal.contact.name if deal.contact_id and deal.contact.name else name
        result.tasks_created.append(_task(deal, _followup_title(visitor, offer, who, sc.tier), follow_owner, due, actor,
                                          auto=True, rule="r_capture48", stage=entry))
    return result
