"""
TourIQ pipeline template: stages, sources, rules. Must match the frontend's
src/modules/sales-pipeline/config/template.ts (same keys, limits, owners).
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class StageDef:
    key: str
    num: int | None
    name: str
    phase: str
    limit: int | None  # max days in stage; None = no limit
    owner: str  # default owner, by username (resolved to a user id per tenant)
    optional: bool = False
    lane: bool = False


TEMPLATE: list[StageDef] = [
    StageDef("s1", 1, "Target list", "find", 3, "guddu"),
    StageDef("s2", 2, "Contact found", "find", 2, "guddu"),
    StageDef("s3", 3, "Researched", "find", 2, "param"),
    StageDef("s4", 4, "Outreach sent", "engage", 14, "param"),
    StageDef("s5", 5, "Replied", "engage", 2, "param"),
    StageDef("s6", 6, "Demo booked", "engage", 7, "manjit"),
    StageDef("s7", 7, "Demo done", "win", 1, "manjit"),
    StageDef("s8", 8, "Qualified", "win", 3, "manjit"),
    StageDef("s9", 9, "Second call", "win", 10, "manjit"),
    StageDef("pilot", None, "Pilot", "win", 30, "manjit", optional=True),
    StageDef("s10", 10, "Proposal", "win", 14, "nikunj"),
    StageDef("s11", 11, "Signed", "win", 1, "nikunj"),
    StageDef("s12", 12, "Onboarding", "launch", 21, "manjit"),
    StageDef("s13", 13, "Live", "launch", None, "manjit"),
    StageDef("nurture", None, "Nurture", "lanes", None, "param", lane=True),
    StageDef("lost", None, "Lost", "lanes", None, "param", lane=True),
]
STAGES: dict[str, StageDef] = {s.key: s for s in TEMPLATE}
STAGE_KEYS = [s.key for s in TEMPLATE]
STAGE_CHOICES = [(s.key, s.name) for s in TEMPLATE]

# Built-in main route order. A pipeline's actual order is its own stage list (services/stages.py);
# this is only used to map a removed built-in stage to the next one that still exists.
ORDER = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "pilot", "s10", "s11", "s12", "s13"]


def order_index(stage: str) -> int:
    return ORDER.index(stage) if stage in ORDER else -1


# Lead source → entry stage
SOURCES: dict[str, str] = {
    "Arival booth": "s5",
    "Spark booth": "s5",
    "Arival report / newsletter": "s3",
    "Outbound list": "s1",
    "Pre-show outreach": "s4",
    "Partner referral": "s5",
    "Client referral": "s5",
    "Platform / OTA intro": "s5",
    "Inbound (website, video)": "s6",
    "Pre-booked meeting": "s6",
    "Existing client (expansion)": "s5",
}
BOOTH_SOURCES = {"Arival booth", "Spark booth"}


def entry_for_source(source: str) -> str:
    return SOURCES.get(source, "s1")


SEGMENTS = ["Water / boat", "Adventure", "Food / walking / city", "Attractions / multi-product", "Other"]
PLATFORMS = ["FareHarbor", "Peek Pro", "Ventrata", "Rezdy", "Xola", "Checkfront", "Bókun", "Other / unknown"]
LOSS_REASONS = ["Price", "Timing", "Wrong platform", "Chose a competitor", "No reply", "No budget", "Unsubscribed", "Other"]
NURTURE_REASONS = ["Not now", "No reply after the sequence", "Unsupported platform", "Not a water operator yet", "No-show twice", "Other"]
PAY_STATUS = ["Not invoiced", "Invoiced", "Paid", "Late"]
INTERESTS = ["Hot", "Warm", "Cold"]
ACTIVITY_TYPES = ["note", "email", "call", "meeting", "ai"]

RULE_KEYS = [
    "r_capture48", "r_owner", "r_autoclose", "r_contact", "r_brief", "r_sequence", "r_reply", "r_demo",
    "r_followup", "r_qualify", "r_second", "r_pilot", "r_proposal", "r_signed", "r_onboard", "r_live",
    "r_nurture", "r_lost",
]
DEFAULT_RULES = {k: True for k in RULE_KEYS}
DEFAULT_TARGETS = {"leads": 300, "outreach": 150, "demosHeld": 30, "snapshots": 100, "signed": 2}

PILOT_CAP = 5

# Stage checklists (must match frontend QUAL_ITEMS / PILOT_ITEMS / ONBOARD_ITEMS).
# Every item must be ticked before the deal can move forward from that stage.
CHECKLISTS: dict[str, tuple[str, list[str]]] = {
    "s8": ("qual", ["volume", "dm", "platform", "vertical", "budget"]),
    "pilot": ("pilot_checks", ["capacity", "terms", "connected", "results"]),
    "s12": ("onboarding", ["connect", "push", "ml", "factors", "alerts", "tz", "kickoff", "firstprice"]),
}

ACTIVITY_CAP = 150  # newest activities kept per deal

