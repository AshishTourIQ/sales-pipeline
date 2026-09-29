"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useDeals, usePipelines, useSettings, useTasks } from "../api/hooks";
import { computeFlags, openTasksByDeal, stageLabel, stagesOf } from "../lib/pipeline";
import type { Deal, Flag, Pipeline, PipelineSettings, Stage, StageKey, Task, TeamMember } from "../types";
import { useModule } from "./module-context";
import { useUi } from "./ui-context";

interface DataValue {
  ready: boolean;
  error: string | null;
  pipelines: Pipeline[];
  pipeline: Pipeline | null;
  stages: Stage[];
  deals: Deal[];
  tasks: Task[];
  settings: PipelineSettings;
  team: TeamMember[];
  flags: Map<string, Flag[]>;
  openTasks: Map<string, Task[]>;
  dealById: Map<string, Deal>;
  memberName: (id: string | null | undefined) => string;
  label: (k: StageKey) => string;
  /** The person acting: host user, else the name picked in Settings. */
  me: TeamMember | null;
  canWrite: boolean;
  /** Pipeline set-up: settings, team, stages, stage tasks, pipelines, import, samples. */
  canAdmin: boolean;
}

const Ctx = createContext<DataValue | null>(null);
const EMPTY_DEALS: Deal[] = [];
const EMPTY_TASKS: Task[] = [];
const EMPTY_PIPES: Pipeline[] = [];

export function DataProvider({ children }: { children: ReactNode }) {
  const { currentUser, canWrite, canAdmin } = useModule();
  const ui = useUi();
  const pq = usePipelines();
  const pipelines = pq.data ?? EMPTY_PIPES;
  const pipeline = pipelines.find((p) => p.id === ui.pipelineId) ?? pipelines[0] ?? null;
  const dq = useDeals(pipeline?.id ?? null);
  const tq = useTasks(pipeline?.id ?? null);
  const sq = useSettings();
  const deals = dq.data ?? EMPTY_DEALS;
  const tasks = tq.data ?? EMPTY_TASKS;
  const settings = sq.data;

  const value = useMemo<DataValue>(() => {
    const team = settings.team.filter((m) => m.name);
    const flags = new Map<string, Flag[]>();
    deals.forEach((d) => flags.set(d.id, computeFlags(d, pipeline)));
    const nameOf = new Map(team.map((m) => [m.id, m.name]));
    const me = currentUser ?? team.find((m) => m.id === ui.meId) ?? null;
    const err = pq.error ?? dq.error ?? tq.error ?? sq.error;
    return {
      ready: pq.isSuccess && (!pipeline || (dq.isSuccess && tq.isSuccess)) && sq.isSuccess,
      error: err ? "Couldn't load the pipeline. Check your connection and reload." : null,
      pipelines,
      pipeline,
      stages: stagesOf(pipeline),
      deals,
      tasks,
      settings,
      team,
      flags,
      openTasks: openTasksByDeal(tasks),
      dealById: new Map(deals.map((d) => [d.id, d])),
      memberName: (id) => (id ? nameOf.get(id) ?? id : ""),
      label: (k) => stageLabel(pipeline, k),
      me,
      canWrite,
      canAdmin,
    };
  }, [deals, tasks, settings, pipeline, pipelines, currentUser, ui.meId, canWrite, canAdmin, pq.isSuccess, dq.isSuccess, tq.isSuccess, sq.isSuccess, pq.error, dq.error, tq.error, sq.error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useData must be used inside <SalesPipelineModule>");
  return v;
}
