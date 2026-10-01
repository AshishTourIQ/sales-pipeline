"""
A pipeline's stages: an ordered, editable list stored on Pipeline.stages.

Each entry: {key, name, phase, limit, owner_id, optional?, lane?, custom?, description?}
- Built-in keys (s1..s13, pilot) keep their automation (rule tasks, checklists,
  special behaviour). Custom stages (key "c_...") have none; you give them stage tasks.
- Nurture and Lost are side lanes: always present, never removable, never numbered.
- The main route = non-lane stages in list order. Numbers follow that order.
- Optional stages (Pilot) are only entered by choice, never by "next stage".

Anything that used to assume the fixed 13 stages asks this module instead.
"""
import secrets
from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone

from ..config import ORDER, SOURCES, STAGES, TEMPLATE, TEMPLATES
from ..models import Deal, Pipeline, StageTaskTemplate, Task
from .errors import ServiceError

PHASES = ["find", "engage", "win", "launch"]
LANES = ["nurture", "lost"]


@dataclass(frozen=True)
class ResolvedStage:
    key: str
    name: str
    phase: str
    limit: int | None
    owner_id: str
    lane: bool
    optional: bool
    custom: bool
    description: str
    num: int | None


def default_list(owner_ids: dict[str, str], template: str = "touriq") -> list[dict]:
    """A pipeline template as a stage list; owner usernames resolved to user ids."""
    return [
        {
            "key": s.key, "name": s.name, "phase": s.phase, "limit": s.limit, "owner_id": owner_ids.get(s.owner, ""),
            **({"optional": True} if s.optional else {}), **({"lane": True} if s.lane else {}),
        }
        for s in TEMPLATES.get(template, TEMPLATES["touriq"])[1]
    ]


def raw_list(pipeline: Pipeline) -> list[dict]:
    """Stored list, tolerating the old dict format and always ending with both lanes."""
    stored = pipeline.stages
    if isinstance(stored, dict):  # legacy {key: overrides}
        stored = [{**_template_entry(t.key), **(stored.get(t.key) or {})} for t in TEMPLATE]
    items = [dict(s) for s in (stored or []) if isinstance(s, dict) and s.get("key")]
    keys = {s["key"] for s in items}
    for lane in LANES:
        if lane not in keys:
            items.append(_template_entry(lane))
    # lanes always last, in a fixed order
    return [s for s in items if s["key"] not in LANES] + [next(s for s in items if s["key"] == k) for k in LANES]


def _template_entry(key: str) -> dict:
    t = STAGES[key]
    return {"key": key, "name": t.name, "phase": t.phase, "limit": t.limit, "owner_id": "",
            **({"optional": True} if t.optional else {}), **({"lane": True} if t.lane else {})}


def resolved(pipeline: Pipeline) -> list[ResolvedStage]:
    """Stages in order, Pilot dropped when switched off, main stages numbered 1..n."""
    out: list[ResolvedStage] = []
    n = 0
    for s in raw_list(pipeline):
        key = s["key"]
        base = STAGES.get(key)
        lane = key in LANES
        optional = bool(s.get("optional", base.optional if base else False))
        if key == "pilot" and not pipeline.pilot_enabled:
            continue
        num = None
        if not lane and not optional:
            n += 1
            num = n
        limit = s.get("limit", base.limit if base else None)
        out.append(ResolvedStage(
            key=key, name=s.get("name") or (base.name if base else key), phase=s.get("phase") or (base.phase if base else "win"),
            limit=None if limit in (None, "") else int(limit), owner_id=str(s.get("owner_id") or ""),
            lane=lane, optional=optional, custom=key not in STAGES, description=s.get("description") or "", num=num,
        ))
    return out


def get(pipeline: Pipeline, key: str) -> ResolvedStage | None:
    return next((s for s in resolved(pipeline) if s.key == key), None)


def exists(pipeline: Pipeline, key: str) -> bool:
    return get(pipeline, key) is not None


def main_keys(pipeline: Pipeline) -> list[str]:
    """The main route (lanes excluded), in order."""
    return [s.key for s in resolved(pipeline) if not s.lane]


def is_forward(pipeline: Pipeline, frm: str, to: str) -> bool:
    route = main_keys(pipeline)
    return frm in route and to in route and route.index(to) > route.index(frm)


def next_stage(pipeline: Pipeline, key: str) -> str | None:
    """Where a finished stage goes: the next non-optional main stage."""
    route = [s for s in resolved(pipeline) if not s.lane]
    keys = [s.key for s in route]
    if key not in keys:
        return None
    for s in route[keys.index(key) + 1:]:
        if not s.optional:
            return s.key
    return None


def index_of(pipeline: Pipeline, key: str) -> int:
    route = main_keys(pipeline)
    return route.index(key) if key in route else -1


def resolve(pipeline: Pipeline, key: str) -> str:
    """A built-in stage that was removed maps to the next stage that still exists."""
    if exists(pipeline, key):
        return key
    # Optional stages (Pilot, Offer sent) are only entered by choice, never as a stand-in
    route = [s.key for s in resolved(pipeline) if not s.lane and not s.optional]
    if key in ORDER:
        for k in ORDER[ORDER.index(key) + 1:]:
            if k in route:
                return k
    return route[-1] if key in ORDER and route else (route[0] if route else "nurture")


def entry_for_source(pipeline: Pipeline, source: str) -> str:
    return resolve(pipeline, SOURCES.get(source, "s1"))


def reached_or_past(pipeline: Pipeline, stage: str, milestone: str) -> bool:
    """Is `stage` at or after `milestone` (a built-in key that may have been removed)?"""
    i, m = index_of(pipeline, stage), index_of(pipeline, resolve(pipeline, milestone))
    return i >= 0 and m >= 0 and i >= m


def route_text(pipeline: Pipeline) -> str:
    parts = [f"{s.num} {s.name}" if s.num else f"{s.name} (optional)" for s in resolved(pipeline) if not s.lane]
    return ", ".join(parts) + ", plus Nurture and Lost side lanes"


# ---------- editing ----------

def update_list(pipeline: Pipeline, edits: list[dict], valid_owner_ids: set[str]) -> list[dict]:
    """Rename / re-limit / re-own / re-describe existing stages. Adding and removing use their own calls."""
    by_key = {e.get("key"): e for e in edits if isinstance(e, dict)}
    out = []
    for s in raw_list(pipeline):
        e = by_key.get(s["key"])
        if e:
            s = {**s}
            if "name" in e:
                s["name"] = (str(e.get("name") or "").strip() or s.get("name") or s["key"])[:80]
            if "limit" in e:
                s["limit"] = _limit(e.get("limit"), s["name"])
            if "owner_id" in e:
                oid = str(e.get("owner_id") or "")
                if oid and oid not in valid_owner_ids:
                    raise ServiceError(f"Unknown owner for {s['name']}.", code="invalid_owner")
                s["owner_id"] = oid
            if "description" in e:
                s["description"] = str(e.get("description") or "")[:2000]
            if "phase" in e and s["key"] not in LANES:
                if e["phase"] not in PHASES:
                    raise ServiceError("Phase must be find, engage, win or launch.", code="invalid_phase")
                s["phase"] = e["phase"]
        out.append(s)
    return out


def _limit(v, name: str):
    if v in (None, ""):
        return None
    try:
        return max(0, int(v))
    except (TypeError, ValueError):
        raise ServiceError(f"Max days for {name} must be a number.", code="invalid_limit")


def add_stage(pipeline: Pipeline, data: dict, valid_owner_ids: set[str]) -> dict:
    name = (data.get("name") or "").strip()
    if not name:
        raise ServiceError("Give the stage a name.", code="name_required")
    phase = data.get("phase") or "win"
    if phase not in PHASES:
        raise ServiceError("Phase must be find, engage, win or launch.", code="invalid_phase")
    owner_id = str(data.get("owner_id") or "")
    if owner_id and owner_id not in valid_owner_ids:
        raise ServiceError("That owner isn't part of this workspace.", code="invalid_owner")
    items = raw_list(pipeline)
    main = [s for s in items if s["key"] not in LANES]
    if any(s.get("name", "").lower() == name.lower() for s in items):
        raise ServiceError(f"There's already a stage called {name}.", code="duplicate_name")
    after = data.get("after") or ""
    if after and after not in [s["key"] for s in main]:
        raise ServiceError("Choose where the new stage goes.", code="invalid_position")
    entry = {"key": f"c_{secrets.token_hex(4)}", "name": name[:80], "phase": phase, "limit": _limit(data.get("limit"), name),
             "owner_id": owner_id, "custom": True, "description": str(data.get("description") or "")[:2000]}
    pos = 0 if not after else [s["key"] for s in main].index(after) + 1
    main.insert(pos, entry)
    pipeline.stages = main + [s for s in items if s["key"] in LANES]
    pipeline.save(update_fields=["stages"])
    return entry


@transaction.atomic
def remove_stage(tenant_id, pipeline: Pipeline, key: str, move_to: str, actor) -> dict:
    """Remove a main stage. Its deals move to `move_to` first (recorded in their history)."""
    from .deals import Actor, move_deal  # avoid circular import

    items = raw_list(pipeline)
    main = [s for s in items if s["key"] not in LANES]
    target = next((s for s in main if s["key"] == key), None)
    if key in LANES or target is None:
        raise ServiceError("Nurture and Lost can't be removed." if key in LANES else "Stage not found.", code="invalid_stage")
    if len([s for s in main if not s.get("optional")]) <= 1 and not target.get("optional"):
        raise ServiceError("A pipeline needs at least one main stage.", code="last_stage")
    deals = list(Deal.objects.filter(tenant_id=tenant_id, pipeline=pipeline, stage=key))
    if deals:
        if not move_to or move_to == key or move_to == "lost" or not exists(pipeline, move_to):
            raise ServiceError("Choose where this stage's deals should go.", code="move_to_required")
    label = Actor(actor.user, f"{actor.name} (stage '{target.get('name')}' removed)" if actor.name else f"Stage '{target.get('name')}' removed")
    for d in deals:
        move_deal(tenant_id, d.id, label, {"to": move_to, "system": True,
                                           **({"reengage_date": timezone.localdate()} if move_to == "nurture" else {})})
    # Leftover open tasks and stage tasks for the removed stage no longer apply
    Task.objects.filter(tenant_id=tenant_id, pipeline=pipeline, stage=key, done=False).update(done=True, auto_closed=True, done_at=timezone.now())
    StageTaskTemplate.objects.filter(tenant_id=tenant_id, pipeline=pipeline, stage=key, active=True).update(active=False)
    pipeline.refresh_from_db()
    pipeline.stages = [s for s in raw_list(pipeline) if s["key"] != key]
    if key == "pilot":
        pipeline.pilot_enabled = False
    pipeline.save(update_fields=["stages", "pilot_enabled"])
    return {"moved": len(deals)}
