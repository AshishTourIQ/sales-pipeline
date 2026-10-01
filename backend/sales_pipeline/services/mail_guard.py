"""
Last check before any email leaves (team mail in notify.py, lead mail in client_mail.py).

- Dummy addresses (example.com, *.test, *.invalid, *.example, localhost) are never sent to.
- EMAIL_REDIRECT_TO (testing): every email goes to that one inbox instead, with a note
  saying who it was meant for. Nobody else receives anything.
"""
import logging
from dataclasses import dataclass
from html import escape

from django.conf import settings

log = logging.getLogger(__name__)
DUMMY_DOMAINS = ("example.com", "example.org", "example.net", "localhost")
DUMMY_TLDS = (".test", ".invalid", ".example", ".localhost")


@dataclass
class Outgoing:
    to: list[str]
    subject: str
    html: str
    text: str
    # Addresses we didn't send to, and why (for the log)
    skipped: list[str]


def domain(addr: str) -> str:
    return addr.rsplit("@", 1)[-1].strip().lower() if "@" in addr else ""


def is_dummy(addr: str) -> bool:
    d = domain(addr)
    return not d or d in DUMMY_DOMAINS or d.endswith(DUMMY_TLDS)


def prepare(to: list[str], subject: str, html: str, text: str) -> Outgoing:
    """The recipients and content that may actually be sent (maybe none)."""
    wanted = [t.strip() for t in to if t and t.strip()]
    skipped = [f"{t} (dummy address)" for t in wanted if is_dummy(t)]
    real = [t for t in wanted if not is_dummy(t)]
    redirect = settings.EMAIL_REDIRECT_TO.strip()
    if redirect and real:
        meant = ", ".join(real)
        subject = f"[TEST for {meant}] {subject}"
        text = f"Test mode: this email was meant for {meant}. It was sent to {redirect} instead.\n\n{text}"
        html = (f'<p style="background:#FFF4E5;color:#8A4B00;padding:8px 12px;border-radius:6px;font-family:sans-serif;font-size:13px">'
                f"Test mode: this email was meant for <b>{escape(meant)}</b>. It was sent to {escape(redirect)} instead.</p>{html}")
        real = [redirect]
    if skipped:
        log.info("Email '%s' not sent to: %s", subject, "; ".join(skipped))
    return Outgoing(sorted(set(real)), subject, html, text, skipped)
