"""
Outreach: the Arival outreach tracker inside the pipeline. One row per person (Contact with a
campaign), research per company, drafts written in Claude chat and pasted in.

The order the CEO asked for, enforced here:
  check the data on their website → paste a draft → an approver approves it → someone sends it
  by hand and ticks Sent → the pipeline asks daily "did they reply?" → no LinkedIn reply in
  2 days: send the email (which goes through the same steps).
Rules: P1 contacts are messaged only by the P1 owner; one Arival app sender per person;
Skip / competitors are never messaged. Nothing here sends anything.
"""
from datetime import date, datetime, timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.db.models.functions import Upper
from django.utils import timezone

from ..config import (
    ARIVAL_SEGMENTS, CATEGORY_TEMPLATE, EMAIL_FOLLOW_UP_DAYS, LINKEDIN_TO_EMAIL_DAYS, OUTREACH_NO_CONTACT,
    OUTREACH_PRIORITIES, OUTREACH_RESEARCH_FIELDS, OUTREACH_RESEARCH_REQUIRED, OUTREACH_SEND_STEPS, OUTREACH_STEPS,
    OUTREACH_VERIFY,
)
from ..models import Company, Contact, Deal, OutreachDraft, Pipeline
from . import stages
from .deals import Actor, _history, add_activity
from .errors import ServiceError
from .pipelines import get_settings, stage_def

User = get_user_model()

CHANNEL_LABEL = dict(OutreachDraft.CHANNELS)
REPLY_STEP = {"linkedin": "li_reply", "email": "em_reply", "app": "app_reply"}
MAX_IMPORT = 2000


# ---------- who may do what ----------

def p1_user_id(tenant_id) -> str:
    return str((get_settings(tenant_id).outreach or {}).get("p1_user_id") or "")


def app_sender_ids(tenant_id) -> list[str]:
    """Who sends Arival app messages (each from their own Arival login)."""
    return [str(i) for i in (get_settings(tenant_id).outreach or {}).get("app_sender_ids") or []]


def _name(user) -> str:
    return getattr(user, "display_name", "") or "the P1 owner"


def do_not_contact(ct: Contact) -> str:
    """Why this person is never messaged ("" = they can be)."""
    if ct.priority in OUTREACH_NO_CONTACT:
        return "Marked Skip (duplicate or not to be contacted)."
    if ct.company.category == "competitor":
        return "Competitor: never contacted."
    if ct.opted_out:
        return "Unsubscribed."
    return ""


def is_verified(ct: Contact) -> bool:
    return bool(ct.verified_at and ct.company.research_verified_at)


def _check_can_message(ct: Contact, user) -> None:
    why = do_not_contact(ct)
    if why:
        raise ServiceError(f"Don't contact {ct.name or 'this person'}. {why}", code="do_not_contact", status=409)
    if ct.priority == "P1":
        owner = p1_user_id(ct.tenant_id)
        if not owner:
            raise ServiceError("P1 contacts are messaged only by the P1 owner. An admin sets who that is in Settings → Outreach.",
                               code="p1_owner_missing", status=409)
        if str(getattr(user, "id", "")) != owner:
            who = User.objects.filter(id=owner).first()
            raise ServiceError(f"P1 contact: only {_name(who)} messages them.", code="p1_only", status=403)


def _check_verified(ct: Contact) -> None:
    if not ct.company.research_verified_at:
        raise ServiceError(f"Check {ct.company.name}'s research on their website first (tour, price, booking platform, sources).",
                           code="research_not_verified", status=409)
    if not ct.verified_at:
        raise ServiceError(f"Verify {ct.name or 'this person'} first (right company, right person, their own email and LinkedIn).",
                           code="contact_not_verified", status=409)


# ---------- the tracker's computed columns ----------

def _date(v) -> date | None:
    try:
        return date.fromisoformat(str(v)[:10]) if v else None
    except ValueError:
        return None


def last_touch(ct: Contact) -> date | None:
    ds = [d for d in (_date(v) for k, v in (ct.steps or {}).items() if k != "arival_meeting") if d]
    return max(ds) if ds else None


def follow_up_due(ct: Contact) -> date | None:
    s = ct.steps or {}
    em = _date(s.get("em_sent"))
    if em and not s.get("em_follow") and not s.get("em_reply"):
        return em + timedelta(days=EMAIL_FOLLOW_UP_DAYS)
    li = _date(s.get("li_msg"))
    if li and not s.get("li_reply") and not s.get("em_sent"):
        return li + timedelta(days=LINKEDIN_TO_EMAIL_DAYS)
    return None


def next_action(ct: Contact, drafts: list[OutreachDraft], today: date | None = None) -> dict:
    """What this person needs next: {key, label, due}. The Today list is built from this."""
    today = today or timezone.localdate()
    s = ct.steps or {}
    checked = ct.reply_checked or {}

    def out(key, label, due=None):
        return {"key": key, "label": label, "due": due.isoformat() if due else None}

    if do_not_contact(ct):
        return out("none", "Do not contact")
    if any(s.get(k) for k in ("li_demo", "cal_demo", "arival_meeting")):
        return out("done", "Demo or meeting booked")
    if any(s.get(k) for k in REPLY_STEP.values()):
        return out("book", "They replied: book the demo", today)
    if not is_verified(ct):
        return out("verify", "Check the data on their website", today)
    open_drafts = [d for d in drafts if d.status != "sent"]
    for status, key, label in (("approved", "send", "Send the approved {} and tick Sent"),
                               ("changes", "fix", "Fix the {} (changes asked)"),
                               ("pending", "approval", "{} waiting for approval")):
        d = next((d for d in open_drafts if d.status == status), None)
        if d:
            ch = CHANNEL_LABEL[d.channel]
            return out(key, label.format(ch[0].upper() + ch[1:] if key == "approval" else ch.lower()), today)

    em, li, app = _date(s.get("em_sent")), _date(s.get("li_msg")), _date(s.get("app_sent"))
    if em:
        due = em + timedelta(days=EMAIL_FOLLOW_UP_DAYS)
        if not s.get("em_follow") and today >= due:
            return out("follow", f"No email reply in {EMAIL_FOLLOW_UP_DAYS} days: write the follow-up", due)
        if checked.get("email") != today.isoformat():
            return out("ask_email", "Did they reply to the email?", today)
        return out("wait", "Waiting for an email reply", None if s.get("em_follow") else due)
    if li:
        due = li + timedelta(days=LINKEDIN_TO_EMAIL_DAYS)
        if today >= due:
            return out("email", f"No LinkedIn reply in {LINKEDIN_TO_EMAIL_DAYS} days: write the email", due)
        if checked.get("linkedin") != today.isoformat():
            return out("ask_linkedin", "Did they reply on LinkedIn?", today)
        return out("wait", "Waiting for a LinkedIn reply", due)
    if app and checked.get("app") != today.isoformat():
        return out("ask_app", "Did they reply in the Arival app?", today)
    if s.get("li_note"):
        return out("li_msg", "Once they accept: write the LinkedIn message", today)
    if app:
        return out("wait", "Waiting for an Arival app reply")
    return out("write", "Write the first message in Claude and paste it here", today)


# ---------- the deal the activity goes on ----------

def _deal_for(ct: Contact) -> Deal | None:
    return Deal.objects.filter(company_id=ct.company_id).order_by("-created_at").first()


def _log(ct: Contact, text: str, actor: Actor, type_: str = "note") -> None:
    deal = _deal_for(ct)
    if deal is not None:
        add_activity(deal, type_, text, actor)


def _contact(tenant_id, contact_id) -> Contact:
    ct = Contact.objects.select_related("company").filter(tenant_id=tenant_id, id=contact_id).exclude(campaign="").first()
    if ct is None:
        raise ServiceError("Contact not found.", code="not_found", status=404)
    return ct


# ---------- verify ----------

@transaction.atomic
def update_contact(tenant_id, actor: Actor, contact_id, data: dict) -> Contact:
    ct = _contact(tenant_id, contact_id)
    user = actor.user
    if "priority" in data:
        if not getattr(user, "can_admin_pipeline", False):
            raise ServiceError("Only an admin can change the priority.", code="admin_only", status=403)
        if data["priority"] not in OUTREACH_PRIORITIES:
            raise ServiceError("Unknown priority.", code="invalid_priority")
        ct.priority = data["priority"]
    for f in ("email", "linkedin", "title"):
        if f in data:
            v = (data[f] or "").strip()
            if v != getattr(ct, f):
                setattr(ct, f, v)
                # Changing who we write to undoes the person check
                if f in ("email", "linkedin"):
                    ct.verify = {**(ct.verify or {}), "contact_info": False}
                    ct.verified_at, ct.verified_by = None, None
    if "notes" in data:
        ct.outreach_notes = (data["notes"] or "")[:5000]
    if "verify" in data:
        checks = {**(ct.verify or {})}
        for k, v in (data["verify"] or {}).items():
            if k in OUTREACH_VERIFY:
                checks[k] = bool(v)
        ct.verify = checks
        if all(checks.get(k) for k in OUTREACH_VERIFY):
            if not ct.verified_at:
                ct.verified_at, ct.verified_by = timezone.now(), user
                _log(ct, f"Outreach: {ct.name or 'contact'} verified", actor)
        else:
            ct.verified_at, ct.verified_by = None, None
    ct.save()
    return ct


@transaction.atomic
def update_research(tenant_id, actor: Actor, company_id, data: dict) -> Company:
    co = Company.objects.filter(tenant_id=tenant_id, id=company_id).first()
    if co is None:
        raise ServiceError("Company not found.", code="not_found", status=404)
    research = {**(co.research or {})}
    changed = False
    for k, v in (data.get("research") or {}).items():
        if k in OUTREACH_RESEARCH_FIELDS:
            v = str(v or "").strip()[:2000]
            if research.get(k, "") != v:
                research[k] = v
                changed = changed or k in OUTREACH_RESEARCH_REQUIRED
    co.research = research
    if "website" in data:
        w = (data["website"] or "").strip()[:300]
        changed = changed or w != co.website
        co.website = w
    if changed:
        co.research_verified_at, co.research_verified_by = None, None
    if data.get("verified") is True:
        missing = [k for k in OUTREACH_RESEARCH_REQUIRED if not research.get(k)]
        if not co.website:
            missing.insert(0, "website")
        if missing:
            raise ServiceError("Fill these first: " + ", ".join(m.replace("_", " ") for m in missing) + ".",
                               code="research_incomplete", status=409)
        co.research_verified_at, co.research_verified_by = timezone.now(), actor.user
    elif data.get("verified") is False:
        co.research_verified_at, co.research_verified_by = None, None
    co.save()
    return co


# ---------- steps ----------

def _clean_value(step: str, value) -> str | None:
    if value in (None, ""):
        return None
    v = str(value).strip()
    try:
        if step == "arival_meeting":
            return datetime.fromisoformat(v[:16]).strftime("%Y-%m-%dT%H:%M")
        return date.fromisoformat(v[:10]).isoformat()
    except ValueError:
        raise ServiceError("Use a valid date.", code="invalid_date")


@transaction.atomic
def set_step(tenant_id, actor: Actor, contact_id, step: str, value) -> Contact:
    if step not in OUTREACH_STEPS:
        raise ServiceError("Unknown step.", code="invalid_step")
    ct = _contact(tenant_id, contact_id)
    user = actor.user
    v = _clean_value(step, value)
    steps = {**(ct.steps or {})}
    channel, label = OUTREACH_STEPS[step]

    if v is None:
        if step == "app_sent" and ct.app_sender_id and ct.app_sender_id != getattr(user, "id", None) \
                and not getattr(user, "can_admin_pipeline", False):
            raise ServiceError("Only the person who sent it (or an admin) can untick it.", code="not_sender", status=403)
        steps.pop(step, None)
        if step == "app_sent":
            ct.app_sender = None
        ct.steps = steps
        ct.save()
        return ct

    if step in OUTREACH_SEND_STEPS:
        _check_can_message(ct, user)
        _check_verified(ct)
        draft_channel = OUTREACH_SEND_STEPS[step]
        draft = OutreachDraft.objects.filter(contact=ct, channel=draft_channel, status="approved").order_by("-approved_at").first()
        is_p1_owner = str(getattr(user, "id", "")) == p1_user_id(tenant_id)
        if draft is None and not is_p1_owner:
            raise ServiceError(f"There's no approved {CHANNEL_LABEL[draft_channel].lower()} for this person yet. "
                               "Paste the draft and get it approved first.", code="no_approved_draft", status=409)
        if step == "app_sent":
            senders = app_sender_ids(tenant_id)
            if str(getattr(user, "id", "")) not in senders:
                names = ", ".join(u.display_name for u in User.objects.filter(id__in=senders)) if senders else ""
                raise ServiceError(f"Arival app messages are sent only by {names}." if names else
                                   "An admin sets who sends Arival app messages in Settings → Outreach first.",
                                   code="not_app_sender", status=403)
            if ct.app_sender_id and ct.app_sender_id != getattr(user, "id", None):
                raise ServiceError(f"{ct.app_sender.display_name} already messages this person in the Arival app. "
                                   "Only one of us contacts each person.", code="other_sender", status=409)
            ct.app_sender = user
        if draft is not None:
            draft.status, draft.sent_by, draft.sent_at = "sent", user, timezone.now()
            draft.save(update_fields=["status", "sent_by", "sent_at", "updated_at"])
    if step in REPLY_STEP.values():
        ct.reply_checked = {}

    steps[step] = v
    ct.steps = steps
    ct.save()
    where = {"linkedin": "LinkedIn", "email": "Email", "app": "Arival app", "calendar": "Calendar"}[channel]
    _log(ct, f"{where}: {label.lower()} ({ct.name or 'contact'})", actor,
         type_="email" if step in ("em_sent", "em_follow") else "note")
    return ct


@transaction.atomic
def answer_reply_check(tenant_id, actor: Actor, contact_id, channel: str, replied: bool) -> Contact:
    if channel not in REPLY_STEP:
        raise ServiceError("Unknown channel.", code="invalid_channel")
    if replied:
        return set_step(tenant_id, actor, contact_id, REPLY_STEP[channel], timezone.localdate().isoformat())
    ct = _contact(tenant_id, contact_id)
    ct.reply_checked = {**(ct.reply_checked or {}), channel: timezone.localdate().isoformat()}
    ct.save(update_fields=["reply_checked"])
    return ct


# ---------- drafts ----------

def _draft(tenant_id, draft_id) -> OutreachDraft:
    d = OutreachDraft.objects.select_related("contact__company").filter(tenant_id=tenant_id, id=draft_id).first()
    if d is None:
        raise ServiceError("Draft not found.", code="not_found", status=404)
    return d


@transaction.atomic
def save_draft(tenant_id, actor: Actor, contact_id, channel: str, subject: str, body: str) -> Contact:
    """Paste a draft. An open draft of the same channel is replaced and goes back for approval."""
    if channel not in CHANNEL_LABEL:
        raise ServiceError("Unknown channel.", code="invalid_channel")
    body = (body or "").strip()
    if not body:
        raise ServiceError("Paste the message first.", code="empty_draft")
    if channel == "li_note" and len(body) > 300:
        raise ServiceError("A LinkedIn connection note can be at most 300 characters.", code="too_long")
    ct = _contact(tenant_id, contact_id)
    _check_can_message(ct, actor.user)
    _check_verified(ct)
    d = OutreachDraft.objects.filter(contact=ct, channel=channel).exclude(status="sent").first()
    if d is None:
        d = OutreachDraft(tenant_id=tenant_id, contact=ct, channel=channel, created_by=actor.user)
    d.subject, d.body = (subject or "").strip()[:300], body[:10000]
    d.status, d.review_note, d.approved_by, d.approved_at = "pending", "", None, None
    d.save()
    if channel == "email" and not (ct.steps or {}).get("em_draft"):
        ct.steps = {**(ct.steps or {}), "em_draft": timezone.localdate().isoformat()}
        ct.save(update_fields=["steps"])
    return ct


@transaction.atomic
def review_draft(tenant_id, actor: Actor, draft_id, data: dict) -> Contact:
    """Edit (creator or approver), approve or ask for changes (approvers)."""
    d = _draft(tenant_id, draft_id)
    ct = d.contact
    user = actor.user
    if d.status == "sent":
        raise ServiceError("This draft was already sent.", code="already_sent", status=409)
    approver = getattr(user, "can_approve", False)
    if "body" in data or "subject" in data:
        if not approver and d.created_by_id != getattr(user, "id", None):
            raise ServiceError("Only the person who pasted it or an approver can edit it.", code="forbidden", status=403)
        if "body" in data:
            body = (data["body"] or "").strip()
            if not body:
                raise ServiceError("The message can't be empty.", code="empty_draft")
            d.body = body[:10000]
        if "subject" in data:
            d.subject = (data["subject"] or "").strip()[:300]
        # The writer fixing it sends it back for approval; an approver's own edit keeps its status
        if not approver:
            d.status, d.approved_by, d.approved_at = "pending", None, None
    action = data.get("action")
    if action in ("approve", "changes"):
        if not approver:
            raise ServiceError("Only an approver can do this. An admin can make you one in Settings → Outreach.",
                               code="not_approver", status=403)
        if action == "approve":
            if d.created_by_id == getattr(user, "id", None) and not getattr(user, "can_admin_pipeline", False):
                raise ServiceError("Someone else has to approve your own draft.", code="self_approval", status=403)
            if ct.lead_review == "Yes" or ct.priority == "P1":
                owner = p1_user_id(tenant_id)
                if owner and str(getattr(user, "id", "")) != owner:
                    who = User.objects.filter(id=owner).first()
                    raise ServiceError(f"{_name(who)} reviews this person's drafts.", code="lead_review", status=403)
            _check_verified(ct)
            d.status, d.approved_by, d.approved_at, d.review_note = "approved", user, timezone.now(), ""
        else:
            d.status, d.approved_by, d.approved_at = "changes", None, None
            d.review_note = (data.get("note") or "").strip()[:500]
    d.save()
    return ct


@transaction.atomic
def delete_draft(tenant_id, actor: Actor, draft_id) -> Contact:
    d = _draft(tenant_id, draft_id)
    if d.status == "sent":
        raise ServiceError("A sent draft stays as the record of what was sent.", code="already_sent", status=409)
    if d.created_by_id != getattr(actor.user, "id", None) and not getattr(actor.user, "can_approve", False):
        raise ServiceError("Only the person who pasted it or an approver can delete it.", code="forbidden", status=403)
    ct = d.contact
    d.delete()
    return ct


# ---------- import (the Arival outreach tracker workbook) ----------

def _category(segment: str, competitor: str) -> str:
    if (competitor or "").lower().startswith("yes"):
        return "competitor"
    return ARIVAL_SEGMENTS.get((segment or "").strip().lower(), "other")


def _pipeline_for(tenant_id, category: str) -> Pipeline | None:
    template = CATEGORY_TEMPLATE.get(category, "touriq")
    qs = Pipeline.objects.filter(tenant_id=tenant_id).order_by("created_at")
    return qs.filter(template=template).first() or qs.filter(template="touriq").first() or qs.first()


@transaction.atomic
def import_tracker(tenant_id, actor: Actor, campaign: str, contacts: list[dict], research: list[dict]) -> dict:
    campaign = (campaign or "").strip()[:60]
    if not campaign:
        raise ServiceError("Name the list (e.g. Arival 2026).", code="no_campaign")
    if len(contacts) > MAX_IMPORT or len(research) > MAX_IMPORT:
        raise ServiceError(f"Import at most {MAX_IMPORT} rows at a time.", code="too_many_rows")
    label = Actor(actor.user, f"{actor.name} (outreach import)" if actor.name else "Outreach import")
    res_by = {(r.get("company") or "").strip().lower(): r for r in research if (r.get("company") or "").strip()}
    counts = {"companies_created": 0, "deals_created": 0, "contacts_created": 0, "contacts_updated": 0, "skipped": 0}
    companies: dict[str, Company] = {}
    users = list(User.objects.filter(tenant_id=tenant_id, is_active=True))

    def company_for(row: dict) -> Company:
        name = (row.get("company") or "").strip()
        key = name.lower()
        if key in companies:
            return companies[key]
        r = res_by.get(key, {})
        category = _category(row.get("segment", ""), row.get("competitor", "") or r.get("competitor", ""))
        co = (Company.objects.filter(tenant_id=tenant_id).annotate(u=Upper("name")).filter(u=name.upper())
              .order_by("created_at").first())
        if co is None:
            co = Company.objects.create(tenant_id=tenant_id, name=name[:200], category=category, segment="",
                                        website=(r.get("website") or "")[:300], reachable=True)
            counts["companies_created"] += 1
        else:
            if not co.category or category == "competitor":
                co.category = category
            if not co.website and r.get("website"):
                co.website = r["website"][:300]
        merged = {**(co.research or {})}
        for k in OUTREACH_RESEARCH_FIELDS:
            v = str(r.get(k) or "").strip()
            if v and not merged.get(k):
                merged[k] = v[:2000]
        co.research = merged
        co.save()
        if not Deal.objects.filter(company=co).exists():
            p = _pipeline_for(tenant_id, co.category)
            if p is not None:
                stage = "lost" if co.category == "competitor" else stages.main_keys(p)[0]
                oid = stage_def(p, stage).owner_id
                now = timezone.now()
                deal = Deal.objects.create(
                    tenant_id=tenant_id, pipeline=p, company=co, stage=stage, stage_changed_at=now,
                    owner=User.objects.filter(id=oid).first() if oid else None, source="Event list", event=campaign,
                    loss_reason="Not a prospect" if stage == "lost" else "", created_by=actor.user, created_at=now,
                )
                _history(deal, "", stage, label, at=now)
                add_activity(deal, "note", f"Imported from the {campaign} outreach tracker", label, touch=False)
                counts["deals_created"] += 1
        companies[key] = co
        return co

    for row in contacts:
        if not (row.get("company") or "").strip() or not ((row.get("name") or "").strip() or (row.get("email") or "").strip()):
            counts["skipped"] += 1
            continue
        co = company_for(row)
        ext = (row.get("ext_id") or "").strip()[:20]
        email = (row.get("email") or "").strip()[:254]
        q = Contact.objects.filter(tenant_id=tenant_id, company=co)
        ct = q.filter(campaign=campaign, ext_id=ext).first() if ext else None
        if ct is None and email:
            # Same person already in the pipeline (not from this list's rows). A duplicate row of the list
            # (its own ID, same email) stays a separate row, so it can't turn the original into Skip.
            ct = (q.annotate(u=Upper("email")).filter(u=email.upper())
                  .exclude(Q(campaign=campaign) & ~Q(ext_id="")).first())
        created = ct is None
        if created:
            ct = Contact(tenant_id=tenant_id, company=co)
        for f, n in (("name", 200), ("title", 200), ("linkedin", 300)):
            v = (row.get(f) or "").strip()[:n]
            if v and not getattr(ct, f):
                setattr(ct, f, v)
        if email and not ct.email:
            ct.email = email
        ct.campaign, ct.ext_id = campaign, ext or ct.ext_id
        ct.country = (row.get("country") or ct.country or "")[:80]
        pr = (row.get("priority") or "").strip()
        ct.priority = pr if pr in OUTREACH_PRIORITIES else (ct.priority or "Review")
        ct.role_type = (row.get("role_type") or ct.role_type or "")[:40]
        ct.lead_review = (row.get("lead_review") or ct.lead_review or "")[:20]
        ct.decision_maker = ct.decision_maker or (row.get("role_type") or "").lower().startswith("decision")
        ct.data_flags = (row.get("flags") or ct.data_flags or "")[:2000]
        if co.category == "competitor":
            ct.opted_out = True
        steps = {**(ct.steps or {})}
        for k, v in (row.get("steps") or {}).items():
            if k in OUTREACH_STEPS and v and not steps.get(k):
                try:
                    steps[k] = _clean_value(k, v)
                except ServiceError:
                    pass
        ct.steps = steps
        # Who already messaged them in the Arival app (the tracker's Nikunj / Gunin / Barkley columns)
        sender = (row.get("app_sender") or "").strip().lower()
        if sender and not ct.app_sender_id:
            ct.app_sender = next((u for u in users if sender in (u.full_name.lower(), u.username.lower())
                                  or u.full_name.lower().split(" ")[0] == sender), None)
        if row.get("notes") and not ct.outreach_notes:
            ct.outreach_notes = str(row["notes"])[:5000]
        ct.save()
        counts["contacts_created" if created else "contacts_updated"] += 1
        Deal.objects.filter(company=co, contact__isnull=True).update(contact=ct)
    return counts


def list_contacts(tenant_id, campaign: str = ""):
    qs = (Contact.objects.select_related("company", "app_sender", "verified_by", "company__research_verified_by")
          .filter(tenant_id=tenant_id).exclude(campaign=""))
    if campaign:
        qs = qs.filter(campaign=campaign)
    return qs.prefetch_related("drafts").order_by("ext_id", "name")


def deals_by_company(tenant_id, company_ids) -> dict:
    out = {}
    for d in Deal.objects.filter(tenant_id=tenant_id, company_id__in=company_ids).order_by("created_at").values(
            "id", "company_id", "pipeline_id", "stage"):
        out[d["company_id"]] = d
    return out


def contacts_of_company(tenant_id, company_id):
    return list_contacts(tenant_id).filter(Q(company_id=company_id))
