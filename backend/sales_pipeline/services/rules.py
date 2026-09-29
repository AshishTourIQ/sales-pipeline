"""
Automation rules: which tasks a deal gets when it enters a stage.

Line-by-line port of frontend/src/modules/sales-pipeline/lib/rules.ts.
tests/test_rules.py pins the behaviour; change both files together.
"""
from dataclasses import dataclass
from datetime import date, timedelta

from django.utils import timezone


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
    elif to == "lost":
        if extra.loss_reason != "Unsubscribed":
            remind("r_lost", "Review: worth re-engaging?", _days(90))
    return out
