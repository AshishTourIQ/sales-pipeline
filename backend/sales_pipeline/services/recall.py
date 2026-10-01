"""
Recall.ai: recorded calls land on the right deal by themselves.

1. Recall posts webhooks (signed with the workspace secret, whsec_...) to
   /webhooks/recall/<tenant id>/. `transcript.done` (preferred) or `bot.done` records a
   RecallMeeting and queues processing; the webhook answers at once (Recall allows 15 s).
2. Processing fetches the bot, its recording's participants and transcript, then matches
   a deal: the deal's meeting link (Meet code / Zoom id), then the meeting title (our
   calendar events are "TourIQ demo: <company>"), then participant emails, then names.
3. A match is logged as a Meeting activity with the team members who were on it
   (involvement), and Claude summarises the transcript (the drawer's "summary" action).
   No match: it waits in Settings → Integrations for a person to link it.

Participant emails only exist for bots made through Recall's calendar integration, so
matching never depends on them alone.
"""
import base64
import hashlib
import hmac
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime

import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import CharField, F, Q, Value
from django.utils import timezone

from ..models import AiDraftLog, Contact, Deal, RecallMeeting
from .deals import Actor, add_activity
from .errors import ServiceError

log = logging.getLogger(__name__)
User = get_user_model()
ACTOR = Actor(None, "Recall (recorded call)")
TRANSCRIPT_MAX = 60_000  # characters kept and sent to Claude
EVENTS = {"transcript.done", "bot.done"}
MAX_ATTEMPTS = 5  # fetch failures before a recording is marked failed
# A run that died mid-way (worker killed) leaves "processing": the retry job takes it back after this long
STALE_PROCESSING_MINUTES = 15


def enabled() -> bool:
    return bool(settings.RECALL_ENABLED)


def api_base() -> str:
    return f"https://{settings.RECALL_REGION}.recall.ai"


# ---------- webhook signature (Recall's documented Svix scheme) ----------

def verify(headers, body: bytes, now: float | None = None) -> None:
    """Raise 401 unless the webhook is signed with the workspace secret and recent."""
    secret = settings.RECALL_WEBHOOK_SECRET
    h = {k.lower(): v for k, v in headers.items()}
    msg_id = h.get("webhook-id") or h.get("svix-id") or ""
    ts = h.get("webhook-timestamp") or h.get("svix-timestamp") or ""
    sigs = h.get("webhook-signature") or h.get("svix-signature") or ""
    bad = ServiceError("Invalid webhook signature.", code="invalid_signature", status=401)
    if not (secret.startswith("whsec_") and msg_id and ts and sigs):
        raise bad
    try:
        if abs((now or time.time()) - int(ts)) > settings.RECALL_WEBHOOK_TOLERANCE_SECONDS:
            raise bad
        key = base64.b64decode(secret[len("whsec_"):])
    except (ValueError, TypeError):
        raise bad
    expected = hmac.new(key, f"{msg_id}.{ts}.".encode() + body, hashlib.sha256).digest()
    for part in sigs.split(" "):
        version, _, sig = part.partition(",")
        if version != "v1":
            continue
        try:
            if hmac.compare_digest(base64.b64decode(sig), expected):
                return
        except (ValueError, TypeError):
            continue
    raise bad


def record_webhook(tenant_id, payload: dict) -> RecallMeeting | None:
    """Store the event; returns the meeting to process (None for events we ignore)."""
    event = payload.get("event")
    if event not in EVENTS:
        return None
    data = payload.get("data") or {}
    bot_id = str((data.get("bot") or {}).get("id") or "")
    if not bot_id:
        return None
    m, _ = RecallMeeting.objects.get_or_create(tenant_id=tenant_id, bot_id=bot_id)
    changed = []
    for key, attr in (("recording", "recording_id"), ("transcript", "transcript_id")):
        v = str((data.get(key) or {}).get("id") or "")
        if v and getattr(m, attr) != v:
            setattr(m, attr, v)
            changed.append(attr)
    # A transcript arriving after bot.done (or a failed try) is worth another run
    if m.status == "failed" or (event == "transcript.done" and m.status == "unmatched" and not m.transcript):
        m.status = "pending"
        changed.append("status")
    if changed:
        m.save(update_fields=[*changed, "updated_at"])
    return m if m.status == "pending" else None


# ---------- fetching from Recall ----------

def _get_json(url: str, *, auth: bool = True):
    """GET JSON from Recall (download URLs are pre-signed: no auth header). Tests replace this."""
    headers = {"Authorization": f"Token {settings.RECALL_API_KEY}"} if auth else {}
    r = requests.get(url, headers=headers, timeout=30)
    if r.status_code >= 300:
        raise ServiceError(f"Recall answered {r.status_code}.", code="recall_error", status=502)
    return r.json()


def meeting_ref(url) -> str:
    """A comparable code for a meeting: Google Meet "abc-defg-hij", Zoom / Teams numeric id, else the host+path."""
    if isinstance(url, dict):  # Recall's MeetingInvite object
        url = url.get("meeting_id") or url.get("meeting_url") or url.get("url") or ""
    u = str(url or "").strip().lower()
    if not u:
        return ""
    m = re.search(r"\b([a-z]{3}-[a-z]{4}-[a-z]{3})\b", u)
    if m:
        return m.group(1)
    m = re.search(r"(?:/j/|/w/|confno=|^)(\d{9,12})\b", u)
    if m:
        return m.group(1)
    return re.sub(r"^https?://(www\.)?", "", u).split("?")[0].rstrip("/")


@dataclass
class Fetched:
    title: str = ""
    ref: str = ""
    started_at: datetime | None = None
    ended_at: datetime | None = None
    participants: list[dict] = field(default_factory=list)
    transcript: str = ""
    transcript_ready: bool = False


def _dt(v) -> datetime | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None


def format_transcript(parts: list) -> str:
    """Recall's transcript JSON → "Name: words" paragraphs, merging a speaker's consecutive turns."""
    lines: list[tuple[str, str]] = []
    for p in parts or []:
        who = ((p.get("participant") or {}).get("name") or "Unknown").strip()
        text = " ".join(w.get("text", "") for w in p.get("words") or []).strip()
        if not text:
            continue
        if lines and lines[-1][0] == who:
            lines[-1] = (who, f"{lines[-1][1]} {text}")
        else:
            lines.append((who, text))
    return "\n".join(f"{w}: {t}" for w, t in lines)[:TRANSCRIPT_MAX]


def fetch(meeting: RecallMeeting) -> Fetched:
    bot = _get_json(f"{api_base()}/api/v1/bot/{meeting.bot_id}/")
    out = Fetched(ref=meeting_ref(bot.get("meeting_url")))
    recs = bot.get("recordings") or []
    rec = next((r for r in recs if str(r.get("id")) == meeting.recording_id), recs[0] if recs else {})
    out.started_at = _dt(rec.get("started_at"))
    out.ended_at = _dt(rec.get("completed_at"))
    if not out.started_at:
        changes = {c.get("code"): c.get("created_at") for c in bot.get("status_changes") or []}
        out.started_at = _dt(changes.get("in_call_recording"))
        out.ended_at = _dt(changes.get("call_ended") or changes.get("done"))
    shortcuts = rec.get("media_shortcuts") or {}
    out.title = str((((shortcuts.get("meeting_metadata") or {}).get("data")) or {}).get("title") or "")
    pe = ((shortcuts.get("participant_events") or {}).get("data")) or {}
    if pe.get("participants_download_url"):
        seen = set()
        for p in _get_json(pe["participants_download_url"], auth=False) or []:
            key = (p.get("name") or "", p.get("email") or "")
            if key in seen:  # people who left and rejoined appear twice
                continue
            seen.add(key)
            out.participants.append({"name": p.get("name") or "", "email": (p.get("email") or "").lower(), "is_host": bool(p.get("is_host"))})
    tr = ((shortcuts.get("transcript") or {}).get("data")) or {}
    if tr.get("download_url"):
        out.transcript = format_transcript(_get_json(tr["download_url"], auth=False))
        out.transcript_ready = True
    return out


# ---------- matching ----------

def match_deal(tenant_id, f: Fetched) -> tuple[Deal | None, str]:
    deals = Deal.objects.filter(tenant_id=tenant_id, is_sample=False).exclude(stage="lost")
    if f.ref:
        # The meeting code is inside the stored link: narrow in the database, then compare exactly
        for d in deals.filter(meeting_url__icontains=f.ref.split("/")[-1]).only("id", "meeting_url")[:50]:
            if meeting_ref(d.meeting_url) == f.ref:
                return Deal.objects.get(id=d.id), "meeting_url"
    if f.title.strip():
        # Deals whose company name appears in the meeting title ("TourIQ x Reef Tours")
        hits = list(deals.exclude(company__name="").annotate(t=Value(f.title, output_field=CharField()))
                    .filter(t__icontains=F("company__name")).select_related("company")[:2])
        if len(hits) == 1:
            return hits[0], "title"
    team_emails = {e.lower() for e in User.objects.filter(tenant_id=tenant_id).values_list("email", flat=True)}
    emails = [p["email"] for p in f.participants if p["email"] and p["email"] not in team_emails]
    if emails:
        c = Contact.objects.filter(tenant_id=tenant_id, email__in=emails).first()
        d = c and deals.filter(contact=c).order_by("-created_at").first()
        if d:
            return d, "email"
    names = [p["name"] for p in f.participants if p["name"]]
    if names:
        q = Q()
        for n in names:
            q |= Q(contact__name__iexact=n.strip())
        hits = list(deals.filter(q)[:2])
        if len(hits) == 1:
            return hits[0], "name"
    return None, ""


def team_attendees(tenant_id, participants: list[dict]) -> list[str]:
    """Team members on the call: by email, else by full name, else by a first name only one teammate has."""
    users = list(User.objects.filter(tenant_id=tenant_id, is_active=True))
    by_email = {u.email.lower(): u for u in users}
    by_name = {u.display_name.strip().lower(): u for u in users if u.display_name}
    firsts: dict[str, list] = {}
    for u in users:
        if u.display_name:
            firsts.setdefault(u.display_name.split()[0].lower(), []).append(u)
    out = []
    for p in participants:
        u = by_email.get(p.get("email") or "") or by_name.get((p.get("name") or "").strip().lower())
        if u is None and p.get("name"):
            cands = firsts.get(p["name"].split()[0].lower(), [])
            u = cands[0] if len(cands) == 1 else None
        if u is not None:
            out.append(str(u.id))
    return list(dict.fromkeys(out))


# ---------- logging on the deal ----------

def _summary_line(m: RecallMeeting) -> str:
    when = timezone.localtime(m.started_at).strftime("%d %b %Y, %H:%M") if m.started_at else "time unknown"
    mins = f", {max(1, round((m.ended_at - m.started_at).total_seconds() / 60))} min" if m.started_at and m.ended_at else ""
    people = ", ".join(p["name"] for p in m.participants if p.get("name")) or "not reported"
    return f"Recorded call{f': {m.title}' if m.title else ''} ({when}{mins}). Participants: {people}."


def log_on_deal(m: RecallMeeting, deal: Deal, matched_by: str) -> None:
    add_activity(deal, "meeting", _summary_line(m), ACTOR, at=m.started_at or timezone.now(),
                 attendees=team_attendees(deal.tenant_id, m.participants))
    m.deal, m.matched_by, m.status, m.error = deal, matched_by, "logged", ""
    m.save(update_fields=["deal", "matched_by", "status", "error", "updated_at"])


def summarise(tenant_id, deal_id, transcript: str) -> None:
    """Claude's call summary as an AI activity. Runs outside any transaction (the call takes seconds)."""
    from core.tenancy import tenant_context

    from . import ai

    if not transcript or not settings.AI_ENABLED:
        return
    with tenant_context(tenant_id):
        deal = Deal.objects.filter(id=deal_id).select_related("company", "contact", "pipeline").first()
        if deal is None:
            return
        prompt = ai.build_prompt("summary", deal, pasted=transcript)
    started = time.monotonic()
    result, error = None, None
    try:
        result = ai.generate("summary", prompt)
    except ServiceError as e:
        error = e
    with tenant_context(tenant_id):
        AiDraftLog.objects.create(
            tenant_id=tenant_id, deal_id=deal_id, action="summary", model=result.model if result else ai.model_for("summary"),
            ok=error is None, error_code=error.code if error else "", input_tokens=result.input_tokens if result else 0,
            output_tokens=result.output_tokens if result else 0, cache_read_tokens=result.cache_read_tokens if result else 0,
            ms=int((time.monotonic() - started) * 1000),
        )
        if result:
            add_activity(Deal.objects.get(id=deal_id), "ai", f"Call summary (from the Recall recording)\n\n{result.text}", ACTOR)


def claim(meeting_id) -> bool:
    """Take a pending recording for this run: one atomic update, so two workers (bot.done and
    transcript.done both queue a run, plus the retry job) never log or summarise it twice."""
    now = timezone.now()
    return RecallMeeting.objects.filter(id=meeting_id, status="pending").update(
        status="processing", attempts=F("attempts") + 1, updated_at=now) == 1


def process(tenant_id, meeting_id) -> str:
    """Fetch, match, log, summarise. Safe to run twice or at once: only the run that claims it works."""
    from core.tenancy import tenant_context

    with tenant_context(tenant_id):
        if not claim(meeting_id):
            m = RecallMeeting.objects.filter(id=meeting_id).only("status").first()
            return m.status if m else "missing"
        m = RecallMeeting.objects.get(id=meeting_id)
    try:
        f = fetch(m)  # HTTP outside any transaction
    except Exception as e:  # noqa: BLE001 - Recall down or changed: keep it for the retry job
        log.warning("Recall fetch failed for bot %s", m.bot_id, exc_info=True)
        with tenant_context(tenant_id):
            RecallMeeting.objects.filter(id=m.id, status="processing").update(
                status="failed" if m.attempts >= MAX_ATTEMPTS else "pending", error=str(e)[:300], updated_at=timezone.now())
        return "error"
    with tenant_context(tenant_id):
        m = RecallMeeting.objects.select_for_update().get(id=meeting_id)
        if m.status != "processing":  # dismissed or linked by a person meanwhile
            return m.status
        m.title, m.meeting_ref, m.started_at, m.ended_at = f.title[:300], f.ref[:120], f.started_at, f.ended_at
        m.participants, m.transcript = f.participants, f.transcript
        if not f.transcript_ready and m.attempts < 3 and not m.transcript_id:
            # bot.done can come before the transcript: wait for transcript.done or the retry job
            m.status = "pending"
            m.save()
            return "waiting"
        m.save()
        deal, how = match_deal(tenant_id, f)
        if deal is None:
            m.status = "unmatched"
            m.save(update_fields=["status", "updated_at"])
            return "unmatched"
        log_on_deal(m, deal, how)
        deal_id = deal.id
    summarise(tenant_id, deal_id, f.transcript)
    return "logged"


def link_manually(tenant_id, meeting_id, deal_id, actor: Actor) -> RecallMeeting:
    """A person picks the deal for an unmatched recording. Summarise afterwards with summarise()."""
    m = RecallMeeting.objects.filter(tenant_id=tenant_id, id=meeting_id).first()
    if m is None:
        raise ServiceError("Recording not found.", code="not_found", status=404)
    if m.status == "logged":
        raise ServiceError("This recording is already on a deal.", code="already_logged")
    deal = Deal.objects.filter(tenant_id=tenant_id, id=deal_id).first()
    if deal is None:
        raise ServiceError("Deal not found.", code="not_found", status=404)
    log_on_deal(m, deal, "manual")
    return m


def queue(task_name: str, tenant_id, meeting_id) -> None:
    """Run a Recall job in the worker after this transaction commits. If Redis is down,
    the 10-minute retry job picks pending recordings up."""
    from django.db import transaction

    def send():
        from .. import tasks

        try:
            getattr(tasks, task_name).apply_async((str(tenant_id), str(meeting_id)), retry=False)
        except Exception:
            log.warning("Couldn't queue %s for recording %s", task_name, meeting_id, exc_info=True)

    transaction.on_commit(send)


def meeting_out(m: RecallMeeting) -> dict:
    return {
        "id": str(m.id), "status": m.status, "title": m.title, "started_at": m.started_at.isoformat() if m.started_at else "",
        "ended_at": m.ended_at.isoformat() if m.ended_at else "", "participants": m.participants, "deal_id": str(m.deal_id or "") or None,
        "matched_by": m.matched_by, "error": m.error, "has_transcript": bool(m.transcript), "created_at": m.created_at.isoformat(),
    }
