/**
 * Stage gating (mirror of backend services/gating.py).
 *
 * A deal can only move FORWARD once everything for its current stage is done:
 * every open blocking task of that stage + the stage's checklist. Reminders
 * don't block. Nurture, Lost and backward moves are always allowed.
 */
import { CHECKLISTS } from "../config/template";
import type { Deal, Pipeline, StageKey, Task } from "../types";
import { isForwardIn } from "./pipeline";

export interface Requirements {
  stage: StageKey;
  openTasks: Task[];
  checklistMissing: number;
  count: number;
  done: boolean;
}

export function requirements(deal: Deal, tasks: Task[]): Requirements {
  const openTasks = tasks.filter((t) => t.dealId === deal.id && t.stage === deal.stage && !t.done && t.blocking !== false);
  const cl = CHECKLISTS[deal.stage];
  const values = cl ? (deal[cl.field] ?? {}) : {};
  const checklistMissing = cl ? cl.items.filter(([k]) => !values[k]).length : 0;
  const count = openTasks.length + checklistMissing;
  return { stage: deal.stage, openTasks, checklistMissing, count, done: count === 0 };
}

export function describe(r: Requirements): string {
  const parts: string[] = [];
  if (r.openTasks.length) parts.push(`${r.openTasks.length} open task${r.openTasks.length === 1 ? "" : "s"}`);
  if (r.checklistMissing) parts.push(`${r.checklistMissing} checklist item${r.checklistMissing === 1 ? "" : "s"}`);
  return parts.join(" and ");
}

/** Side routes toward the demo: entering them never waits on the current stage's tasks. */
const UNGATED_TARGETS: StageKey[] = ["offer"];

/** Only forward moves along this pipeline's main route are gated (not into "Offer sent"). */
export const gated = (p: Pipeline | null | undefined, from: StageKey, to: StageKey): boolean =>
  !UNGATED_TARGETS.includes(to) && isForwardIn(p, from, to);
