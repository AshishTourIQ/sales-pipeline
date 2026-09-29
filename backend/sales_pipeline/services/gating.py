"""
Stage gating: a deal can only move FORWARD once everything for its current
stage is done, and it moves on by itself when the last item is ticked.

"Everything" = every open blocking task whose stage is the deal's stage
(automatic, stage-task templates, one-off tasks) + that stage's checklist.
Reminder tasks (blocking=False) never block. Moving to Nurture / Lost or
backward is always allowed. Admins can override with a reason.

Mirror of frontend lib/gating.ts; keep them in step.
"""
from dataclasses import dataclass, field

from ..config import CHECKLISTS
from ..models import Deal, Task
from . import stages


@dataclass
class Requirements:
    stage: str
    open_tasks: list[Task] = field(default_factory=list)
    checklist_missing: int = 0

    @property
    def count(self) -> int:
        return len(self.open_tasks) + self.checklist_missing

    @property
    def done(self) -> bool:
        return self.count == 0

    def describe(self) -> str:
        parts = []
        if self.open_tasks:
            n = len(self.open_tasks)
            parts.append(f"{n} open task{'s' if n != 1 else ''}")
        if self.checklist_missing:
            n = self.checklist_missing
            parts.append(f"{n} checklist item{'s' if n != 1 else ''}")
        return " and ".join(parts)


def requirements(deal: Deal) -> Requirements:
    req = Requirements(stage=deal.stage)
    req.open_tasks = list(Task.objects.filter(deal=deal, stage=deal.stage, done=False, blocking=True).order_by("due", "created_at"))
    if deal.stage in CHECKLISTS:
        fieldname, keys = CHECKLISTS[deal.stage]
        values = getattr(deal, fieldname) or {}
        req.checklist_missing = sum(1 for k in keys if not values.get(k))
    return req


def gated(pipeline, frm: str, to: str) -> bool:
    """Only forward moves along this pipeline's main route are gated."""
    return stages.is_forward(pipeline, frm, to)


def advance_target(deal: Deal) -> str | None:
    return stages.next_stage(deal.pipeline, deal.stage)
