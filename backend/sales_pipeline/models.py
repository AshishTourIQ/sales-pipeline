"""
Sales pipeline tables. Every table carries tenant_id and is protected by a
Postgres Row-Level Security policy (see migrations/0002_rls.py).
"""
import uuid

from django.conf import settings
from django.db import models

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

    class Meta:
        constraints = [models.UniqueConstraint(fields=["tenant"], name="sp_settings_one_per_tenant")]


class Pipeline(TenantModel):
    """One pipeline per product (TourIQ, TipFlow, ...)."""

    name = models.CharField(max_length=120)
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
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["tenant", "name"])]
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
    created_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["tenant", "pipeline", "stage"]),
            models.Index(fields=["tenant", "owner"]),
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
