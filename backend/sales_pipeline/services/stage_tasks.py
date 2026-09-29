"""
Stage tasks: "Guddu must do X in stage 1".

Creating one adds the task to every deal currently in that stage owned by that
person, and (via deals.template_tasks) to every deal of theirs entering the
stage later. Each copy is a normal blocking task, so the stage's deals can't
move forward until it's ticked.
"""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from ..models import Deal, StageTaskTemplate, Task
from . import stages
from .deals import Actor, _task
from .errors import ServiceError

User = get_user_model()


@transaction.atomic
def create_stage_task(tenant_id, actor: Actor, pipeline, data: dict) -> tuple[StageTaskTemplate, list[Task]]:
    stage = data["stage"]
    found = stages.get(pipeline, stage)
    if found is None or found.lane:
        raise ServiceError("Stage tasks can only be added to the pipeline's main stages.", code="invalid_stage")
    owner = User.objects.filter(tenant_id=tenant_id, id=data["owner_id"]).first()
    if owner is None:
        raise ServiceError("That person isn't part of this workspace.", code="invalid_owner")
    title = data["title"].strip()
    if not title:
        raise ServiceError("Write what needs doing first.", code="title_required")

    tpl = StageTaskTemplate.objects.create(
        tenant_id=tenant_id, pipeline=pipeline, stage=stage, owner=owner, title=title,
        due_in_days=data.get("due_in_days", 1), created_by=actor.user,
    )
    due = timezone.localdate() + timedelta(days=tpl.due_in_days)
    created = [
        _task(d, title, owner, due, actor, auto=True, stage=stage, template=tpl)
        for d in Deal.objects.filter(tenant_id=tenant_id, pipeline=pipeline, stage=stage, owner=owner)
    ]
    return tpl, created


@transaction.atomic
def delete_stage_task(tenant_id, template_id) -> list[str]:
    """Stop adding the task and remove its still-open copies (so they no longer block)."""
    tpl = StageTaskTemplate.objects.filter(tenant_id=tenant_id, id=template_id, active=True).first()
    if tpl is None:
        raise ServiceError("Stage task not found.", code="not_found", status=404)
    tpl.active = False
    tpl.save(update_fields=["active"])
    open_copies = Task.objects.filter(tenant_id=tenant_id, template=tpl, done=False)
    removed = [str(i) for i in open_copies.values_list("id", flat=True)]
    open_copies.delete()
    return removed
