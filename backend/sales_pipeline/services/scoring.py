"""
Booth lead scoring: the Arival paper sheet's point system.

Staff only tick answers; points, tier and the cap are worked out here from
config.SCORE_QUESTIONS. Mirror of frontend lib/scoring.ts; tests/test_scoring.py
pins both against the same cases.
"""
from dataclasses import dataclass

from ..config import CAP_OK, CAP_TIER, NOT_PROSPECT_VISITORS, SCORE_QUESTIONS, TIER_BANDS, VISITOR_TYPES

_POINTS: dict[str, dict[str, int]] = {q: {o: p for o, _, p in opts} for q, _, opts in SCORE_QUESTIONS}
_TIER_ORDER = [t for t, _ in TIER_BANDS]


@dataclass(frozen=True)
class Score:
    points: int
    tier_before_cap: str  # "" when the visitor isn't scored (partner, press)
    capped: bool
    tier: str
    # Every question answered
    complete: bool


def clean_answers(answers: dict | None) -> dict[str, str]:
    """Keep only known questions with a known option."""
    return {q: str(o) for q, o in (answers or {}).items() if q in _POINTS and str(o) in _POINTS[q]}


def tier_for(points: int) -> str:
    return next(t for t, low in TIER_BANDS if points >= low)


def score(visitor: str, answers: dict | None) -> Score:
    if visitor in NOT_PROSPECT_VISITORS:
        return Score(0, "D", False, "D", True)
    if visitor != "operator":
        # Partners and press are handed off, not scored
        return Score(0, "", False, "", True)
    a = clean_answers(answers)
    points = sum(_POINTS[q][o] for q, o in a.items())
    before = tier_for(points)
    # Cap unless both the decider and the booking system are confirmed
    cap = any(a.get(q) not in ok for q, ok in CAP_OK.items())
    tier = before
    if cap and _TIER_ORDER.index(before) < _TIER_ORDER.index(CAP_TIER):
        tier = CAP_TIER
    return Score(points, before, tier != before, tier, len(a) == len(_POINTS))


def valid_visitor(v: str) -> bool:
    return v in VISITOR_TYPES


def option_label(question: str, option: str) -> str:
    for q, _, opts in SCORE_QUESTIONS:
        if q == question:
            return next((label for o, label, _ in opts if o == option), "")
    return ""
