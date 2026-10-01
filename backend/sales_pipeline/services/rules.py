"""
Automation rules: which tasks a deal gets when it enters a stage.

Line-by-line port of frontend/src/modules/sales-pipeline/lib/rules.ts.
tests/test_rules.py pins the behaviour; change both files together.
"""
from dataclasses import dataclass
from datetime import date, timedelta

from django.utils import timezone

from ..config import NO_REVIEW_LOSS_REASONS


@dataclass(frozen=True)
class RuleTask:
    rule: str
    title: str
    due: date
    # Reminders ("just in case" follow-ups) don't block moving to the next stage
    blocking: bool = True


@dataclass
class RuleExtra:
    demo_date: str = ""  # "YYYY-MM-DDTHH:mm" or ""
    reengage_date: date | None = None
    loss_reason: str = ""
    # Booth leads were met in person: no "answer the reply" task
    booth: bool = False
    # "Offer sent": the track (game, analysis, audit) and when the offer should go out
    offer: str = ""
    offer_due: date | None = None
    # "Offer sent", game track: did they already play at the booth? (None = not known)
    game_played: bool | None = None
    # Second call (s9): "team_demo" | "commercial"
    call_type: str = ""


def _days(n: int, base: date | None = None) -> date:
    return (base or timezone.localdate()) + timedelta(days=n)


def rule_tasks(to: str, rules: dict[str, bool], extra: RuleExtra | None = None) -> list[RuleTask]:
    extra = extra or RuleExtra()
    today = timezone.localdate()
    out: list[RuleTask] = []

    def add(rule: str, title: str, due: date, blocking: bool = True) -> None:
        if rules.get(rule, True) is not False:
            out.append(RuleTask(rule, title, due, blocking))

    def remind(rule: str, title: str, due: date) -> None:
        add(rule, title, due, blocking=False)

    demo = None
    if extra.demo_date:
        try:
            demo = date.fromisoformat(extra.demo_date[:10])
        except ValueError:
            demo = None
    before_demo = (demo - timedelta(days=1) if (demo - today).days > 1 else today) if demo else _days(2)

    if to == "s2":
        add("r_contact", "Confirm the decision-maker and check LinkedIn by hand", _days(2))
    elif to == "s3":
        add("r_brief", "Read and approve the research brief", _days(2))
    elif to == "s4":
        add("r_sequence", "Send the first message with the Pricing Snapshot offer", today)
        add("r_sequence", "LinkedIn: send a connection request by hand", today)
        remind("r_sequence", "Follow-up 1 (day 3): one useful line and the calendar link", _days(3))
        remind("r_sequence", "Follow-up 2 (day 7): proof, a video or the report", _days(7))
        remind("r_sequence", "Follow-up 3 (day 14): break-up message; move to Nurture if still quiet", _days(14))
        add("r_sequence", "They replied: tick when they answer", _days(14))
    elif to == "s5":
        if not extra.booth:
            add("r_reply", "Answer the reply within 2 hours, with the booking link", today)
        add("r_reply", "Book the demo: tick when it's booked", _days(2))
    elif to == "offer":
        send = extra.offer_due or today
        if extra.offer == "audit":
            add("r_offer", "Send the audit form for their booking data", send)
            add("r_offer", "Send them the audit report", _days(7))
        elif extra.offer == "analysis":
            add("r_offer", "Run the comparative analysis and send it", send)
        elif extra.offer == "game":
            add("r_offer", "Send them the game link and the demo link" if extra.game_played is False
                else "Send their game result and the demo link", send)
        else:
            add("r_offer", "Send what was offered, with the demo link", send)
        remind("r_offer", "Reminder (day 3): ask them to book a demo", _days(3))
        remind("r_offer", "Reminder (day 7): ask again to book a demo", _days(7))
        remind("r_offer", "No demo after 14 days: move to Nurture", _days(14))
        add("r_offer", "Demo booked: tick when they book", _days(14))
    elif to == "s6":
        add("r_demo", "Prep the demo: read the brief, pick their own tours", before_demo)
        add("r_demo", "Get the Pricing Snapshot ready before the demo", before_demo)
        add("r_demo", "Hold the demo: tick when it's done", demo or _days(7))
    elif to == "s7":
        add("r_followup", "Send the follow-up with recap and Snapshot", _days(1))
        add("r_followup", "Book the next call or meeting", today)
    elif to == "s8":
        add("r_qualify", "Decide go / no-go with the qualification checklist", _days(3))
    elif to == "s9":
        if extra.call_type == "team_demo":
            add("r_second", "Find out who else needs to see it (team, partners, owner)", _days(1))
            add("r_second", "Prep the team demo on their own tours", _days(3))
            add("r_second", "Hold the team demo: tick when it's done", _days(10))
            remind("r_second", "After the team demo: book the commercial call", _days(10))
        elif extra.call_type == "commercial":
            add("r_second", "Prepare pricing: package, locations, per-location fee, revenue share", _days(2))
            add("r_second", "Send the pricing summary before the call", _days(3))
            add("r_second", "Hold the commercial call: tick when it's done", _days(7))
            remind("r_second", "Chase their decision on pricing", _days(10))
        else:
            add("r_second", "Build the Pricing Snapshot on their data", _days(3))
            add("r_second", "Hold the second call", _days(10))
    elif to == "pilot":
        add("r_pilot", "Agree pilot terms: length, scope, price", _days(2))
        add("r_pilot", "Confirm the capacity fixes are done before starting", _days(2))
        add("r_pilot", "Review pilot results with the client", _days(30))
    elif to == "s10":
        add("r_proposal", "Review the proposal before it's sent", _days(1))
        remind("r_proposal", "Chase the unsigned proposal", _days(3))
        remind("r_proposal", "Second reminder on the proposal", _days(7))
        add("r_proposal", "Get the contract signed: tick when signed", _days(14))
    elif to == "s11":
        add("r_signed", "Hand over to onboarding with all notes", today)
        add("r_signed", "Send the welcome email", today)
        add("r_signed", "Send the first invoice", today)
    elif to == "s12":
        add("r_onboard", "Hold the kickoff call; send the 'what we need from you' list", _days(2))
    elif to == "s13":
        remind("r_live", "Day-30 check-in: is everything working?", _days(30))
        remind("r_live", "Day-60 check-in: first uplift; ask for a referral", _days(60))
        remind("r_live", "Day-90 check-in: full report; ask for a case study", _days(90))
    elif to == "nurture":
        remind("r_nurture", "Re-engage: fresh Snapshot or new content", extra.reengage_date or _days(60))
    # ---- Partnerships pipeline (booking platforms, OTAs) ----
    elif to == "pt2":
        add("r_partner", "Find the head of partnerships or integrations; check LinkedIn by hand", _days(3))
    elif to == "pt3":
        add("r_partner", "Send the intro: our FareHarbor / Peek integration story and the booking link", today)
        add("r_partner", "Hold the intro call: tick when it's done", _days(14))
        remind("r_partner", "Follow up on the intro", _days(5))
    elif to == "pt4":
        add("r_partner", "Share what we need: API access, price push, test account", _days(3))
        add("r_partner", "Agree the integration plan and an owner on their side", _days(21))
    elif to == "pt5":
        add("r_partner", "Pick a pilot client on their platform", _days(7))
        add("r_partner", "Launch the pilot client and review the results", _days(30))
    elif to == "pt6":
        remind("r_partner", "Announce the integration: joint post or newsletter", _days(7))
        remind("r_partner", "Monthly partner check-in", _days(30))
    # ---- Channels pipeline (OTAs) ----
    elif to == "ch2":
        add("r_channel", "Find the head of partnerships or integrations; check LinkedIn by hand", _days(3))
    elif to == "ch3":
        add("r_channel", "Send the intro: dynamic prices for their operators, fed straight to their listings", today)
        add("r_channel", "Hold the intro call: tick when it's done", _days(14))
        remind("r_channel", "Follow up on the intro", _days(5))
    elif to == "ch4":
        add("r_channel", "Agree how prices reach them (API or feed) and the terms", _days(7))
        add("r_channel", "Get the channel agreement signed: tick when signed", _days(30))
    elif to == "ch5":
        remind("r_channel", "Get the first operator live through the channel", _days(14))
        remind("r_channel", "Monthly channel check-in", _days(30))
    # ---- Referrals pipeline (revenue managers, agencies) ----
    elif to == "rf2":
        add("r_referral", "Hold the intro call: which operators they work with, how they sell", _days(14))
    elif to == "rf3":
        add("r_referral", "Agree the commission % and terms (both ways)", _days(3))
        add("r_referral", "Get the referral agreement signed: tick when signed", _days(14))
    elif to == "rf4":
        remind("r_referral", "Monthly check-in: new referrals? Send them fresh material", _days(30))
    elif to == "lost":
        if extra.loss_reason not in NO_REVIEW_LOSS_REASONS:
            remind("r_lost", "Review: worth re-engaging?", _days(90))
    return out
