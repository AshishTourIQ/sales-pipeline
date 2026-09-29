"""
Thin views: validate input, call one service, shape the output.
All business logic lives in sales_pipeline/services/.
"""
import time

from django.conf import settings
from django.db import transaction
from django.db.models import Count
from django.utils import timezone
from django.utils.decorators import method_decorator

from core.tenancy import tenant_context
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import AiDraftLog, Deal, Pipeline, Task
from ..services import ai
from ..services import deals as deal_svc
from ..services import importer, samples, stage_tasks
from ..services import stages as stage_svc
from ..config import CHECKLISTS
from ..models import StageTaskTemplate
from ..services import pipelines as pipe_svc
from ..services.errors import ServiceError
from . import serializers as S
from .base import WRITES, TenantScopedMixin

# Sub-routes subclass a detail view for its _get(); only their own verb is routed
POST_ONLY = ["post", "options"]


def _valid(serializer_cls, data, **kw) -> dict:
    s = serializer_cls(data=data, **kw)
    s.is_valid(raise_exception=True)
    return s.validated_data


# ---------------- pipelines ----------------

class PipelineListView(TenantScopedMixin, APIView):
    admin_methods = WRITES

    def get(self, request: Request) -> Response:
        qs = Pipeline.objects.filter(tenant_id=self.tenant_id).annotate(deal_count=Count("deals"))
        return Response(S.PipelineOut(qs, many=True).data)

    def post(self, request: Request) -> Response:
        data = _valid(S.PipelineIn, request.data)
        p = pipe_svc.create_pipeline(self.tenant_id, data.get("name", ""))
        return Response(S.PipelineOut(p).data, status=status.HTTP_201_CREATED)


class PipelineDetailView(TenantScopedMixin, APIView):
    admin_methods = WRITES

    def _get(self, pk) -> Pipeline:
        p = Pipeline.objects.filter(tenant_id=self.tenant_id, id=pk).first()
        if p is None:
            raise ServiceError("Pipeline not found.", code="not_found", status=404)
        return p

    def patch(self, request: Request, pk) -> Response:
        p = self._get(pk)
        data = _valid(S.PipelineIn, request.data, partial=True)
        if "name" in data:
            p.name = data["name"].strip() or p.name
        if "pilot_enabled" in data:
            p.pilot_enabled = data["pilot_enabled"]
        if "stages" in data:
            p.stages = pipe_svc.clean_stage_overrides(self.tenant_id, p, data["stages"])
        p.save()
        p.deal_count = p.deals.count()  # type: ignore[attr-defined]
        return Response(S.PipelineOut(p).data)


class PipelineStagesView(PipelineDetailView):
    """Add a stage (custom stages have no automation; give them stage tasks)."""

    http_method_names = POST_ONLY

    def post(self, request: Request, pk) -> Response:
        p = self._get(pk)
        data = _valid(S.StageAddIn, request.data)
        stage = stage_svc.add_stage(p, data, pipe_svc.valid_owner_ids(self.tenant_id))
        p.deal_count = p.deals.count()  # type: ignore[attr-defined]
        return Response({"pipeline": S.PipelineOut(p).data, "stage": stage}, status=status.HTTP_201_CREATED)


class PipelineStageRemoveView(PipelineDetailView):
    """Remove a stage; its deals move to `move_to` first."""

    http_method_names = POST_ONLY

    def post(self, request: Request, pk, key) -> Response:
        p = self._get(pk)
        data = _valid(S.StageRemoveIn, request.data)
        result = stage_svc.remove_stage(self.tenant_id, p, key, data.get("move_to", ""), self.actor)
        p.refresh_from_db()
        p.deal_count = p.deals.count()  # type: ignore[attr-defined]
        return Response({"pipeline": S.PipelineOut(p).data, **result})


class PipelineImportView(PipelineDetailView):
    http_method_names = POST_ONLY

    def post(self, request: Request, pk) -> Response:
        p = self._get(pk)
        data = _valid(S.ImportIn, request.data)
        return Response(importer.import_rows(self.tenant_id, p, self.actor, [dict(r) for r in data["rows"]]))


class PipelineSamplesView(PipelineDetailView):
    http_method_names = ["post", "delete", "options"]

    def post(self, request: Request, pk) -> Response:
        return Response({"created": samples.load_samples(self.tenant_id, self._get(pk), self.actor)})

    def delete(self, request: Request, pk) -> Response:
        return Response({"removed": samples.remove_samples(self.tenant_id, self._get(pk))})


# ---------------- deals ----------------

class DealListView(TenantScopedMixin, APIView):
    def get(self, request: Request) -> Response:
        qs = Deal.objects.filter(tenant_id=self.tenant_id)
        if pid := request.query_params.get("pipeline"):
            qs = qs.filter(pipeline_id=pid)
        return Response([S.deal_out(d) for d in S.deal_queryset(qs)])

    def post(self, request: Request) -> Response:
        data = _valid(S.DealCreateIn, request.data)
        r = deal_svc.create_deal(self.tenant_id, self.actor, data)
        return Response(S.result_out(r), status=status.HTTP_201_CREATED)


class DealDetailView(TenantScopedMixin, APIView):
    def _get(self, pk) -> Deal:
        d = S.deal_queryset(Deal.objects.filter(tenant_id=self.tenant_id, id=pk)).first()
        if d is None:
            raise ServiceError("Deal not found.", code="not_found", status=404)
        return d

    def get(self, request: Request, pk) -> Response:
        return Response(S.deal_out(self._get(pk)))

    def patch(self, request: Request, pk) -> Response:
        data = _valid(S.DealPatchIn, request.data, partial=True)
        deal = deal_svc.update_deal(self.tenant_id, pk, self.actor, data)
        advanced = None
        checklist = CHECKLISTS.get(deal.stage, (None,))[0]
        if checklist and checklist in data:
            advanced = deal_svc.maybe_advance(self.tenant_id, pk, self.actor)
        return Response({"deal": S.deal_out(self._get(pk)), "advanced": S.result_out_or_none(advanced)})

    def delete(self, request: Request, pk) -> Response:
        self._get(pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class DealMoveView(DealDetailView):
    http_method_names = POST_ONLY

    def post(self, request: Request, pk) -> Response:
        data = _valid(S.MoveIn, request.data)
        return Response(S.result_out(deal_svc.move_deal(self.tenant_id, pk, self.actor, data)))


class DealActivityView(DealDetailView):
    http_method_names = POST_ONLY

    def post(self, request: Request, pk) -> Response:
        data = _valid(S.ActivityIn, request.data)
        deal_svc.add_activity(self._get(pk), data["type"], data["text"], self.actor)
        return Response(S.deal_out(self._get(pk)), status=status.HTTP_201_CREATED)


class DealExpansionView(DealDetailView):
    http_method_names = POST_ONLY

    def post(self, request: Request, pk) -> Response:
        return Response(S.result_out(deal_svc.create_expansion(self.tenant_id, pk, self.actor)), status=status.HTTP_201_CREATED)


@method_decorator(transaction.non_atomic_requests, name="dispatch")
class DealAiDraftView(DealDetailView):
    """
    Claude drafts. The Claude call can take many seconds, so it runs OUTSIDE any
    database transaction: read the deal in one short transaction, call Claude,
    then log usage in another.
    """

    http_method_names = POST_ONLY

    def initial(self, request, *args, **kwargs):
        APIView.initial(self, request, *args, **kwargs)  # tenant is set per transaction below

    def post(self, request: Request, pk) -> Response:
        data = _valid(S.AiDraftIn, request.data)
        with tenant_context(self.tenant_id):
            deal = self._get(pk)
            prompt = ai.build_prompt(data["action"], deal, data.get("option", ""), data.get("pasted", ""))
        started = time.monotonic()
        result, error = None, None
        try:
            result = ai.generate(data["action"], prompt)
        except ServiceError as e:
            error = e
        with tenant_context(self.tenant_id):
            AiDraftLog.objects.create(
                tenant_id=self.tenant_id, deal_id=deal.id, user=request.user, action=data["action"],
                model=(result.model if result else ai.model_for(data["action"])) if settings.AI_ENABLED else "",
                ok=error is None, error_code=error.code if error else "",
                input_tokens=result.input_tokens if result else 0, output_tokens=result.output_tokens if result else 0,
                cache_read_tokens=result.cache_read_tokens if result else 0, ms=int((time.monotonic() - started) * 1000),
            )
        if error:
            # The usage log above is already committed; nothing to roll back
            return Response({"detail": error.detail, "code": error.code}, status=error.status)
        assert result is not None
        return Response({"text": result.text, "tag": result.tag, "truncated": result.truncated})


# ---------------- tasks ----------------

class TaskListView(TenantScopedMixin, APIView):
    def get(self, request: Request) -> Response:
        qs = Task.objects.filter(tenant_id=self.tenant_id)
        if pid := request.query_params.get("pipeline"):
            qs = qs.filter(pipeline_id=pid)
        return Response([S.task_out(t) for t in qs])

    def post(self, request: Request) -> Response:
        data = _valid(S.TaskCreateIn, request.data)
        pipeline = Pipeline.objects.filter(tenant_id=self.tenant_id, id=data["pipeline_id"]).first()
        if pipeline is None:
            raise ServiceError("Pipeline not found.", code="not_found", status=404)
        deal = Deal.objects.filter(tenant_id=self.tenant_id, id=data["deal_id"]).first() if data.get("deal_id") else None
        owner = deal_svc._owner(self.tenant_id, data.get("owner_id"))
        t = Task.objects.create(
            tenant_id=self.tenant_id, pipeline=pipeline, deal=deal, title=data["title"].strip(), owner=owner,
            due=data.get("due"), stage=deal.stage if deal else "", created_by=request.user, created_at=timezone.now(),
        )
        return Response(S.task_out(t), status=status.HTTP_201_CREATED)


class TaskDetailView(TenantScopedMixin, APIView):
    def _get(self, pk) -> Task:
        t = Task.objects.filter(tenant_id=self.tenant_id, id=pk).first()
        if t is None:
            raise ServiceError("Task not found.", code="not_found", status=404)
        return t

    def patch(self, request: Request, pk) -> Response:
        t = self._get(pk)
        data = _valid(S.TaskPatchIn, request.data, partial=True)
        if "title" in data:
            t.title = data["title"].strip() or t.title
        if "owner_id" in data:
            t.owner = deal_svc._owner(self.tenant_id, data["owner_id"])
        if "due" in data:
            t.due = data["due"]
        if "done" in data:
            t.done = data["done"]
            t.done_at = timezone.now() if t.done else None
            t.auto_closed = False
        t.save()
        advanced = None
        if data.get("done") and t.deal_id and t.deal and t.stage == t.deal.stage:
            advanced = deal_svc.maybe_advance(self.tenant_id, t.deal_id, self.actor)
        return Response({"task": S.task_out(t), "advanced": S.result_out_or_none(advanced)})

    def delete(self, request: Request, pk) -> Response:
        self._get(pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------- stage tasks ----------------

class StageTaskListView(TenantScopedMixin, APIView):
    admin_methods = WRITES

    def get(self, request: Request) -> Response:
        qs = StageTaskTemplate.objects.filter(tenant_id=self.tenant_id, active=True).order_by("stage", "created_at")
        if pid := request.query_params.get("pipeline"):
            qs = qs.filter(pipeline_id=pid)
        return Response([S.template_out(t) for t in qs])

    def post(self, request: Request) -> Response:
        data = _valid(S.StageTaskIn, request.data)
        pipeline = Pipeline.objects.filter(tenant_id=self.tenant_id, id=data["pipeline_id"]).first()
        if pipeline is None:
            raise ServiceError("Pipeline not found.", code="not_found", status=404)
        tpl, created = stage_tasks.create_stage_task(self.tenant_id, self.actor, pipeline, data)
        return Response({"template": S.template_out(tpl), "tasks_created": [S.task_out(t) for t in created]}, status=status.HTTP_201_CREATED)


class StageTaskDetailView(TenantScopedMixin, APIView):
    admin_methods = WRITES

    def delete(self, request: Request, pk) -> Response:
        return Response({"tasks_removed": stage_tasks.delete_stage_task(self.tenant_id, pk)})


# ---------------- users ----------------

class UserListView(TenantScopedMixin, APIView):
    """Workspace users who can use the pipeline: the pool the Team picker chooses from."""

    def get(self, request: Request) -> Response:
        from django.contrib.auth import get_user_model

        from core.models import PipelineRole

        users = get_user_model().objects.filter(tenant_id=self.tenant_id, is_active=True).exclude(pipeline_role=PipelineRole.NONE)
        return Response([
            {"id": str(u.id), "name": u.display_name, "email": u.email, "is_sales_team": u.is_sales_team}
            for u in users.order_by("full_name", "username")
        ])


# ---------------- settings ----------------

class SettingsView(TenantScopedMixin, APIView):
    admin_methods = WRITES

    def _out(self) -> dict:
        s = pipe_svc.get_settings(self.tenant_id)
        team = [{"id": str(u.id), "name": u.display_name} for u in pipe_svc.team_users(self.tenant_id)]
        return {"team": team, "rules": pipe_svc.rules_for(self.tenant_id), "targets": s.targets}

    def get(self, request: Request) -> Response:
        return Response(self._out())

    def patch(self, request: Request) -> Response:
        pipe_svc.update_settings(self.tenant_id, _valid(S.SettingsIn, request.data, partial=True))
        return Response(self._out())
