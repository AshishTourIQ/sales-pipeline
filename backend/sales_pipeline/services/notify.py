"""
Email to the team (alerts, digests, invites) through SMTP (EMAIL_* in .env), the same
account as the emails to leads (client_mail.py), sent as STAFF_EMAIL_FROM_NAME.

Without EMAIL_HOST / EMAIL_HOST_USER, emails are logged and kept in OUTBOX instead of
sent, so local dev and tests never send real mail.
"""
import logging
from dataclasses import dataclass
from html import escape

from django.conf import settings
from django.core.mail import EmailMultiAlternatives

from . import mail_guard

log = logging.getLogger(__name__)


@dataclass
class Email:
    to: list[str]
    subject: str
    html: str
    text: str


# Captured emails when email isn't configured (dev/tests)
OUTBOX: list[Email] = []


def send_email(to: list[str], subject: str, html: str, text: str) -> bool:
    """Returns True if the mail server took it, False if only logged (not configured, or the send failed)."""
    to = sorted({t for t in to if t})
    if not to:
        return False
    email = Email(to, subject, html, text)
    if not settings.EMAIL_ENABLED:
        OUTBOX.append(email)
        log.info("Email (not sent, EMAIL_HOST not configured) to=%s subject=%s", to, subject)
        return False
    out = mail_guard.prepare(to, subject, html, text)
    if not out.to:
        return False
    to, subject, html, text = out.to, out.subject, out.html, out.text
    msg = EmailMultiAlternatives(subject=subject, body=text, to=to,
                                 from_email=f"{settings.STAFF_EMAIL_FROM_NAME} <{settings.EMAIL_HOST_USER}>")
    msg.attach_alternative(html, "text/html")
    try:
        msg.send(fail_silently=False)
        return True
    except Exception:
        # Never let an email failure break a job: raising would roll back the run's
        # DealAlert claims and re-send every other recipient's alert next run.
        log.exception("Email send failed to=%s subject=%s", to, subject)
        return False


def deal_url(deal_id) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/?deal={deal_id}"


def render(title: str, intro: str, rows: list[tuple[str, str, str]]) -> tuple[str, str]:
    """Simple branded HTML + plain text. rows = (label, detail, link)."""
    items_html = "".join(
        f'<tr><td style="padding:10px 0;border-top:1px solid #E5E7EB">'
        f'<a href="{escape(link)}" style="color:#1A1C21;font-weight:600;text-decoration:none">{escape(label)}</a>'
        f'<div style="color:#5A606C;font-size:13px;margin-top:2px">{escape(detail)}</div></td></tr>'
        for label, detail, link in rows
    )
    html = (
        '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1A1C21">'
        '<div style="height:4px;background:#F15A24;border-radius:2px;margin-bottom:18px"></div>'
        f'<h2 style="font-size:18px;margin:0 0 6px">{escape(title)}</h2>'
        f'<p style="color:#5A606C;margin:0 0 12px">{escape(intro)}</p>'
        f'<table style="width:100%;border-collapse:collapse;font-size:14px">{items_html}</table>'
        '<p style="color:#8B919C;font-size:12px;margin-top:20px">TourIQ sales pipeline</p></div>'
    )
    text = f"{title}\n\n{intro}\n\n" + "\n".join(f"- {label}: {detail}\n  {link}" for label, detail, link in rows)
    return html, text
