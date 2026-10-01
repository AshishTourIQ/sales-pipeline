"""
Email to leads (clients), through SMTP (EMAIL_* in .env), sent as EMAIL_FROM_NAME.
Team email (alerts, digests, invites) is notify.py, same account. The first use here:
the booth form emails the game link to a
"Game only" lead who hasn't played yet.

Without EMAIL_HOST / EMAIL_HOST_USER nothing is sent and the caller gets the reason,
so a lead is always saved whether or not the email goes out.
"""
import logging
from dataclasses import dataclass
from html import escape

from django.conf import settings
from django.core.mail import EmailMultiAlternatives

from ..models import Deal
from . import mail_guard
from .pipelines import get_settings

log = logging.getLogger(__name__)


@dataclass
class Sent:
    ok: bool
    detail: str  # shown to the person who saved the lead


def enabled() -> bool:
    return bool(settings.EMAIL_ENABLED)


def send(to: str, subject: str, html: str, text: str, reply_to: str = "") -> Sent:
    if not enabled():
        return Sent(False, "client email isn't set up on the server (EMAIL_HOST in .env)")
    out = mail_guard.prepare([to], subject, html, text)
    if not out.to:
        return Sent(False, f"{to} can't be emailed from here ({out.skipped[0].split('(')[-1].rstrip(')') if out.skipped else 'blocked'})")
    redirected = out.to != [to]
    subject, html, text = out.subject, out.html, out.text
    msg = EmailMultiAlternatives(
        subject=subject, body=text, from_email=f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_HOST_USER}>",
        to=out.to, reply_to=[reply_to] if reply_to and not redirected else None,
    )
    msg.attach_alternative(html, "text/html")
    try:
        msg.send(fail_silently=False)
    except Exception as e:  # noqa: BLE001 - SMTP down or refused: the lead is still saved
        log.warning("Client email to %s failed", to, exc_info=True)
        return Sent(False, f"the email server refused it ({type(e).__name__})")
    return Sent(True, f"test mode: sent to {out.to[0]} instead" if redirected else "")


def game_link(tenant_id) -> str:
    """Settings → Files and links → Pricing game link, else GAME_LINK from .env (a placeholder for now)."""
    return (get_settings(tenant_id).links or {}).get("game_link") or settings.GAME_LINK


def analysis_draft(deal: Deal, website: str) -> tuple[str, str]:
    """(subject, text) of the email that will carry the comparative analysis report. Drafted now, sent later.
    The analysis finds their top competitors itself, from their website."""
    first = (deal.contact.name.split(" ")[0] if deal.contact_id and deal.contact.name else "") or "there"
    booking = (get_settings(deal.tenant_id).links or {}).get("booking_link", "")
    subject = f"Your comparative analysis: {deal.company.name}"
    text = (f"Hi {first},\n\n"
            f"Here is the comparative analysis we promised at the booth: {deal.company.name} ({website or 'your website'}) "
            "compared with your top competitors. It covers your markets and locations, tours, capacity and prices, and where "
            "the others price differently.\n\n"
            "View the report: [report link]\n\n"
            + (f"Want to see what dynamic pricing would do with this? Book a short demo: {booking}\n\n" if booking
               else "Want to see what dynamic pricing would do with this? Reply and we'll book a short demo.\n\n")
            + "TourIQ, dynamic pricing for tour operators. Reply \"no thanks\" and we won't email again.")
    return subject, text


def game_invite(deal: Deal, *, event: str = "") -> tuple[str, str, str]:
    """(subject, html, text) for the "play the pricing game" email."""
    first = (deal.contact.name.split(" ")[0] if deal.contact_id and deal.contact.name else "") or "there"
    link = game_link(deal.tenant_id)
    booking = (get_settings(deal.tenant_id).links or {}).get("booking_link", "")
    where = f" at {event}" if event else ""
    subject = "Your TourIQ pricing game link"
    demo_html = (f'<p style="color:#3B4049;margin:0 0 16px;line-height:1.5">Want to see it on your own tours? '
                 f'<a href="{escape(booking)}" style="color:#F15A24">Book a short demo</a>.</p>') if booking else ""
    html = (
        '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1A1C21">'
        '<div style="height:4px;background:#F15A24;border-radius:2px;margin-bottom:22px"></div>'
        f'<p style="color:#3B4049;margin:0 0 8px;line-height:1.5">Hi {escape(first)},</p>'
        f'<p style="color:#3B4049;margin:0 0 16px;line-height:1.5">Thanks for stopping by the TourIQ booth{escape(where)}. '
        'Here is the pricing game: pick the price for a few real days, then see what TourIQ would have charged and how close you were. '
        'It takes about five minutes, and the top scores go on the leaderboard.</p>'
        f'<p style="margin:0 0 22px"><a href="{escape(link)}" style="display:inline-block;background:#F15A24;color:#fff;'
        'font-weight:600;text-decoration:none;padding:11px 20px;border-radius:8px">Play the pricing game</a></p>'
        f'{demo_html}'
        f'<p style="color:#8B919C;font-size:12px;margin:0 0 4px;word-break:break-all">If the button doesn\'t work: {escape(link)}</p>'
        '<p style="color:#8B919C;font-size:12px;margin:0">TourIQ, dynamic pricing for tour operators. Reply "no thanks" and we won\'t email again.</p></div>'
    )
    text = (f"Hi {first},\n\nThanks for stopping by the TourIQ booth{where}. Here is the pricing game: pick the price for a few "
            f"real days, then see what TourIQ would have charged and how close you were. It takes about five minutes, and the "
            f"top scores go on the leaderboard.\n\nPlay the pricing game: {link}\n"
            + (f"\nWant to see it on your own tours? Book a short demo: {booking}\n" if booking else "")
            + "\nTourIQ, dynamic pricing for tour operators. Reply \"no thanks\" and we won't email again.")
    return subject, html, text
