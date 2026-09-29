"""Pins rule_tasks() to the frontend's rules.ts behaviour."""
from datetime import timedelta

from django.utils import timezone

from sales_pipeline.config import DEFAULT_RULES
from sales_pipeline.services.rules import RuleExtra, rule_tasks

today = timezone.localdate()


def titles(ts):
    return [t.title for t in ts]


def test_outreach_creates_sequence():
    ts = rule_tasks("s4", DEFAULT_RULES)
    assert len(ts) == 6
    assert [t.due for t in ts] == [today, today, today + timedelta(3), today + timedelta(7), today + timedelta(14), today + timedelta(14)]
    # follow-ups are reminders; first message, LinkedIn and "they replied" block
    assert [t.blocking for t in ts] == [True, True, False, False, False, True]


def test_demo_tasks_land_day_before_demo():
    demo = (today + timedelta(days=5)).isoformat() + "T10:00"
    ts = rule_tasks("s6", DEFAULT_RULES, RuleExtra(demo_date=demo))
    assert [t.due for t in ts] == [today + timedelta(4)] * 2 + [today + timedelta(5)]  # prep x2, then "hold the demo" on the day


def test_demo_tomorrow_means_prep_today():
    demo = (today + timedelta(days=1)).isoformat() + "T10:00"
    assert [t.due for t in rule_tasks("s6", DEFAULT_RULES, RuleExtra(demo_date=demo))][:2] == [today, today]


def test_unsubscribe_gets_no_review():
    assert rule_tasks("lost", DEFAULT_RULES, RuleExtra(loss_reason="Unsubscribed")) == []
    assert titles(rule_tasks("lost", DEFAULT_RULES, RuleExtra(loss_reason="Price"))) == ["Review: worth re-engaging?"]


def test_rule_switched_off_and_skip():
    assert rule_tasks("s4", {**DEFAULT_RULES, "r_sequence": False}) == []
    assert titles(rule_tasks("s5", DEFAULT_RULES, RuleExtra(booth=True))) == ["Book the demo: tick when it's booked"]


def test_nurture_uses_check_back_date():
    d = today + timedelta(days=45)
    assert rule_tasks("nurture", DEFAULT_RULES, RuleExtra(reengage_date=d))[0].due == d


def test_live_check_ins():
    ts = rule_tasks("s13", DEFAULT_RULES)
    assert [t.due for t in ts] == [today + timedelta(n) for n in (30, 60, 90)]
    assert not any(t.blocking for t in ts)


def test_proposal_waits_for_signature():
    ts = rule_tasks("s10", DEFAULT_RULES)
    assert [(t.title, t.blocking) for t in ts] == [
        ("Review the proposal before it's sent", True), ("Chase the unsigned proposal", False),
        ("Second reminder on the proposal", False), ("Get the contract signed: tick when signed", True)]
