"""
Booth scoring. Pins the paper sheet's points and tiers, and checks the frontend
copy (config/template.ts) holds exactly the same questions, options and points.
"""
import json
import re
from pathlib import Path

import pytest

from sales_pipeline.config import SCORE_MAX, SCORE_QUESTIONS, TIER_BANDS
from sales_pipeline.services.scoring import clean_answers, score

TOP = {"booking": "fareharbor", "volume": "over_5m", "role": "decider", "timeline": "under_3m",
       "locations": "3_plus", "sellouts": "often", "pricing": "fixed", "drivers": "yes"}


def test_sheet_points():
    assert SCORE_MAX == 19
    assert [q for q, _, _ in SCORE_QUESTIONS] == ["booking", "volume", "role", "timeline", "locations", "sellouts", "pricing", "drivers"]
    assert TIER_BANDS == [("A", 15), ("B", 10), ("C", 5), ("D", 0)]


def test_top_score_is_a():
    s = score("operator", TOP)
    assert (s.points, s.tier_before_cap, s.capped, s.tier, s.complete) == (19, "A", False, "A", True)


@pytest.mark.parametrize("points_off,tier", [(4, "A"), (5, "B"), (9, "B"), (10, "C"), (13, "C")])
def test_bands(points_off, tier):
    # Take points off without touching role/booking (so no cap); those two alone give 6, so D is covered below
    lowers = [("volume", {3: "over_5m", 2: "1m_5m", 1: "250k_1m", 0: "under_250k"}, 3),
              ("timeline", {3: "under_3m", 2: "3_6m", 1: "6_12m", 0: "none"}, 3),
              ("locations", {2: "3_plus", 1: "2", 0: "1"}, 2),
              ("sellouts", {2: "often", 1: "sometimes", 0: "no"}, 2),
              ("pricing", {2: "fixed", 1: "rules", 0: "happy"}, 2),
              ("drivers", {1: "yes", 0: "no"}, 1)]
    a, left = dict(TOP), points_off
    for q, opts, top in lowers:
        take = min(left, top)
        a[q] = opts[top - take]
        left -= take
    assert left == 0
    s = score("operator", a)
    assert s.points == 19 - points_off and s.tier == tier and not s.capped


def test_cap_when_not_decider():
    s = score("operator", {**TOP, "role": "manager"})  # 17 points
    assert (s.points, s.tier_before_cap, s.tier, s.capped) == (17, "A", "B", True)


def test_cap_when_system_not_connected():
    s = score("operator", {**TOP, "booking": "ventrata_rezdy"})  # 17 points
    assert (s.tier_before_cap, s.tier, s.capped) == ("A", "B", True)


def test_peek_counts_as_connected():
    assert not score("operator", {**TOP, "booking": "peek"}).capped


def test_unanswered_decider_caps():
    a = dict(TOP)
    del a["role"]  # 16 points but decider not confirmed
    s = score("operator", a)
    assert (s.points, s.tier, s.capped, s.complete) == (16, "B", True, False)


def test_cap_never_raises_a_tier():
    s = score("operator", {"role": "staff", "booking": "other"})
    assert (s.points, s.tier, s.capped) == (0, "D", False)


def test_d_band():
    s = score("operator", {"role": "manager", "booking": "fareharbor"})
    assert (s.points, s.tier) == (4, "D")


def test_visitor_routes():
    assert score("competitor", TOP).tier == "D"
    assert score("vendor", {}).tier == "D"
    for v in ("consultant", "platform", "press"):
        assert score(v, TOP).tier == ""


def test_unknown_answers_dropped():
    assert clean_answers({"booking": "fareharbor", "role": "king", "shoe_size": "9"}) == {"booking": "fareharbor"}


def test_frontend_copy_matches():
    """config/template.ts BOOTH_QUESTIONS must hold the same keys, options and points."""
    ts = (Path(__file__).resolve().parents[3] / "frontend/src/modules/sales-pipeline/config/template.ts").read_text(encoding="utf-8")
    block = re.search(r"BOOTH_QUESTIONS[^=]*=\s*(\[.*?\n\]);", ts, re.S)
    assert block, "BOOTH_QUESTIONS not found in template.ts"
    # The TS literal is written as strict JSON so it can be compared here
    front = json.loads(block.group(1))
    back = [{"key": q, "label": label, "options": [{"key": o, "label": ol, "points": p} for o, ol, p in opts]} for q, label, opts in SCORE_QUESTIONS]
    assert front == back
