"""
Sales pipeline tables. Every table carries tenant_id and is protected by a
Postgres Row-Level Security policy (see migrations/0002_rls.py).
"""
import uuid

from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Upper
from django.db.models.fields.json import KeyTextTransform

from .config import DEFAULT_RULES, DEFAULT_TARGETS

USER = settings.AUTH_USER_MODEL


def _default_rules() -> dict:
    return dict(DEFAULT_RULES)


def _default_targets() -> dict:
    return dict(DEFAULT_TARGETS)


def _default_payment() -> dict:
    return {"status": "Not invoiced"}


class TenantModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("core.Tenant", on_delete=models.CASCADE, related_name="+")

    class Meta:
        abstract = True


class PipelineSettings(TenantModel):
    """One row per tenant: automation switches and dashboard targets."""

    rules = models.JSONField(default=_default_rules)
    targets = models.JSONField(default=_default_targets)
    # Booth form follow-up per tier / hand-off: {"A": {"owner_id", "days"}, ...}; missing keys use config defaults
    booth_followup = models.JSONField(default=dict, blank=True)
    # Links used in emails and AI drafts: {"booking_link", "demo_deck", "audit_example", "analysis_example"}
    links = models.JSONField(default=dict, blank=True)
    # What each event cost (booth, travel, sponsorship), for cost per lead / demo / signed: {"Arival 2026": 12000}
    event_costs = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["tenant"], name="sp_settings_one_per_tenant")]


class Pipeline(TenantModel):
    """One pipeline per product (TourIQ, TipFlow, ...)."""

    name = models.CharField(max_length=120)
    # "touriq" (sales), "partners" (booking platforms, OTAs) or "referrals" (revenue managers, agencies)
    template = models.CharField(max_length=40, default="touriq")
    pilot_enabled = models.BooleanField(default=True)
    # Ordered stage list: [{key, name, phase, limit, owner_id, optional?, lane?, custom?, description?}]
    # (see services/stages.py). Older rows may hold the legacy {key: overrides} map.
    stages = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return self.name


class Company(TenantModel):
    name = models.CharField(max_length=200)
    website = models.CharField(max_length=300, blank=True)
    region = models.CharField(max_length=200, blank=True)
    segment = models.CharField(max_length=80, blank=True)
    platform = models.CharField(max_length=80, blank=True)
    products5 = models.BooleanField(default=False)
    sells_out = models.BooleanField(default=False)
    reachable = models.BooleanField(default=False)
    # operator | booking_platform | ota | revenue_manager | agency | competitor | other ("" = not set)
    category = models.CharField(max_length=20, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["tenant", "name"]),
            # Case-insensitive name lookups (intake matching, "already in the pipeline?", import)
            models.Index(F("tenant"), Upper("name"), name="company_tenant_upper_name"),
        ]
        verbose_name_plural = "companies"

    def __str__(self) -> str:
        return self.name


class Contact(TenantModel):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="contacts")
    name = models.CharField(max_length=200, blank=True)
    title = models.CharField(max_length=200, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=60, blank=True)
    linkedin = models.CharField(max_length=300, blank=True)
    decision_maker = models.BooleanField(default=False)
    # Unsubscribed: never email this contact again
    opted_out = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Case-insensitive email lookups (intake, recorded calls, "already in the pipeline?")
        indexes = [models.Index(F("tenant"), Upper("email"), name="contact_tenant_upper_email")]

    def __str__(self) -> str:
        return self.name or self.email or "Contact"


class Deal(TenantModel):
    pipeline = models.ForeignKey(Pipeline, on_delete=models.CASCADE, related_name="deals")
    company = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="deals")
    contact = models.ForeignKey(Contact, null=True, blank=True, on_delete=models.SET_NULL, related_name="deals")
    stage = models.CharField(max_length=16)
    stage_changed_at = models.DateTimeField()
    owner = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="owned_deals")
    source = models.CharField(max_length=80, blank=True)
    # The event where the lead came from ("Arival 2026", "Spark 2026", ...), or ""
    event = models.CharField(max_length=120, blank=True)
    interest = models.CharField(max_length=8, blank=True)
    fit = models.DecimalField(max_digits=3, decimal_places=1, default=0)
    value = models.CharField(max_length=60, blank=True)
    package = models.CharField(max_length=120, blank=True)
    locations = models.CharField(max_length=60, blank=True)
    snapshot_sent = models.BooleanField(default=False)
    # Local "YYYY-MM-DDTHH:mm" as picked in the browser, or ""
    demo_date = models.CharField(max_length=16, blank=True)
    loss_reason = models.CharField(max_length=80, blank=True)
    loss_competitor = models.CharField(max_length=120, blank=True)
    nurture_reason = models.CharField(max_length=80, blank=True)
    reengage_date = models.DateField(null=True, blank=True)
    qual = models.JSONField(default=dict, blank=True)
    pilot_checks = models.JSONField(default=dict, blank=True)
    onboarding = models.JSONField(default=dict, blank=True)
    # {"status", "invoice", "amount", "paid_at", "invoiced_at"}
    payment = models.JSONField(default=_default_payment)
    signed_at = models.DateField(null=True, blank=True)
    live_at = models.DateField(null=True, blank=True)
    is_sample = models.BooleanField(default=False)
    # Speed to lead (services/speed.py): first time the team reached out, first demo booked or held
    first_touch_at = models.DateTimeField(null=True, blank=True)
    demo_at = models.DateTimeField(null=True, blank=True)
    # Booth staff who met them (commission and involvement tracking)
    met_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    # The booth sheet: {client_id, visitor, answers, offer, game_played, game_score, met_at, destination, runs,
    # pricing_tool}. Only answers are stored; points and tier are scored from them (services/scoring.py).
    booth = models.JSONField(default=dict, blank=True)
    # The offer track while waiting for a demo: "game" | "analysis" | "audit" | ""
    track = models.CharField(max_length=16, blank=True)
    # After the demo (stage s9): "team_demo" | "commercial" | ""
    call_type = models.CharField(max_length=16, blank=True)
    # Looks after the client once signed (monthly calls); counts for involvement
    account_manager = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="managed_deals")
    # Files for this deal: [{"label", "url"}] (their audit report, proposal, ...)
    links = models.JSONField(default=list, blank=True)
    # Referral partners: the commission we pay them, in percent
    commission_pct = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    # Two-way referrals (agencies, other software): the commission they pay us, in percent
    commission_in_pct = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    # The demo / meeting on the team's Google Calendar (see services/calendar.py)
    calendar_event_id = models.CharField(max_length=200, blank=True)
    # Where the call happens (Google Meet from the calendar event, or a Zoom link); matches Recall recordings
    meeting_url = models.CharField(max_length=500, blank=True)
    created_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["tenant", "pipeline", "stage"]),
            models.Index(fields=["tenant", "owner"]),
        ]
        constraints = [
            # A booth save sent twice (Save pressed again, offline retry, two tabs) is one deal
            models.UniqueConstraint(
                F("tenant"), KeyTextTransform("client_id", "booth"),
                condition=Q(booth__has_key="client_id") & ~Q(booth__client_id=""),
                name="deal_booth_client_id_unique",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.company.name} ({self.stage})"


class StageHistory(TenantModel):
    """Append-only log of every stage change. Can't be rebuilt later, so never skip it."""

    deal = models.ForeignKey(Deal, on_delete=models.CASCADE, related_name="history")
    from_stage = models.CharField(max_length=16, blank=True)
    to_stage = models.CharField(max_length=16)
    at = models.DateTimeField()
    by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    # Name at the time of the change (also covers imports and samples)
    by_name = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["at", "id"]
        verbose_name_plural = "stage history"


class Activity(TenantModel):
    deal = models.ForeignKey(Deal, on_delete=models.CASCADE, related_name="activities")
    type = models.CharField(max_length=16)
    text = models.TextField()
    at = models.DateTimeField()
    by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    by_name = models.CharField(max_length=200, blank=True)
    # Calls and meetings: team members who were on it (user ids), for commission and involvement
    attendees = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["at", "id"]
        verbose_name_plural = "activities"


class Task(TenantModel):
    pipeline = models.ForeignKey(Pipeline, on_delete=models.CASCADE, related_name="tasks")
    deal = models.ForeignKey(Deal, null=True, blank=True, on_delete=models.CASCADE, related_name="tasks")
    title = models.CharField(max_length=300)
    owner = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="pipeline_tasks")
    due = models.DateField(null=True, blank=True)
    done = models.BooleanField(default=False)
    done_at = models.DateTimeField(null=True, blank=True)
    # Created by an automation rule or a stage task (vs a one-off by a person)
    auto = models.BooleanField(default=False)
    # Must be done before the deal can move forward from `stage`. Reminders don't block.
    blocking = models.BooleanField(default=True)
    template = models.ForeignKey("StageTaskTemplate", null=True, blank=True, on_delete=models.SET_NULL, related_name="tasks")
    auto_closed = models.BooleanField(default=False)
    rule = models.CharField(max_length=24, blank=True)
    stage = models.CharField(max_length=16, blank=True)
    is_sample = models.BooleanField(default=False)
    created_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField()

    class Meta:
        indexes = [
            models.Index(fields=["tenant", "pipeline", "done"]),
            models.Index(fields=["tenant", "owner", "done", "due"]),
        ]

    def __str__(self) -> str:
        return self.title


class StageTaskTemplate(TenantModel):
    """
    "Guddu must do X in stage 1": added to every deal in that stage owned by that
    person, now and whenever one enters the stage later.
    """

    pipeline = models.ForeignKey(Pipeline, on_delete=models.CASCADE, related_name="stage_tasks")
    stage = models.CharField(max_length=16)
    owner = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="stage_task_templates")
    title = models.CharField(max_length=300)
    # Due this many days after the deal enters the stage (0 = same day)
    due_in_days = models.PositiveSmallIntegerField(default=1)
    active = models.BooleanField(default=True)
    created_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["tenant", "pipeline", "stage", "owner", "active"])]

    def __str__(self) -> str:
        return f"{self.stage}: {self.title}"


class Touchpoint(TenantModel):
    """
    One step of a lead's journey: played the game, viewed or received the comparative
    analysis, sent booking data for the audit, got the audit report, booked or held a demo.
    Recorded by the booth form, the pipeline itself, a person, or the intake API.
    """

    KINDS = [
        ("game_link_sent", "Game link emailed"),
        ("game_played", "Played the game"),
        ("analysis_requested", "Comparative analysis requested"),
        ("analysis_viewed", "Viewed the comparative analysis"),
        ("analysis_sent", "Comparative analysis report sent"),
        ("audit_submitted", "Sent booking data for the audit"),
        ("audit_report_sent", "Audit report sent"),
        ("demo_requested", "Asked for a demo"),
        ("demo_booked", "Demo booked"),
        ("demo_held", "Demo held"),
    ]
    SOURCES = [("booth", "Booth"), ("intake", "Intake API"), ("pipeline", "Pipeline"), ("manual", "Person")]

    deal = models.ForeignKey(Deal, on_delete=models.CASCADE, related_name="touchpoints")
    kind = models.CharField(max_length=24, choices=KINDS)
    source = models.CharField(max_length=12, choices=SOURCES, default="manual")
    at = models.DateTimeField()
    # Game score, or a short value the tool reports
    score = models.CharField(max_length=40, blank=True)
    # The report / result page (view-only link from the tool)
    link = models.URLField(max_length=600, blank=True)
    detail = models.CharField(max_length=500, blank=True)
    # Idempotency key from the intake API: the same event twice is recorded once
    external_id = models.CharField(max_length=120, blank=True)
    by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    by_name = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["at", "id"]
        indexes = [models.Index(fields=["tenant", "kind"])]
        constraints = [models.UniqueConstraint(fields=["tenant", "external_id"], condition=~models.Q(external_id=""),
                                               name="sp_touchpoint_external_once")]


class IntakeKey(TenantModel):
    """
    A key for one outside tool (game, comparative analysis, audit) to post events to
    /intake/. The key is shown once; only its SHA-256 is stored. The key text carries
    the tenant id, so the lookup runs inside that tenant's RLS scope.
    """

    name = models.CharField(max_length=80)
    key_hash = models.CharField(max_length=64, unique=True)
    # First characters of the secret, to tell keys apart in Settings
    prefix = models.CharField(max_length=12)
    active = models.BooleanField(default=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class RecallMeeting(TenantModel):
    """
    A call recorded by Recall.ai. The webhook stores it; a job fetches the transcript and
    participants, matches it to a deal, logs it with the team attendees and adds an AI
    summary. Unmatched ones wait in Settings → Integrations for a person to link.
    """

    STATUSES = [("pending", "Waiting to be processed"), ("processing", "Being processed"), ("logged", "Logged on a deal"),
                ("unmatched", "No deal found"), ("dismissed", "Dismissed"), ("failed", "Failed")]

    bot_id = models.CharField(max_length=64)
    recording_id = models.CharField(max_length=64, blank=True)
    transcript_id = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=12, choices=STATUSES, default="pending")
    title = models.CharField(max_length=300, blank=True)
    # Normalised meeting code (Meet "abc-defg-hij", Zoom meeting id) used for matching
    meeting_ref = models.CharField(max_length=120, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    # [{"name", "email", "is_host"}]
    participants = models.JSONField(default=list, blank=True)
    transcript = models.TextField(blank=True)
    deal = models.ForeignKey(Deal, null=True, blank=True, on_delete=models.SET_NULL, related_name="recordings")
    # How it was matched: meeting_url | title | email | name | manual
    matched_by = models.CharField(max_length=12, blank=True)
    error = models.CharField(max_length=300, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["tenant", "bot_id"], name="sp_recall_bot_once")]
        indexes = [models.Index(fields=["tenant", "status"])]


class DealAlert(TenantModel):
    """Remembers which alerts were sent, so each breach is emailed once."""

    deal = models.ForeignKey(Deal, on_delete=models.CASCADE, related_name="alerts")
    kind = models.CharField(max_length=40)  # e.g. "stuck:s4:2026-10-01T..."
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["deal", "kind"], name="sp_alert_once")]


class AiDraftLog(TenantModel):
    """One row per Claude call: for cost tracking and debugging (no prompt text stored)."""

    deal = models.ForeignKey(Deal, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    user = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    action = models.CharField(max_length=16)
    model = models.CharField(max_length=60, blank=True)
    ok = models.BooleanField(default=True)
    error_code = models.CharField(max_length=40, blank=True)
    input_tokens = models.IntegerField(default=0)
    output_tokens = models.IntegerField(default=0)
    cache_read_tokens = models.IntegerField(default=0)
    ms = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["tenant", "created_at"])]
