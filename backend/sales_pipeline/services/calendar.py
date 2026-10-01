"""
Google Calendar: every deal with a demo or meeting time gets an event on the team calendar.

Uses a service account (settings GOOGLE_*). The team calendar is shared with the service
account's email. With GOOGLE_DELEGATED_USER (Google Workspace domain-wide delegation) the
event is created as that user: it invites the owner and the contact and gets a Google Meet
link, which also lets Recall recordings of the call be matched back to the deal.

Syncing runs in a Celery job after the change commits (queue_sync); sync_deal() does the
work and can also be called directly ("Sync to calendar" in the deal drawer).
"""
import json
import logging
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction

from ..models import Deal
from .errors import ServiceError

log = logging.getLogger(__name__)
SCOPES = ["https://www.googleapis.com/auth/calendar.events"]
BASE = "https://www.googleapis.com/calendar/v3/calendars/{cal}/events"
# Stages where the meeting no longer happens
GONE = {"lost"}


def enabled() -> bool:
    return bool(settings.CALENDAR_ENABLED)


def _session():
    """An authorised requests session for the Calendar API (built per call; cheap, tokens cached inside)."""
    from google.auth.transport.requests import AuthorizedSession
    from google.oauth2 import service_account

    if settings.GOOGLE_SERVICE_ACCOUNT_JSON:
        info = json.loads(settings.GOOGLE_SERVICE_ACCOUNT_JSON)
        creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    else:
        creds = service_account.Credentials.from_service_account_file(settings.GOOGLE_SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    if settings.GOOGLE_DELEGATED_USER:
        creds = creds.with_subject(settings.GOOGLE_DELEGATED_USER)
    return AuthorizedSession(creds)


def _url(event_id: str = "") -> str:
    base = BASE.format(cal=settings.GOOGLE_CALENDAR_ID)
    return f"{base}/{event_id}" if event_id else base


def wants_event(deal: Deal) -> bool:
    return bool(deal.demo_date) and deal.stage not in GONE and not deal.is_sample


def event_body(deal: Deal) -> dict:
    """The event for a deal's demo / meeting time ("YYYY-MM-DDTHH:mm" in the team's time zone)."""
    tz = settings.TIME_ZONE
    try:
        start = datetime.fromisoformat(deal.demo_date[:16]).replace(tzinfo=ZoneInfo(tz))
    except ValueError:
        raise ServiceError("The demo date isn't a date and time. Fix it on the deal, then sync again.", code="bad_demo_date")
    end = start + timedelta(minutes=settings.CALENDAR_EVENT_MINUTES)
    c, ct = deal.company, deal.contact
    arival = deal.source == "Arival app meeting"
    who = ", ".join(x for x in [getattr(ct, "name", ""), getattr(ct, "title", "")] if x)
    lines = [
        f"{'Arival meeting' if arival else 'TourIQ demo'} with {c.name}" + (f" ({who})" if who else ""),
        deal.owner and f"Owner: {deal.owner.display_name}",
        c.platform and f"Booking platform: {c.platform}",
        f"Open the deal: {settings.FRONTEND_URL.rstrip('/')}/?deal={deal.id}",
    ]
    body = {
        "summary": f"{'Arival meeting' if arival else 'TourIQ demo'}: {c.name}",
        "description": "\n".join(x for x in lines if x),
        "start": {"dateTime": start.isoformat(), "timeZone": tz},
        "end": {"dateTime": end.isoformat(), "timeZone": tz},
        "extendedProperties": {"private": {"touriq_deal": str(deal.id)}},
    }
    if deal.meeting_url:
        body["location"] = deal.meeting_url
    elif arival:
        body["location"] = "Arival"
    if settings.GOOGLE_DELEGATED_USER:
        emails = [getattr(deal.owner, "email", "")]
        if ct and ct.email and not ct.opted_out and c.category != "competitor":
            emails.append(ct.email)
        body["attendees"] = [{"email": e} for e in dict.fromkeys(e for e in emails if e)]
        if not deal.meeting_url:
            body["conferenceData"] = {"createRequest": {"requestId": uuid.uuid4().hex, "conferenceSolutionKey": {"type": "hangoutsMeet"}}}
    return body


def sync_deal(deal: Deal, session=None) -> str:
    """Create, update or remove the deal's event. Returns what happened."""
    if not enabled():
        raise ServiceError("Google Calendar isn't set up on the server.", code="calendar_off", status=503)
    s = session or _session()
    params = {"sendUpdates": "all" if settings.GOOGLE_DELEGATED_USER else "none"}
    if not wants_event(deal):
        if not deal.calendar_event_id:
            return "none"
        r = s.delete(_url(deal.calendar_event_id), params=params, timeout=20)
        if r.status_code not in (200, 204, 404, 410):
            raise ServiceError(f"Google Calendar refused the change ({r.status_code}).", code="calendar_error", status=502)
        Deal.objects.filter(id=deal.id).update(calendar_event_id="")
        return "deleted"
    body = event_body(deal)
    if "conferenceData" in body:
        params["conferenceDataVersion"] = 1
    if deal.calendar_event_id:
        r = s.patch(_url(deal.calendar_event_id), params=params, json=body, timeout=20)
        if r.status_code in (404, 410):  # removed on the calendar by hand: make a new one
            r = s.post(_url(), params=params, json=body, timeout=20)
    else:
        r = s.post(_url(), params=params, json=body, timeout=20)
    if r.status_code >= 300:
        log.warning("Calendar sync failed for deal %s: %s %s", deal.id, r.status_code, r.text[:300])
        raise ServiceError(f"Google Calendar refused the event ({r.status_code}). Check the calendar is shared with the service account.",
                           code="calendar_error", status=502)
    ev = r.json()
    update = {"calendar_event_id": ev.get("id", "")}
    if not deal.meeting_url and ev.get("hangoutLink"):
        update["meeting_url"] = ev["hangoutLink"]
    Deal.objects.filter(id=deal.id).update(**update)
    return "updated" if deal.calendar_event_id else "created"


def delete_event(event_id: str, session=None) -> None:
    """Remove an event whose deal is gone."""
    if not enabled() or not event_id:
        return
    s = session or _session()
    s.delete(_url(event_id), params={"sendUpdates": "all" if settings.GOOGLE_DELEGATED_USER else "none"}, timeout=20)


def queue_delete(tenant_id, deal_id, event_id: str) -> None:
    """The deal is being deleted: remove its event once that commits."""
    if not enabled() or not event_id:
        return

    def send():
        from ..tasks import sync_calendar_task

        try:
            sync_calendar_task.apply_async((str(tenant_id), str(deal_id), event_id), retry=False)
        except Exception:
            log.warning("Couldn't queue the calendar removal for deal %s", deal_id, exc_info=True)

    transaction.on_commit(send)


def queue_sync(deal: Deal) -> None:
    """After the current change commits, sync in the worker. Never blocks or fails the request."""
    if not enabled() or deal.is_sample:
        return
    if not wants_event(deal) and not deal.calendar_event_id:
        return
    tenant_id, deal_id = str(deal.tenant_id), str(deal.id)

    def send():
        from ..tasks import sync_calendar_task  # tasks imports services

        try:
            sync_calendar_task.apply_async((tenant_id, deal_id), retry=False)
        except Exception:
            log.warning("Couldn't queue the calendar sync for deal %s (is the worker's Redis up?)", deal_id, exc_info=True)

    transaction.on_commit(send)
