"""
AI drafts with Claude (server-side only; the key never reaches the browser).

- Writing (research brief, first message, follow-ups): AI_MODEL_SMART (Sonnet 4.6)
- Classification / extraction (reply tag, call summary, next step): AI_MODEL_FAST (Haiku 4.5)
- Structured answers use messages.parse() with Pydantic models, so the output
  is schema-validated before anyone sees it.
- Claude drafts; a person checks and sends. Nothing here sends email.
"""
import logging
from dataclasses import dataclass
from typing import Literal

import anthropic
from django.conf import settings
from pydantic import BaseModel, ValidationError

from ..models import Deal, Task
from .errors import ServiceError
from .flags import days_in_stage
from . import stages as stage_list
from .pipelines import stage_def

log = logging.getLogger(__name__)

# ---------- static instructions (kept byte-identical so they can be cached) ----------

SYSTEM_PROMPT = """You help the sales team at TourIQ, which sells dynamic pricing for tour operators. The operator stays in control: every price comes with its reasons and they approve or override it.

TourIQ facts and wording rules:
- Call TourIQ "dynamic pricing for tour operators". Never say "surge pricing" or "revenue operations".
- Never invent a number. Label any sample number "illustrative".
- FareHarbor is the only live integration (live sync and price push). Peek Pro is built but not live. Ventrata, Rezdy and Xola are coming (CSV import only). Other platforms: no integration.
- Only water and marine tours are proven. Don't claim air or land tours work.
- Never name customers, partners or competitors.
- Plain words, the operator's point of view, short. One idea per message.

You write drafts that a person reviews and sends. Use only the facts you are given; you cannot browse the web. Mark every guess as a guess."""


FOLLOW_UPS = {
    "3": "Follow-up 1, sent 3 days after the first message: one useful, specific line about their tours and the calendar link again as [booking link]. Under 50 words.",
    "7": "Follow-up 2, sent on day 7: proof. Point to a short video or the Modern Pricing Report as [link], with one line on why it matters to them. Under 60 words. Don't invent results.",
    "14": "Follow-up 3, sent on day 14: a short, friendly break-up message that leaves the door open for later. Under 45 words.",
    "reply": "An answer to their latest reply (in the notes). Answer their question or objection plainly and offer a 30-minute demo on their own tours with [booking link]. Under 90 words.",
}


# ---------- structured outputs ----------

class ReplyTag(BaseModel):
    tag: Literal["interested", "not_now", "wrong_person", "no", "unsubscribe"]
    interest: Literal["Hot", "Warm", "Cold"]
    objection: str
    summary: str
    response: str


class CallSummary(BaseModel):
    needs: list[str]
    objections: list[str]
    booking_platform: str
    locations: str
    decision_maker: str
    budget_signals: str
    next_step: str
    follow_up_email: str


TAG_LABELS = {"interested": "Interested", "not_now": "Not now", "wrong_person": "Wrong person", "no": "No", "unsubscribe": "Unsubscribed"}


@dataclass
class DraftResult:
    text: str
    tag: str | None = None
    truncated: bool = False
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0


# ---------- context ----------

def deal_context(deal: Deal) -> str:
    c, ct = deal.company, deal.contact
    lines = [
        f"Company: {c.name or 'unknown'}",
        c.website and f"Website: {c.website}",
        c.region and f"Region: {c.region}",
        c.segment and f"Segment: {c.segment}",
        c.platform and f"Booking platform: {c.platform}",
        f"5+ products or many departures: {'yes' if c.products5 else 'unknown'}",
        f"Sells out often: {'yes' if c.sells_out else 'unknown'}",
        "Contact: " + (", ".join(x for x in [getattr(ct, 'name', ''), getattr(ct, 'title', '')] if x) or "unknown"),
        f"Lead source: {deal.source or 'unknown'}",
        deal.interest and f"Interest level: {deal.interest}",
        f"Pipeline stage: {stage_def(deal.pipeline, deal.stage).name}",
        f"Pricing Snapshot: {'sent' if deal.snapshot_sent else 'not sent yet'}",
    ]
    notes = list(deal.activities.order_by("-at")[:8])[::-1]
    text = "\n".join(x for x in lines if x)
    if notes:
        text += "\nRecent notes:\n" + "\n".join(f"- [{a.type}, {a.at:%d %b}] {a.text[:900]}" for a in notes)
    return text


def build_prompt(action: str, deal: Deal, option: str = "", pasted: str = "") -> str:
    ctx = deal_context(deal)
    if action == "brief":
        return ("Write a one-page research brief a sales rep reads before contacting this prospect.\n\n"
                "Use these short plain-text headings: What they sell; Size and locations; Booking platform (and what it means for TourIQ today); "
                "How they likely price today; Likely pain points; Suggested angle for the first message; Check before contacting.\n\n"
                f"<prospect>\n{ctx}\n</prospect>")
    if action == "first":
        return ("Draft a first cold email from TourIQ to this prospect. Subject line under 7 words. Body under 80 words, plain words from the operator's point of view. "
                "The hook is a free Pricing Snapshot on one of their tours, showing what their pricing may be leaving on the table. No pitch deck. "
                "End with one simple question or the booking link written as [booking link]. Last line: \"Reply 'no thanks' and I won't write again.\"\n\n"
                "Return exactly:\nSubject: ...\n\n(body)\n\n"
                f"<prospect>\n{ctx}\n</prospect>")
    if action == "follow":
        return (f"Draft this email to the prospect: {FOLLOW_UPS.get(option, FOLLOW_UPS['3'])}\n\n"
                "Return exactly:\nSubject: ...\n\n(body)\n\n"
                f"<prospect>\n{ctx}\n</prospect>")
    if action == "tag":
        return ("Classify this reply to a TourIQ sales email and draft the response. In `response`, write a reply under 90 words: "
                "if interested include [booking link]; if unsubscribe confirm removal politely; if wrong_person ask who handles pricing. "
                "Use an empty string for objection when there is none.\n\n"
                f"<prospect>\n{ctx}\n</prospect>\n\n<their_reply>\n{pasted}\n</their_reply>")
    if action == "summary":
        return ("Turn these demo or call notes into structured pipeline notes. Use only what the notes say; use an empty string or empty list when something wasn't mentioned. "
                "follow_up_email: under 120 words, a recap and the agreed next step.\n\n"
                f"<prospect>\n{ctx}\n</prospect>\n\n<notes>\n{pasted}\n</notes>")
    if action == "next":
        open_tasks = "\n".join(f"- {t.title} ({t.due or 'no date'})" for t in Task.objects.filter(deal=deal, done=False).order_by("due")[:20]) or "none"
        return (f"The pipeline stages are: {stage_list.route_text(deal.pipeline)}.\n"
                "Suggest the single best next step for this deal as 3 short lines: what to do, why, and by when. Keep it to what a small team can do this week.\n\n"
                f"<deal>\n{ctx}\nDays in current stage: {days_in_stage(deal)}\nOpen tasks:\n{open_tasks}\n</deal>")
    raise ServiceError("Unknown AI action.", code="invalid_action")


def format_tag(r: ReplyTag) -> str:
    return (f"Tag: {TAG_LABELS[r.tag]} ({r.interest})\n" + (f"Objection: {r.objection}\n" if r.objection else "")
            + f"Summary: {r.summary}\n\nSuggested reply:\n{r.response}")


def format_summary(r: CallSummary) -> str:
    def lst(xs: list[str]) -> str:
        return "\n".join(f"- {x}" for x in xs) if xs else "- Not mentioned"
    return (f"Needs\n{lst(r.needs)}\n\nObjections\n{lst(r.objections)}\n\n"
            f"Booking platform: {r.booking_platform or 'Not mentioned'}\nLocations: {r.locations or 'Not mentioned'}\n"
            f"Decision-maker: {r.decision_maker or 'Not mentioned'}\nBudget signals: {r.budget_signals or 'Not mentioned'}\n"
            f"Next step: {r.next_step or 'Not agreed'}\n\nFollow-up email draft\n{r.follow_up_email}")


# ---------- calling Claude ----------

_client: anthropic.Anthropic | None = None


def get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=float(settings.AI_TIMEOUT_SECONDS), max_retries=2)
    return _client


MODEL_FOR = {"brief": "smart", "first": "smart", "follow": "smart", "tag": "fast", "summary": "fast", "next": "fast"}


def model_for(action: str) -> str:
    return settings.AI_MODEL_SMART if MODEL_FOR[action] == "smart" and settings.AI_MODEL_SMART else settings.AI_MODEL_FAST


def _usage(res, out: DraftResult) -> DraftResult:
    u = getattr(res, "usage", None)
    if u is not None:
        out.input_tokens = getattr(u, "input_tokens", 0) or 0
        out.output_tokens = getattr(u, "output_tokens", 0) or 0
        out.cache_read_tokens = getattr(u, "cache_read_input_tokens", 0) or 0
    return out


def generate(action: str, prompt: str) -> DraftResult:
    """One Claude call. Raises ServiceError with a code the frontend understands."""
    if not settings.AI_ENABLED:
        raise ServiceError("AI drafts aren't set up on the server yet.", code="not_granted", status=503)
    model = model_for(action)
    system = [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}]
    messages = [{"role": "user", "content": prompt}]
    client = get_client()
    try:
        if action in ("tag", "summary"):
            schema = ReplyTag if action == "tag" else CallSummary
            res = client.messages.parse(model=model, max_tokens=4000, system=system, messages=messages, output_format=schema)
            if res.stop_reason == "refusal":
                raise ServiceError("Claude declined this one. Rephrase the notes and try again.", code="refused", status=422)
            parsed = res.parsed_output
            if parsed is None:
                raise ServiceError("The answer came back in the wrong shape. Try again.", code="invalid_json", status=502)
            if action == "tag":
                return _usage(res, DraftResult(text=format_tag(parsed), tag=parsed.tag, model=model))
            return _usage(res, DraftResult(text=format_summary(parsed), model=model))

        res = client.messages.create(model=model, max_tokens=4000, system=system, messages=messages)
        if res.stop_reason == "refusal":
            raise ServiceError("Claude declined this one. Try different notes.", code="refused", status=422)
        text = "".join(b.text for b in res.content if b.type == "text").strip()
        out = DraftResult(text=text, truncated=res.stop_reason == "max_tokens", model=model)
        if out.truncated:
            out.text += "\n\n(Cut short. Ask for less at a time.)"
        return _usage(res, out)
    except ServiceError:
        raise
    except ValidationError:
        raise ServiceError("The answer came back in the wrong shape. Try again.", code="invalid_json", status=502)
    except anthropic.RateLimitError:
        raise ServiceError("Too many drafts at once. Wait a minute and try again.", code="rate_limited", status=429)
    except anthropic.BadRequestError as e:
        if "too long" in str(e).lower():
            raise ServiceError("That's too much text. Paste a shorter part.", code="prompt_too_large", status=413)
        log.warning("Claude rejected the request: %s", e)
        raise ServiceError("Couldn't get a draft. Try again in a moment.", code="ai_error", status=502)
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError):
        log.error("Claude API key is invalid or lacks permission")
        raise ServiceError("AI drafts aren't available: the server's API key was rejected.", code="not_granted", status=503)
    except anthropic.APITimeoutError:
        raise ServiceError("Claude took too long. Try again.", code="timeout", status=504)
    except anthropic.APIConnectionError:
        raise ServiceError("Couldn't reach Claude. Try again in a moment.", code="network", status=503)
    except anthropic.APIStatusError as e:
        log.warning("Claude API error %s", e.status_code)
        raise ServiceError("Couldn't get a draft. Try again in a moment.", code="ai_error", status=502)
