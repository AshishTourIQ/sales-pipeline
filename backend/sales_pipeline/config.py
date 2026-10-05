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
    # Optional: game / comparative analysis / audit sent, waiting for them to book a demo
    StageDef("offer", None, "Offer sent", "engage", 14, "param", optional=True),
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
# Integration partners: booking platforms and OTAs. Goal: a pilot client on their platform, then integrated.
PARTNER_TEMPLATE: list[StageDef] = [
    StageDef("pt1", 1, "Identified", "find", 7, "guddu"),
    StageDef("pt2", 2, "Partnerships contact", "find", 7, "guddu"),
    StageDef("pt3", 3, "Intro call", "engage", 14, "nikunj"),
    StageDef("pt4", 4, "Integration scoping", "win", 21, "manjit"),
    StageDef("pt5", 5, "Pilot client", "win", 30, "manjit"),
    StageDef("pt6", 6, "Integrated", "launch", None, "manjit"),
]
# Channel partners: OTAs (Viator, GetYourGuide). They already accept dynamic pricing: build the channel.
CHANNEL_TEMPLATE: list[StageDef] = [
    StageDef("ch1", 1, "Identified", "find", 7, "guddu"),
    StageDef("ch2", 2, "Partnerships contact", "find", 7, "guddu"),
    StageDef("ch3", 3, "Intro call", "engage", 14, "nikunj"),
    StageDef("ch4", 4, "Channel agreement", "win", 30, "nikunj"),
    StageDef("ch5", 5, "Channel live", "launch", None, "manjit"),
]
# Referral partners: revenue managers and agencies who bring clients for a commission (and the reverse)
REFERRAL_TEMPLATE: list[StageDef] = [
    StageDef("rf1", 1, "Identified", "find", 7, "param"),
    StageDef("rf2", 2, "Intro call", "engage", 14, "nikunj"),
    StageDef("rf3", 3, "Agreement", "win", 14, "nikunj"),
    StageDef("rf4", 4, "Active partner", "launch", None, "nikunj"),
]
_LANES = [s for s in TEMPLATE if s.lane]
# template key → (label, stages incl. the side lanes)
TEMPLATES: dict[str, tuple[str, list[StageDef]]] = {
    "touriq": ("Sales: tour operators", TEMPLATE),
    "partners": ("Integrations: booking platforms", PARTNER_TEMPLATE + _LANES),
    "channels": ("Channels: OTAs", CHANNEL_TEMPLATE + _LANES),
    "referrals": ("Referrals: revenue managers and agencies", REFERRAL_TEMPLATE + _LANES),
}
STAGES: dict[str, StageDef] = {s.key: s for _, stages in TEMPLATES.values() for s in stages}
STAGE_KEYS = [s.key for s in TEMPLATE]
STAGE_CHOICES = [(s.key, s.name) for s in TEMPLATE]

# Built-in main route order. A pipeline's actual order is its own stage list (services/stages.py);
# this is only used to map a removed built-in stage to the next one that still exists.
ORDER = ["s1", "s2", "s3", "s4", "s5", "offer", "s6", "s7", "s8", "s9", "pilot", "s10", "s11", "s12", "s13"]


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
    "Arival app meeting": "s6",
    "LinkedIn": "s5",
    "Instagram / Facebook": "s5",
    "Game": "s5",
    "Comparative analysis": "s5",
    "Audit": "s5",
    "Event booth": "s5",
    # "Request an account" inside Peek (intake key "Peek app"); company platform is Peek Pro
    "Peek app": "s5",
}
# Met in person at a stand; the event itself is Deal.event ("Arival 2026", "Spark 2026", ...)
BOOTH_SOURCES = {"Arival booth", "Spark booth", "Event booth"}
DEFAULT_EVENTS = ["Arival 2026", "Spark 2026"]


def entry_for_source(source: str) -> str:
    return SOURCES.get(source, "s1")


SEGMENTS = ["Water / boat", "Adventure", "Food / walking / city", "Attractions / multi-product", "Other"]
PLATFORMS = ["FareHarbor", "Peek Pro", "Ventrata", "Rezdy", "Xola", "Checkfront", "Bókun", "Other / unknown"]
LOSS_REASONS = ["Price", "Timing", "Wrong platform", "Chose a competitor", "No reply", "No budget", "Unsubscribed", "Not a prospect", "Other"]
# No "worth re-engaging?" review for these
# Set only by the system (an intake withdraw), never offered in the Lost dialog
SYSTEM_LOSS_REASONS = ["Deleted in Peek"]
NO_REVIEW_LOSS_REASONS = {"Unsubscribed", "Not a prospect", "Deleted in Peek"}
NURTURE_REASONS = ["Not now", "No reply after the sequence", "Unsupported platform", "Not a water operator yet", "No-show twice",
                   "Partner hand-off", "Press hand-off", "Other"]
PAY_STATUS = ["Not invoiced", "Invoiced", "Paid", "Late"]
INTERESTS = ["Hot", "Warm", "Cold"]
ACTIVITY_TYPES = ["note", "email", "call", "meeting", "ai"]

RULE_KEYS = [
    "r_capture48", "r_owner", "r_autoclose", "r_contact", "r_brief", "r_sequence", "r_reply", "r_offer", "r_demo",
    "r_followup", "r_qualify", "r_second", "r_pilot", "r_proposal", "r_signed", "r_onboard", "r_live",
    "r_nurture", "r_lost", "r_partner", "r_channel", "r_referral",
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
# Calls and meetings record which team members were on them (commission and involvement)
ATTENDED_TYPES = {"call", "meeting"}

# Speed to lead (services/speed.py): what counts as "the team reached out"
TOUCH_ACTIVITY_TYPES = {"email", "call", "meeting"}
TOUCH_TASK_RULES = {"r_capture48", "r_offer", "r_sequence", "r_reply"}
TIER_A_TOUCH_HOURS = 24  # Tier A with no touch after this long → alert

# After the demo the next call is either another demo for their team, or the commercial call (pricing)
CALL_TYPES: dict[str, str] = {"team_demo": "Team demo", "commercial": "Commercial call"}

# Who the company is to us. Competitors are never contacted (like an unsubscribed contact).
CATEGORIES: dict[str, str] = {
    "operator": "Tour operator", "booking_platform": "Booking platform", "ota": "OTA",
    "revenue_manager": "Revenue manager / consultant", "agency": "Agency / other software",
    "competitor": "Competitor", "other": "Other",
}
# Booth visitor type → company category
VISITOR_CATEGORY = {"operator": "operator", "platform": "booking_platform", "consultant": "revenue_manager",
                    "competitor": "competitor", "press": "other", "vendor": "other"}
# Partner hand-offs go to the pipeline built for their category
CATEGORY_TEMPLATE = {"booking_platform": "partners", "ota": "channels", "revenue_manager": "referrals", "agency": "referrals"}
# Company type from free text (imports, spreadsheets): first match wins
CATEGORY_WORDS: list[tuple[str, str]] = [
    ("competitor", "competitor"), ("ota", "ota"), ("viator", "ota"), ("getyourguide", "ota"), ("marketplace", "ota"),
    ("booking platform", "booking_platform"), ("booking system", "booking_platform"), ("platform", "booking_platform"),
    ("revenue", "revenue_manager"), ("consultant", "revenue_manager"),
    ("agency", "agency"), ("software", "agency"), ("marketing", "agency"),
    ("operator", "operator"), ("tour", "operator"), ("other", "other"),
]


def category_from_text(v: str) -> str:
    s = (v or "").strip().lower().replace("_", " ")
    if not s:
        return ""
    if s in CATEGORIES:
        return s
    by_label = {label.lower(): key for key, label in CATEGORIES.items()}
    if s in by_label:
        return by_label[s]
    return next((key for word, key in CATEGORY_WORDS if word in s), "other")

# Workspace links used in emails and AI drafts (Settings → Files and links)
LINK_KEYS: dict[str, str] = {
    "booking_link": "Demo booking link (calendar)",
    "demo_deck": "Demo deck (PDF or slides)",
    "audit_example": "Sample audit report",
    "analysis_example": "Sample comparative analysis",
    "game_link": "Pricing game link",
}
DEAL_LINKS_MAX = 10

# ---------- Booth lead form (the Arival paper sheet) ----------
# Must match frontend config/template.ts (BOOTH_*); tests/test_scoring.py pins both.
# Staff never see the points: the server scores the answers.

# Visitor type decides the route before any scoring
VISITOR_TYPES: dict[str, str] = {
    "operator": "Operator",
    "competitor": "Competitor",
    "consultant": "Consultant",
    "platform": "Booking platform / OTA",
    "press": "Press / Arival",
    "vendor": "Vendor / student",
}
PARTNER_VISITORS = {"consultant", "platform"}
NOT_PROSPECT_VISITORS = {"competitor", "vendor"}

# (question key, label, [(option key, label, points)])
SCORE_QUESTIONS: list[tuple[str, str, list[tuple[str, str, int]]]] = [
    ("booking", "Booking system", [
        ("fareharbor", "FareHarbor", 3), ("peek", "Peek Pro", 2), ("ventrata_rezdy", "Ventrata / Rezdy", 1), ("other", "Bókun / Xola / other", 0)]),
    ("volume", "Yearly bookings", [
        ("over_5m", "Over $5M", 3), ("1m_5m", "$1M–$5M", 2), ("250k_1m", "$250K–$1M", 1), ("under_250k", "Under $250K", 0)]),
    ("role", "Their role", [
        ("decider", "Owner / CEO / GM / revenue lead", 3), ("manager", "Manager / influencer", 1), ("staff", "Staff / other", 0)]),
    ("timeline", "Timeline", [
        ("under_3m", "Under 3 months", 3), ("3_6m", "3–6 months", 2), ("6_12m", "6–12 months", 1), ("none", "None", 0)]),
    ("locations", "Locations / brands", [("3_plus", "3 or more", 2), ("2", "2", 1), ("1", "1", 0)]),
    ("sellouts", "Sell-outs + empty seats", [("often", "Often", 2), ("sometimes", "Sometimes", 1), ("no", "No", 0)]),
    ("pricing", "Prices set today", [
        ("fixed", "Fixed / seasonal, open to change", 2), ("rules", "Rules or uses a tool", 1), ("happy", "Happy as is", 0)]),
    ("drivers", "Outside drivers", [("yes", "Yes (ships, flights, events, weather)", 1), ("no", "No", 0)]),
]
SCORE_MAX = sum(max(p for _, _, p in opts) for _, _, opts in SCORE_QUESTIONS)  # 19
# Lowest total for each tier, best first
TIER_BANDS: list[tuple[str, int]] = [("A", 15), ("B", 10), ("C", 5), ("D", 0)]
# Not the decider, or a booking system we aren't connected to: at most B
CAP_TIER = "B"
CAP_OK = {"role": {"decider"}, "booking": {"fareharbor", "peek"}}
# Booking-system answer → Company.platform (the combined options stay unset)
PLATFORM_FOR_BOOKING = {"fareharbor": "FareHarbor", "peek": "Peek Pro"}

OFFERS: dict[str, str] = {
    "demo_given": "Demo given",
    "demo_booked": "Demo booked",
    "audit": "Audit booked",
    "analysis": "Competitive analysis",
    "game": "Game only",
}
OFFER_FOR_TIER = {"A": "demo_booked", "B": "audit", "C": "analysis", "D": "game"}
# Offers that put the deal on a track in the "Offer sent" stage (the rest go straight to a demo)
TRACKS: dict[str, str] = {"game": "Game", "analysis": "Comparative analysis", "audit": "Audit"}
TIER_INTEREST = {"A": "Hot", "B": "Warm", "C": "Warm", "D": "Cold"}

# Follow-up owner (by username) and days until due, per tier and hand-off.
# Admins change these in Settings; stored values override.
FOLLOWUP_KEYS = ["A", "B", "C", "D", "partner", "press"]
BOOTH_FOLLOWUP_DEFAULTS: dict[str, tuple[str, int]] = {
    "A": ("nikunj", 0), "B": ("manjit", 2), "C": ("manjit", 3), "D": ("param", 7), "partner": ("nikunj", 3), "press": ("param", 3),
}


# ---------- Outreach (the Arival outreach tracker) ----------
# Steps a person ticks with a date, in the tracker's column order. Channel = which column group.
OUTREACH_STEPS: dict[str, tuple[str, str]] = {
    "li_note": ("linkedin", "Connection note sent"),
    "li_msg": ("linkedin", "Message sent"),
    "li_reply": ("linkedin", "Reply received"),
    "li_demo": ("linkedin", "Demo set"),
    "em_draft": ("email", "Email drafted"),
    "em_sent": ("email", "Email sent"),
    "em_follow": ("email", "Follow-up sent"),
    "em_reply": ("email", "Reply received"),
    "app_sent": ("app", "Arival app message sent"),
    "app_reply": ("app", "Arival app reply"),
    "cal_demo": ("calendar", "Demo booked (TourIQ calendar)"),
    "arival_meeting": ("calendar", "Arival meeting"),
}
# Ticking these needs an approved draft of this channel (the P1 owner may skip drafts)
OUTREACH_SEND_STEPS = {"li_note": "li_note", "li_msg": "li_msg", "em_sent": "email", "em_follow": "email_follow", "app_sent": "app"}
OUTREACH_PRIORITIES = ["P1", "P2", "P3", "P4", "Review", "Skip"]
# Never messaged: duplicates, competitors
OUTREACH_NO_CONTACT = {"Skip"}
# Checks before any draft (per person); the company's research must be verified too
OUTREACH_VERIFY = {
    "company": "It's the right company (name and website match)",
    "person": "The person works there in this role (LinkedIn or the company site)",
    "contact_info": "Email and LinkedIn are theirs, not a shared inbox",
}
# Research needed before the company counts as verified
OUTREACH_RESEARCH_REQUIRED = ["booking_platform", "example_tour", "listed_price", "sources"]
OUTREACH_RESEARCH_FIELDS = OUTREACH_RESEARCH_REQUIRED + ["price_variation", "demand_language", "size", "unverified", "notes"]
# No LinkedIn reply after this many days → send the email
LINKEDIN_TO_EMAIL_DAYS = 2
# No email reply after this many days → send the follow-up (the tracker's own rule)
EMAIL_FOLLOW_UP_DAYS = 7
# Arival tracker "Segment" → company category (and so which pipeline the company lands in)
ARIVAL_SEGMENTS = {
    "tour / activity operator": "operator", "attraction operator": "operator",
    "booking platform / connectivity": "booking_platform", "ota / distribution": "ota",
    "marketing / agency": "agency", "other technology": "agency",
}
