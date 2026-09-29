"use client";

import { useIsMutating, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import { DEFAULT_SETTINGS } from "../config/template";
import { useModule } from "../context/module-context";
import { stageLabel } from "../lib/pipeline";
import type {
  ActivityType, CreateDealInput, CreateStageTaskInput, CreateTaskInput, Deal, DealMutationResult, DealPatch, ImportRow,
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
  }), [raw]);
  return { ...q, data };
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
      putDeal(qc, { ...deal, ...patch });
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
    mutationFn: ({ dealId, type, text }: { dealId: string; type: ActivityType; text: string }) => api.addActivity(dealId, type, text),
    onSuccess: (d) => putDeal(qc, d),
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
    mutationFn: (name: string) => api.createPipeline(name),
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
