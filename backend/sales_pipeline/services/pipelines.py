"""Pipelines, per-pipeline stage settings, tenant settings and the sales team."""
from django.contrib.auth import get_user_model

from ..config import DEFAULT_RULES, DEFAULT_TARGETS, LINK_KEYS, STAGES, TEMPLATES
from ..models import Pipeline, PipelineSettings
from . import stages
from .errors import ServiceError
from .stages import ResolvedStage

User = get_user_model()


def stage_def(pipeline: Pipeline, key: str) -> ResolvedStage:
    """The stage as configured on this pipeline (a removed/unknown key gets a neutral stand-in)."""
    found = stages.get(pipeline, key)
    if found:
        return found
    base = STAGES.get(key)
    return ResolvedStage(key=key, name=base.name if base else key, phase=base.phase if base else "lanes", limit=None, owner_id="",
                         lane=bool(base and base.lane), optional=False, custom=base is None, description="", num=None)


def stage_enabled(pipeline: Pipeline, key: str) -> bool:
    return stages.exists(pipeline, key)


def team_users(tenant_id):
    return User.objects.filter(tenant_id=tenant_id, is_sales_team=True, is_active=True).order_by("full_name", "username")


def create_pipeline(tenant_id, name: str, template: str = "touriq") -> Pipeline:
    if template not in TEMPLATES:
        raise ServiceError("Unknown pipeline template.", code="invalid_template")
    owners = {u.username: str(u.id) for u in team_users(tenant_id)}
    return Pipeline.objects.create(tenant_id=tenant_id, name=name.strip() or "Pipeline", template=template,
                                   pilot_enabled=template == "touriq", stages=stages.default_list(owners, template))


def valid_owner_ids(tenant_id) -> set[str]:
    return {str(i) for i in User.objects.filter(tenant_id=tenant_id).values_list("id", flat=True)}


def clean_stage_overrides(tenant_id, pipeline: Pipeline, edits) -> list[dict]:
    """PATCH of stage settings (list, or the old {key: {...}} map): rename, limits, owners, descriptions."""
    if isinstance(edits, dict):
        edits = [{"key": k, **(v or {})} for k, v in edits.items()]
    return stages.update_list(pipeline, edits or [], valid_owner_ids(tenant_id))


def get_settings(tenant_id) -> PipelineSettings:
    s, _ = PipelineSettings.objects.get_or_create(tenant_id=tenant_id)
    return s


def rules_for(tenant_id) -> dict[str, bool]:
    return {**DEFAULT_RULES, **(get_settings(tenant_id).rules or {})}


def update_settings(tenant_id, data: dict) -> PipelineSettings:
    s = get_settings(tenant_id)
    if "rules" in data:
        rules = data["rules"] or {}
        s.rules = {k: bool(rules.get(k, s.rules.get(k, True))) for k in DEFAULT_RULES}
    if "targets" in data:
        targets = data["targets"] or {}
        try:
            s.targets = {k: max(0, int(targets.get(k, s.targets.get(k, v)))) for k, v in DEFAULT_TARGETS.items()}
        except (TypeError, ValueError):
            raise ServiceError("Targets must be whole numbers.", code="invalid_targets")
    if "team" in data:
        set_team(tenant_id, data["team"] or [])
    if "links" in data:
        links = {**(s.links or {})}
        for k, v in (data["links"] or {}).items():
            if k not in LINK_KEYS:
                continue
            url = str(v or "").strip()[:600]
            if url and not url.lower().startswith(("http://", "https://")):
                url = f"https://{url}"
            links[k] = url
        s.links = links
    if "event_costs" in data:
        costs = {**(s.event_costs or {})}
        for name, amount in (data["event_costs"] or {}).items():
            name = str(name).strip()[:120]
            if not name:
                continue
            if amount is None:
                costs.pop(name, None)
            else:
                costs[name] = float(amount)
        if len(costs) > 100:
            raise ServiceError("Up to 100 events can have a cost.", code="too_many_events")
        s.event_costs = costs
    if "outreach" in data:
        cfg = {**(s.outreach or {})}
        if "p1_user_id" in (data["outreach"] or {}):
            uid = str(data["outreach"]["p1_user_id"] or "")
            if uid and uid not in valid_owner_ids(tenant_id):
                raise ServiceError("That person isn't part of this workspace.", code="invalid_user")
            cfg["p1_user_id"] = uid
        if "app_sender_ids" in (data["outreach"] or {}):
            ids = [str(i) for i in (data["outreach"]["app_sender_ids"] or []) if i]
            valid = valid_owner_ids(tenant_id)
            if any(i not in valid for i in ids):
                raise ServiceError("Someone picked isn't part of this workspace.", code="invalid_user")
            cfg["app_sender_ids"] = list(dict.fromkeys(ids))
        s.outreach = cfg
    s.save()
    return s


def set_team(tenant_id, members: list[dict]) -> None:
    """The team is the tenant's users flagged as sales team. Unknown people must be added as users first."""
    ids = {str(m.get("id")) for m in members if m.get("id")}
    users = {str(u.id): u for u in User.objects.filter(tenant_id=tenant_id)}
    unknown = ids - users.keys()
    if unknown:
        raise ServiceError(
            "Add this person as a user first (Django admin), then add them to the team.",
            code="unknown_team_member",
        )
    for uid, u in users.items():
        want = uid in ids
        if u.is_sales_team != want:
            u.is_sales_team = want
            u.save(update_fields=["is_sales_team"])
