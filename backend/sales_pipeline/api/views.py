"""
Thin views: validate input, call one service, shape the output.
All business logic lives in sales_pipeline/services/.
"""
import json
import time

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import Count
from django.utils import timezone
from django.utils.decorators import method_decorator

from core import invites
from core.models import PipelineRole, User
from core.tenancy import tenant_context
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from ..models import AiDraftLog, Deal, IntakeKey, Pipeline, Task
from ..services import ai
from ..services import calendar as calendar_svc
from ..services import intake as intake_svc
from ..services import recall as recall_svc
from ..services import touchpoints as tp_svc
from ..services import booth as booth_svc
from ..services import duplicates as dup_svc
from ..services import speed as speed_svc
from ..services import deals as deal_svc
from ..services import importer, samples, stage_tasks
from ..services import stages as stage_svc
from ..config import CHECKLISTS
from ..models import StageTaskTemplate
from ..services import pipelines as pipe_svc
from ..services.errors import ServiceError
from . import serializers as S
from .base import WRITES, TenantScopedMixin, paged

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
        p = pipe_svc.create_pipeline(self.tenant_id, data.get("name", ""), data.get("template", "touriq"))
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


class PipelineHandoffsView(PipelineDetailView):
    """Bring the partner hand-offs that fit a Partnerships / Referrals pipeline into it."""

    http_method_names = POST_ONLY

    def post(self, request: Request, pk) -> Response:
        return Response({"moved": deal_svc.import_handoffs(self.tenant_id, self._get(pk), self.actor)})


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
        return Response(paged(request, S.deal_queryset(qs).order_by("created_at", "id"), S.deal_out))

    def post(self, request: Request) -> Response:
        data = _valid(S.DealCreateIn, request.data)
        r = deal_svc.create_deal(self.tenant_id, self.actor, data)
        return Response(S.result_out(r), status=status.HTTP_201_CREATED)


class DealDuplicatesView(TenantScopedMixin, APIView):
    """Deals that look like the lead being typed (?company=&email=&website=). Warns only."""

    def get(self, request: Request) -> Response:
        p = request.query_params
        return Response(dup_svc.find(self.tenant_id, company=p.get("company", "")[:200],
                                     email=p.get("email", "")[:254], website=p.get("website", "")[:300]))


class DealBoothView(TenantScopedMixin, APIView):
    """The booth lead form: scores the sheet and files the visitor in one call."""

    def post(self, request: Request) -> Response:
        data = _valid(S.BoothLeadIn, request.data)
        r = booth_svc.create_booth_lead(self.tenant_id, self.actor, data)
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
        # Deleting also deletes the stage history and activity: admins only (others move it to Lost).
        # Checked here, not with admin_methods, so the sub-routes that subclass this view still answer 405.
        if not request.user.can_admin_pipeline:
            raise ServiceError("Only a pipeline admin can delete a deal. Move it to Lost instead.", code="admin_only", status=403)
        d = self._get(pk)
        calendar_svc.queue_delete(self.tenant_id, d.id, d.calendar_event_id)
        d.delete()
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
        deal_svc.add_activity(self._get(pk), data["type"], data["text"], self.actor, attendees=data["attendee_ids"])
        return Response(S.deal_out(self._get(pk)), status=status.HTTP_201_CREATED)


class DealTouchpointView(DealDetailView):
    """A person records a journey step (e.g. "Audit report sent", with the report link)."""

    http_method_names = POST_ONLY

    def post(self, request: Request, pk) -> Response:
        data = _valid(S.TouchpointIn, request.data)
        tp_svc.record(self._get(pk), data["kind"], self.actor, source="manual", score=data["score"], link=data["link"], detail=data["detail"])
        return Response(S.deal_out(self._get(pk)), status=status.HTTP_201_CREATED)


class DealCalendarView(DealDetailView):
    """Sync the deal's demo / meeting to the team calendar now (and see any error)."""

    http_method_names = POST_ONLY

    def post(self, request: Request, pk) -> Response:
        result = calendar_svc.sync_deal(self._get(pk))
        return Response({"result": result, "deal": S.deal_out(self._get(pk))})


class DealCallTypeView(DealDetailView):
    """Second call: team demo or commercial call. Swaps the stage's tasks."""

    http_method_names = POST_ONLY

    def post(self, request: Request, pk) -> Response:
        data = _valid(S.CallTypeIn, request.data)
        return Response(S.result_out(deal_svc.set_call_type(self.tenant_id, pk, self.actor, data["call_type"])))


class DealTransferView(DealDetailView):
    """Move the deal to another pipeline (e.g. a partner hand-off into Partnerships)."""

    http_method_names = POST_ONLY

    def post(self, request: Request, pk) -> Response:
        data = _valid(S.TransferIn, request.data)
        return Response(S.result_out(deal_svc.transfer_deal(self.tenant_id, pk, self.actor, data["pipeline_id"], data["stage"])))


class ActivityDetailView(TenantScopedMixin, APIView):
    """Fix who was on a call or meeting."""

    def patch(self, request: Request, pk) -> Response:
        from ..config import ATTENDED_TYPES
        from ..models import Activity

        a = Activity.objects.filter(tenant_id=self.tenant_id, id=pk).first()
        if a is None:
            raise ServiceError("Entry not found.", code="not_found", status=404)
        data = _valid(S.ActivityPatchIn, request.data, partial=True)
        if "attendee_ids" in data:
            if a.type not in ATTENDED_TYPES:
                raise ServiceError("Only calls and meetings have attendees.", code="invalid_type")
            a.attendees = deal_svc.clean_attendees(self.tenant_id, data["attendee_ids"])
            a.save(update_fields=["attendees"])
        deal = S.deal_queryset(Deal.objects.filter(id=a.deal_id)).get()
        return Response(S.deal_out(deal))


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
        return Response(paged(request, qs.order_by("created_at", "id"), S.task_out))

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
        speed_svc.on_task_done(t)
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
    """
    Workspace users who can use the pipeline: the pool the Team picker chooses from.
    POST (admin) invites someone by email: they get a link to set their password.
    """

    admin_methods = WRITES

    def get(self, request: Request) -> Response:
        users = User.objects.filter(tenant_id=self.tenant_id, is_active=True).exclude(pipeline_role=PipelineRole.NONE)
        return Response([_user_out(u) for u in users.order_by("full_name", "username")])

    def post(self, request: Request) -> Response:
        data = _valid(S.InviteIn, request.data)
        try:
            u, sent = invites.invite_user(self.tenant_id, request.user, email=data["email"], name=data["name"],
                                          role=data["role"], sales_team=data["sales_team"])
        except invites.InviteError as e:
            raise ServiceError(e.detail, code=e.code, status=e.status)
        return Response({**_user_out(u), "email_sent": sent}, status=status.HTTP_201_CREATED)


class UserResendInviteView(TenantScopedMixin, APIView):
    admin_methods = WRITES
    http_method_names = POST_ONLY

    def post(self, request: Request, pk) -> Response:
        u = User.objects.filter(tenant_id=self.tenant_id, id=pk, is_active=True).first()
        if u is None:
            raise ServiceError("Person not found.", code="not_found", status=404)
        try:
            sent = invites.send_invite(u, request.user)
        except invites.InviteError as e:
            raise ServiceError(e.detail, code=e.code, status=e.status)
        return Response({**_user_out(u), "email_sent": sent})


def _user_out(u) -> dict:
    return {"id": str(u.id), "name": u.display_name, "email": u.email, "is_sales_team": u.is_sales_team,
            "role": u.pipeline_role, "pending": invites.is_pending(u)}


# ---------------- intake (game, analysis, audit tools) ----------------

def _intake_key(request) -> str:
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.headers.get("X-Intake-Key", "").strip()


class IntakeIPThrottle(SimpleRateThrottle):
    """Per calling address, whatever key it sends: INTAKE_IP_RATE. Made-up keys get no fresh allowance."""

    scope = "intake_ip"

    def get_rate(self):
        return settings.INTAKE_IP_RATE

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class IntakeKeyThrottle(SimpleRateThrottle):
    """Per intake key, once it's known to be real: INTAKE_RATE (e.g. 120/min)."""

    scope = "intake_key"
    setting = "INTAKE_RATE"

    def __init__(self, key_id):
        self.key_id = str(key_id)
        super().__init__()

    def get_rate(self):
        return getattr(settings, self.setting)

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.key_id}


class IntakeKeyDailyThrottle(IntakeKeyThrottle):
    """...and per day (INTAKE_DAILY_RATE), so a leaked key can't flood the pipeline."""

    scope = "intake_key_day"
    setting = "INTAKE_DAILY_RATE"


def _bad_key_cache_key(request) -> str:
    return f"intake_bad_key:{IntakeIPThrottle().get_ident(request)}"


class IntakeView(APIView):
    """
    Public endpoint for the outside tools. Authenticated by an intake key, not a user;
    the key decides the tenant (and scopes RLS). See docs/INTAKE_API.md.
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [IntakeIPThrottle]

    def post(self, request: Request) -> Response:
        # An address that keeps sending wrong keys is guessing: stop answering it for an hour
        bad = _bad_key_cache_key(request)
        if (cache.get(bad) or 0) >= settings.INTAKE_BAD_KEY_LIMIT:
            self.throttled(request, 3600)
        try:
            key = intake_svc.authenticate(_intake_key(request))
        except ServiceError:
            if not cache.add(bad, 1, 3600):
                try:
                    cache.incr(bad)
                except ValueError:  # expired in between
                    cache.add(bad, 1, 3600)
            raise
        for t in (IntakeKeyThrottle(key.id), IntakeKeyDailyThrottle(key.id)):
            if not t.allow_request(request, self):
                self.throttled(request, t.wait())
        data = _valid(S.IntakeIn, request.data)
        r = intake_svc.handle_event(key, data)
        body = {"deal_id": str(r.deal.id), "stage": r.deal.stage, "created": r.created, "duplicate": r.duplicate,
                "touchpoint_id": str(r.touchpoint.id) if r.touchpoint else None}
        return Response(body, status=status.HTTP_201_CREATED if r.created else status.HTTP_200_OK)


class IntakeKeyListView(TenantScopedMixin, APIView):
    # Keys are secrets: listing them is admin-only too
    admin_methods = frozenset({"GET", "POST"})

    def get(self, request: Request) -> Response:
        # Reads normally only need view access; keys are pipeline set-up
        if not request.user.can_admin_pipeline:
            raise ServiceError("Only a pipeline admin can see intake keys.", code="admin_only", status=403)
        return Response([intake_svc.key_out(k) for k in IntakeKey.objects.filter(tenant_id=self.tenant_id)])

    def post(self, request: Request) -> Response:
        data = _valid(S.IntakeKeyIn, request.data)
        k, secret = intake_svc.create_key(self.tenant_id, self.actor, data["name"])
        return Response({"key": intake_svc.key_out(k), "secret": secret}, status=status.HTTP_201_CREATED)


class IntakeKeyDetailView(TenantScopedMixin, APIView):
    admin_methods = WRITES

    def delete(self, request: Request, pk) -> Response:
        n = IntakeKey.objects.filter(tenant_id=self.tenant_id, id=pk, active=True).update(active=False)
        if not n:
            raise ServiceError("Key not found.", code="not_found", status=404)
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------- Recall.ai (recorded calls) ----------------

class RecallWebhookView(APIView):
    """
    Recall posts here (URL per tenant). Signed with the workspace secret; answers at once
    and processes in the worker. See services/recall.py.
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def post(self, request: Request, tenant_id) -> Response:
        from core.models import Tenant
        from core.tenancy import set_current_tenant

        if not recall_svc.enabled():
            raise ServiceError("Recorded calls aren't set up on this server.", code="recall_off", status=503)
        raw = request.body  # read before DRF parses it: the signature covers the exact bytes
        recall_svc.verify(request.headers, raw)
        if not Tenant.objects.filter(id=tenant_id).exists():
            raise ServiceError("Unknown workspace.", code="not_found", status=404)
        set_current_tenant(tenant_id)
        try:
            payload = json.loads(raw or b"{}")
        except ValueError:
            raise ServiceError("Not JSON.", code="invalid")
        m = recall_svc.record_webhook(tenant_id, payload)
        if m is not None:
            recall_svc.queue("process_recording_task", tenant_id, m.id)
        return Response({"ok": True})


class RecordingListView(TenantScopedMixin, APIView):
    """Recorded calls that need a person: not matched to a deal, or failed."""

    def get(self, request: Request) -> Response:
        from ..models import RecallMeeting

        qs = RecallMeeting.objects.filter(tenant_id=self.tenant_id)
        st = request.query_params.get("status", "unmatched")
        qs = qs.filter(status__in=st.split(",")) if st != "all" else qs
        return Response([recall_svc.meeting_out(m) for m in qs[:100]])


class RecordingLinkView(TenantScopedMixin, APIView):
    def post(self, request: Request, pk) -> Response:
        data = _valid(S.RecordingLinkIn, request.data)
        m = recall_svc.link_manually(self.tenant_id, pk, data["deal_id"], self.actor)
        recall_svc.queue("summarise_recording_task", self.tenant_id, m.id)
        return Response(recall_svc.meeting_out(m))


class RecordingDismissView(TenantScopedMixin, APIView):
    def post(self, request: Request, pk) -> Response:
        from ..models import RecallMeeting

        n = RecallMeeting.objects.filter(tenant_id=self.tenant_id, id=pk).exclude(status="logged").update(status="dismissed")
        if not n:
            raise ServiceError("Recording not found, or already on a deal.", code="not_found", status=404)
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------- settings ----------------

class SettingsView(TenantScopedMixin, APIView):
    admin_methods = WRITES

    def _out(self) -> dict:
        s = pipe_svc.get_settings(self.tenant_id)
        team = [{"id": str(u.id), "name": u.display_name} for u in pipe_svc.team_users(self.tenant_id)]
        return {"team": team, "rules": pipe_svc.rules_for(self.tenant_id), "targets": s.targets,
                "booth_followup": booth_svc.followup_defaults(self.tenant_id), "links": s.links or {}, "event_costs": s.event_costs or {},
                "integrations": {
                    "calendar": calendar_svc.enabled(), "calendar_invites": bool(settings.GOOGLE_DELEGATED_USER),
                    "recall": recall_svc.enabled(),
                    "recall_webhook_url": self.request.build_absolute_uri(f"/api/sales-pipeline/webhooks/recall/{self.tenant_id}/"),
                }}

    def get(self, request: Request) -> Response:
        return Response(self._out())

    def patch(self, request: Request) -> Response:
        data = _valid(S.SettingsIn, request.data, partial=True)
        pipe_svc.update_settings(self.tenant_id, data)
        if "booth_followup" in data:
            booth_svc.set_followup_defaults(self.tenant_id, data["booth_followup"])
        return Response(self._out())
