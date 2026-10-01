"use client";

import { useIsMutating, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_SETTINGS } from "../config/template";
import { useModule } from "../context/module-context";
import { stageLabel } from "../lib/pipeline";
import { scoreBooth } from "../lib/scoring";
import type {
  ActivityType, AddTouchpointInput, CallType, CreateBoothLeadInput, PipelineTemplate, CreateDealInput, InviteInput, CreateStageTaskInput, CreateTaskInput, Deal, DealMutationResult, DealPatch, ImportRow,
  MoveDealInput, Pipeline, PipelineSettings, StageTaskTemplate, Task, TaskPatch, AddStageInput, StageKey,
} from "../types";
import type { PipelinePatch } from "./types";
import { ApiError } from "./types";

/** Polling interval for shared data (Redis-aggregate polling now, WebSockets later). */
export const POLL_MS = 30_000;

export const qk = {
  all: ["sales-pipeline"] as const,
  pipelines: () => [...qk.all, "pipelines"] as const,
  deals: (pid: string) => [...qk.all, "deals", pid] as const,
  tasks: (pid: string) => [...qk.all, "tasks", pid] as const,
  settings: () => [...qk.all, "settings"] as const,
  stageTasks: (pid: string) => [...qk.all, "stage-tasks", pid] as const,
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    // Read-only viewers get the standard line; other 403s (admin-only, no access, override) say why
    if (e.status === 403 && (e.code === "read_only" || e.code === "forbidden" || !e.message)) {
      return "You can view this pipeline but not change it. Ask the owner for Contributor access.";
    }
    if (e.code === "network") return "Some changes didn't save. Check your connection; reload to see the saved version.";
    return e.message;
  }
  return "Something went wrong. Try again in a moment.";
}
const onError = (e: unknown) => toast.error(errorMessage(e));

/* ---------- Queries ---------- */

export function usePipelines() {
  const { api } = useModule();
  return useQuery({ queryKey: qk.pipelines(), queryFn: () => api.listPipelines(), refetchInterval: POLL_MS });
}
export function useDeals(pid: string | null) {
  const { api } = useModule();
  return useQuery({ queryKey: qk.deals(pid ?? ""), queryFn: () => api.listDeals(pid ?? ""), enabled: !!pid, refetchInterval: POLL_MS });
}
export function useTasks(pid: string | null) {
  const { api } = useModule();
  return useQuery({ queryKey: qk.tasks(pid ?? ""), queryFn: () => api.listTasks(pid ?? ""), enabled: !!pid, refetchInterval: POLL_MS });
}
export function useSettings() {
  const { api } = useModule();
  const q = useQuery({ queryKey: qk.settings(), queryFn: () => api.getSettings(), refetchInterval: POLL_MS });
  const raw = q.data;
  const data = useMemo<PipelineSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...raw,
    rules: { ...DEFAULT_SETTINGS.rules, ...raw?.rules },
    targets: { ...DEFAULT_SETTINGS.targets, ...raw?.targets },
    boothFollowup: { ...DEFAULT_SETTINGS.boothFollowup, ...raw?.boothFollowup },
  }), [raw]);
  return { ...q, data };
}

/**
 * "Already in the pipeline?" while a new lead is typed. Waits for a pause in typing;
 * offline or on an error it just shows nothing (it only ever warns).
 */
export function useDuplicates(input: { company: string; email: string; website?: string }, enabled = true) {
  const { api } = useModule();
  const [q, setQ] = useState(input);
  const { company, email, website = "" } = input;
  useEffect(() => {
    const t = setTimeout(() => setQ({ company, email, website }), 400);
    return () => clearTimeout(t);
  }, [company, email, website]);
  const c = q.company.trim(), e = q.email.trim(), w = (q.website ?? "").trim();
  const ready = c.length >= 3 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || w.includes(".");
  return useQuery({
    queryKey: [...qk.all, "duplicates", c.toLowerCase(), e.toLowerCase(), w.toLowerCase()],
    queryFn: () => api.findDuplicates!({ company: c, email: e, website: w }),
    enabled: enabled && ready && !!api.findDuplicates,
    staleTime: 60_000,
    retry: false,
  });
}

export const useSaving = (): boolean => useIsMutating({ mutationKey: qk.all }) > 0;

/* ---------- Cache helpers ---------- */

function putDeal(qc: QueryClient, deal: Deal) {
  qc.setQueryData<Deal[]>(qk.deals(deal.pipelineId), (old) => {
    if (!old) return [deal];
    return old.some((d) => d.id === deal.id) ? old.map((d) => (d.id === deal.id ? deal : d)) : [...old, deal];
  });
}
function applyResult(qc: QueryClient, r: DealMutationResult) {
  putDeal(qc, r.deal);
  qc.setQueryData<Task[]>(qk.tasks(r.deal.pipelineId), (old = []) => {
    const closed = new Set(r.tasksClosed);
    const next = old.map((t) => (closed.has(t.id) ? { ...t, done: true, autoClosed: true } : t));
    return [...next, ...r.tasksCreated.filter((t) => !next.some((x) => x.id === t.id))];
  });
}
const tasksNote = (n: number) => (n ? ` ${n} ${n === 1 ? "task" : "tasks"} added.` : "");

/** A tick finished the stage: show the move and update the caches. */
function onAdvanced(qc: QueryClient, r: DealMutationResult | null | undefined) {
  if (!r) return;
  applyResult(qc, r);
  const p = qc.getQueryData<Pipeline[]>(qk.pipelines())?.find((x) => x.id === r.deal.pipelineId);
  toast(`All stage tasks done. ${r.deal.company.name || "Deal"} moved to ${stageLabel(p, r.deal.stage)}.${tasksNote(r.tasksCreated.length)}`);
}

/* ---------- Deal mutations ---------- */

export function useCreateDeal() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "createDeal"],
    mutationFn: (input: CreateDealInput) => api.createDeal(input),
    onSuccess: (r) => { applyResult(qc, r); void qc.invalidateQueries({ queryKey: qk.pipelines() }); },
    onError,
  });
}

export function useCreateBoothLead() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "createBoothLead"],
    mutationFn: (input: CreateBoothLeadInput) => api.createBoothLead(input),
    onSuccess: (r) => { applyResult(qc, r); void qc.invalidateQueries({ queryKey: qk.pipelines() }); },
    // The form handles errors itself: a dropped connection keeps the lead on the device.
    // "always": offline, the request fails straight away (and goes to the device queue)
    // instead of pausing in memory until the connection is back, and being lost on close.
    networkMode: "always",
    retry: false,
  });
}

export function useMoveDeal(labelOf: (d: Deal) => string) {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "moveDeal"],
    mutationFn: ({ deal, input }: { deal: Deal; input: MoveDealInput }) => api.moveDeal(deal.id, input),
    onMutate: async ({ deal, input }) => {
      const key = qk.deals(deal.pipelineId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Deal[]>(key);
      putDeal(qc, { ...deal, stage: input.to, stageChangedAt: new Date().toISOString() });
      return { prev, key };
    },
    onSuccess: (r) => {
      applyResult(qc, r);
      toast(`Moved to ${labelOf(r.deal)}.${tasksNote(r.tasksCreated.length)}`);
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev); onError(e); },
  });
}

export function useUpdateDeal() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "updateDeal"],
    mutationFn: ({ deal, patch }: { deal: Deal; patch: DealPatch }) => api.updateDeal(deal.id, patch),
    onMutate: ({ deal, patch }) => {
      const key = qk.deals(deal.pipelineId);
      const prev = qc.getQueryData<Deal[]>(key);
      const { booth, ...rest } = patch;
      // A booth patch is partial: merge it and re-score so the tier updates at once
      const merged = booth && deal.booth ? { ...deal.booth, ...booth } : deal.booth;
      putDeal(qc, { ...deal, ...rest, booth: merged ? { ...merged, ...scoreBooth(merged.visitor, merged.answers) } : null });
      return { prev, key };
    },
    onSuccess: (r) => { putDeal(qc, r.deal); onAdvanced(qc, r.advanced); },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev); onError(e); },
  });
}

export function useAddActivity() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "addActivity"],
    mutationFn: ({ dealId, type, text, attendeeIds }: { dealId: string; type: ActivityType; text: string; attendeeIds?: string[] }) =>
      api.addActivity(dealId, type, text, attendeeIds),
    onSuccess: (d) => putDeal(qc, d),
    onError,
  });
}

export function useUpdateActivity() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "updateActivity"],
    mutationFn: ({ activityId, attendeeIds }: { activityId: string; attendeeIds: string[] }) => api.updateActivity(activityId, { attendeeIds }),
    onSuccess: (d) => { putDeal(qc, d); toast("Saved who was on it."); },
    onError,
  });
}

export function useSetCallType() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "setCallType"],
    mutationFn: ({ dealId, callType }: { dealId: string; callType: CallType }) => api.setCallType(dealId, callType),
    onSuccess: (r) => { applyResult(qc, r); toast(`Next call set.${tasksNote(r.tasksCreated.length)}`); },
    onError,
  });
}

export function useTransferDeal() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "transferDeal"],
    mutationFn: ({ deal, pipelineId }: { deal: Deal; pipelineId: string }) => api.transferDeal(deal.id, pipelineId).then((r) => ({ r, from: deal.pipelineId })),
    onSuccess: ({ r, from }) => {
      qc.setQueryData<Deal[]>(qk.deals(from), (old = []) => old.filter((d) => d.id !== r.deal.id));
      qc.setQueryData<Task[]>(qk.tasks(from), (old = []) => old.filter((t) => t.dealId !== r.deal.id));
      void qc.invalidateQueries({ queryKey: qk.deals(r.deal.pipelineId) });
      void qc.invalidateQueries({ queryKey: qk.tasks(r.deal.pipelineId) });
      void qc.invalidateQueries({ queryKey: qk.pipelines() });
    },
    onError,
  });
}

export function useAddTouchpoint() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "addTouchpoint"],
    mutationFn: ({ dealId, input }: { dealId: string; input: AddTouchpointInput }) => api.addTouchpoint(dealId, input),
    onSuccess: (d) => { putDeal(qc, d); toast("Step added to the journey."); },
    onError,
  });
}

export function useDeleteDeal() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "deleteDeal"],
    mutationFn: (deal: Deal) => api.deleteDeal(deal.id).then(() => deal),
    onSuccess: (deal) => {
      qc.setQueryData<Deal[]>(qk.deals(deal.pipelineId), (old = []) => old.filter((d) => d.id !== deal.id));
      qc.setQueryData<Task[]>(qk.tasks(deal.pipelineId), (old = []) => old.filter((t) => t.dealId !== deal.id));
      toast("Deal deleted.");
    },
    onError,
  });
}

export function useCreateExpansion() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "expansion"],
    mutationFn: (deal: Deal) => api.createExpansion(deal.id),
    onSuccess: (r) => applyResult(qc, r),
    onError,
  });
}

/* ---------- Task mutations ---------- */

export function useCreateTask() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "createTask"],
    mutationFn: (input: CreateTaskInput) => api.createTask(input),
    onSuccess: (t) => { qc.setQueryData<Task[]>(qk.tasks(t.pipelineId), (old = []) => [...old, t]); toast("Task added."); },
    onError,
  });
}

export function useUpdateTask() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "updateTask"],
    mutationFn: ({ task, patch }: { task: Task; patch: TaskPatch }) => api.updateTask(task.id, patch),
    onMutate: ({ task, patch }) => {
      const key = qk.tasks(task.pipelineId);
      const prev = qc.getQueryData<Task[]>(key);
      const extra = patch.done !== undefined ? { doneAt: patch.done ? new Date().toISOString() : "", autoClosed: false } : {};
      qc.setQueryData<Task[]>(key, (old = []) => old.map((t) => (t.id === task.id ? { ...t, ...patch, ...extra } : t)));
      return { prev, key };
    },
    onSuccess: ({ task: t, advanced }) => {
      qc.setQueryData<Task[]>(qk.tasks(t.pipelineId), (old = []) => old.map((x) => (x.id === t.id ? t : x)));
      onAdvanced(qc, advanced);
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev); onError(e); },
  });
}

export function useDeleteTask() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "deleteTask"],
    mutationFn: (task: Task) => api.deleteTask(task.id).then(() => task),
    onMutate: (task) => {
      const key = qk.tasks(task.pipelineId);
      const prev = qc.getQueryData<Task[]>(key);
      qc.setQueryData<Task[]>(key, (old = []) => old.filter((t) => t.id !== task.id));
      return { prev, key };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev); onError(e); },
  });
}

/* ---------- Pipelines and settings ---------- */

export function useCreatePipeline() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "createPipeline"],
    mutationFn: ({ name, template }: { name: string; template?: PipelineTemplate }) => api.createPipeline(name, template),
    onSuccess: (p) => { qc.setQueryData<Pipeline[]>(qk.pipelines(), (old = []) => [...old, p]); toast(`${p.name} pipeline created.`); },
    onError,
  });
}

export function useUpdatePipeline() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "updatePipeline"],
    mutationFn: ({ id, patch }: { id: string; patch: PipelinePatch }) => api.updatePipeline(id, patch),
    onSuccess: (p) => { qc.setQueryData<Pipeline[]>(qk.pipelines(), (old = []) => old.map((x) => (x.id === p.id ? { ...x, ...p } : x))); toast("Pipeline saved."); },
    onError,
  });
}

function putPipeline(qc: QueryClient, p: Pipeline) {
  qc.setQueryData<Pipeline[]>(qk.pipelines(), (old = []) => old.map((x) => (x.id === p.id ? { ...x, ...p } : x)));
}

export function useAddStage() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "addStage"],
    mutationFn: ({ pipelineId, input }: { pipelineId: string; input: AddStageInput }) => api.addStage(pipelineId, input),
    onSuccess: ({ pipeline, stage }) => { putPipeline(qc, pipeline); toast(`Stage "${stage.name}" added. Give it stage tasks on the Tasks page so deals move on from it.`); },
    onError,
  });
}

export function useRemoveStage() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "removeStage"],
    mutationFn: ({ pipelineId, stageKey, moveTo }: { pipelineId: string; stageKey: StageKey; moveTo: StageKey }) => api.removeStage(pipelineId, stageKey, moveTo),
    onSuccess: ({ pipeline, moved }) => {
      putPipeline(qc, pipeline);
      void qc.invalidateQueries({ queryKey: qk.deals(pipeline.id) });
      void qc.invalidateQueries({ queryKey: qk.tasks(pipeline.id) });
      void qc.invalidateQueries({ queryKey: qk.stageTasks(pipeline.id) });
      toast(`Stage removed.${moved ? ` ${moved} ${moved === 1 ? "deal" : "deals"} moved.` : ""}`);
    },
    onError,
  });
}

export function useUpdateSettings() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "updateSettings"],
    mutationFn: (patch: Partial<PipelineSettings>) => api.updateSettings(patch),
    onMutate: (patch) => {
      const prev = qc.getQueryData<PipelineSettings>(qk.settings());
      if (prev) qc.setQueryData<PipelineSettings>(qk.settings(), { ...prev, ...patch });
      return { prev };
    },
    onSuccess: (s) => qc.setQueryData(qk.settings(), s),
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(qk.settings(), ctx.prev); onError(e); },
  });
}

/* ---------- People ---------- */

export const usersKey = () => [...qk.all, "users"] as const;

export function useInviteUser() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "inviteUser"],
    mutationFn: (input: InviteInput) => {
      if (!api.inviteUser) throw new ApiError("Invites need the server.", 400, "not_supported");
      return api.inviteUser(input);
    },
    onSuccess: (u) => {
      void qc.invalidateQueries({ queryKey: usersKey() });
      void qc.invalidateQueries({ queryKey: qk.settings() });
      toast(u.pending
        ? (u.emailSent ? `Invite sent to ${u.email}.` : `${u.name} added. The email couldn't be sent: check the email settings, then use Resend.`)
        : `${u.name} already had a login and now has pipeline access.`);
    },
    onError,
  });
}

export function useResendInvite() {
  const { api } = useModule();
  return useMutation({
    mutationKey: [...qk.all, "resendInvite"],
    mutationFn: (userId: string) => {
      if (!api.resendInvite) throw new ApiError("Invites need the server.", 400, "not_supported");
      return api.resendInvite(userId);
    },
    onSuccess: (u) => toast(u.emailSent ? `Invite sent again to ${u.email}.` : "The email couldn't be sent. Check the email settings on the server."),
    onError,
  });
}

/* ---------- Intake keys (game / analysis / audit tools) ---------- */

export const intakeKeysKey = () => [...qk.all, "intake-keys"] as const;

export function useIntakeKeys(enabled: boolean) {
  const { api } = useModule();
  return useQuery({ queryKey: intakeKeysKey(), queryFn: () => api.listIntakeKeys?.() ?? Promise.resolve([]), enabled: enabled && !!api.listIntakeKeys });
}

export function useCreateIntakeKey() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "createIntakeKey"],
    mutationFn: (name: string) => {
      if (!api.createIntakeKey) throw new ApiError("Intake keys need the server.", 400, "not_supported");
      return api.createIntakeKey(name);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: intakeKeysKey() }),
    onError,
  });
}

export function useRevokeIntakeKey() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "revokeIntakeKey"],
    mutationFn: (id: string) => {
      if (!api.revokeIntakeKey) throw new ApiError("Intake keys need the server.", 400, "not_supported");
      return api.revokeIntakeKey(id);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: intakeKeysKey() }); toast("Key revoked. The tool using it can no longer send leads."); },
    onError,
  });
}

/* ---------- Google Calendar and recorded calls (server only) ---------- */

export const recordingsKey = () => [...qk.all, "recordings"] as const;

export function useSyncCalendar() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "syncCalendar"],
    mutationFn: (dealId: string) => {
      if (!api.syncCalendar) throw new ApiError("The calendar needs the server.", 400, "not_supported");
      return api.syncCalendar(dealId);
    },
    onSuccess: ({ result, deal }) => {
      putDeal(qc, deal);
      toast(result === "deleted" ? "Removed from the team calendar." : result === "none" ? "Nothing to put on the calendar: set a demo date first." : "On the team calendar.");
    },
    onError,
  });
}

export function useRecordings(enabled: boolean) {
  const { api } = useModule();
  return useQuery({ queryKey: recordingsKey(), queryFn: () => api.listRecordings?.() ?? Promise.resolve([]), enabled: enabled && !!api.listRecordings, refetchInterval: POLL_MS * 2 });
}

export function useLinkRecording() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "linkRecording"],
    mutationFn: ({ id, dealId }: { id: string; dealId: string }) => {
      if (!api.linkRecording) throw new ApiError("Recorded calls need the server.", 400, "not_supported");
      return api.linkRecording(id, dealId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: recordingsKey() });
      void qc.invalidateQueries({ queryKey: qk.all });
      toast("Call logged on the deal. The AI summary follows in a minute.");
    },
    onError,
  });
}

export function useDismissRecording() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "dismissRecording"],
    mutationFn: (id: string) => {
      if (!api.dismissRecording) throw new ApiError("Recorded calls need the server.", 400, "not_supported");
      return api.dismissRecording(id);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: recordingsKey() }),
    onError,
  });
}

/* ---------- Bulk ---------- */

function invalidatePipeline(qc: QueryClient, pid: string) {
  void qc.invalidateQueries({ queryKey: qk.deals(pid) });
  void qc.invalidateQueries({ queryKey: qk.tasks(pid) });
  void qc.invalidateQueries({ queryKey: qk.pipelines() });
}

export function useImportLeads() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "import"],
    mutationFn: ({ pipelineId, rows }: { pipelineId: string; rows: ImportRow[] }) => api.importLeads(pipelineId, rows).then((r) => ({ ...r, pipelineId })),
    onSuccess: (r) => { invalidatePipeline(qc, r.pipelineId); toast(`Imported ${r.created} ${r.created === 1 ? "lead" : "leads"}.`); },
    onError,
  });
}

export function useImportHandoffs() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "importHandoffs"],
    mutationFn: (pid: string) => api.importHandoffs(pid).then((r) => ({ ...r, pid })),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.all });
      toast(r.moved ? `${r.moved} partner hand-off${r.moved === 1 ? "" : "s"} moved in.` : "No partner hand-offs waiting for this pipeline.");
    },
    onError,
  });
}

export function useSamples() {
  const { api } = useModule();
  const qc = useQueryClient();
  const load = useMutation({
    mutationKey: [...qk.all, "loadSamples"],
    mutationFn: (pid: string) => api.loadSamples(pid).then((r) => ({ ...r, pid })),
    onSuccess: (r) => { invalidatePipeline(qc, r.pid); toast(`${r.created} sample deals loaded. Open any card to try moving it along.`); },
    onError,
  });
  const remove = useMutation({
    mutationKey: [...qk.all, "removeSamples"],
    mutationFn: (pid: string) => api.removeSamples(pid).then((r) => ({ ...r, pid })),
    onSuccess: (r) => { invalidatePipeline(qc, r.pid); toast("Sample deals removed."); },
    onError,
  });
  return { load, remove };
}

/* ---------- Stage tasks ("this person must do X in this stage") ---------- */

export function useStageTasks(pid: string | null) {
  const { api } = useModule();
  return useQuery({ queryKey: qk.stageTasks(pid ?? ""), queryFn: () => api.listStageTasks(pid ?? ""), enabled: !!pid, refetchInterval: POLL_MS });
}

export function useCreateStageTask() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "createStageTask"],
    mutationFn: (input: CreateStageTaskInput) => api.createStageTask(input),
    onSuccess: ({ template, tasksCreated }) => {
      qc.setQueryData<StageTaskTemplate[]>(qk.stageTasks(template.pipelineId), (old = []) => [...old, template]);
      qc.setQueryData<Task[]>(qk.tasks(template.pipelineId), (old = []) => [...old, ...tasksCreated]);
      const n = tasksCreated.length;
      toast(`Stage task added${n ? ` to ${n} current ${n === 1 ? "deal" : "deals"}` : ""}. New deals entering the stage get it too.`);
    },
    onError,
  });
}

export function useDeleteStageTask() {
  const { api } = useModule();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...qk.all, "deleteStageTask"],
    mutationFn: (t: StageTaskTemplate) => api.deleteStageTask(t.id).then((r) => ({ ...r, t })),
    onSuccess: ({ t, tasksRemoved }) => {
      qc.setQueryData<StageTaskTemplate[]>(qk.stageTasks(t.pipelineId), (old = []) => old.filter((x) => x.id !== t.id));
      const gone = new Set(tasksRemoved);
      qc.setQueryData<Task[]>(qk.tasks(t.pipelineId), (old = []) => old.filter((x) => !gone.has(x.id)));
      toast("Stage task removed.");
    },
    onError,
  });
}
