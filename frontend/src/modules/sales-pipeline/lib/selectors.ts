import type { BoardFilters } from "../context/ui-context";
import type { Deal, Flag, Stage, Task } from "../types";
import { byDue, isStuck } from "./pipeline";
import { addDays, today } from "./dates";

export function filterDeals(deals: Deal[], f: BoardFilters, flags: Map<string, Flag[]>): Deal[] {
  const q = f.q.trim().toLowerCase();
  return deals.filter((d) => {
    if (q && ![d.company.name, d.contact.name, d.contact.email, d.company.region].join(" ").toLowerCase().includes(q)) return false;
    if (f.ownerId && d.ownerId !== f.ownerId) return false;
    if (f.source && d.source !== f.source) return false;
    if (f.tier && d.booth?.tier !== f.tier) return false;
    if (f.flagged && !(flags.get(d.id)?.length)) return false;
    return true;
  });
}

export function dealsInPhase(deals: Deal[], stages: Stage[], phase: string): Deal[] {
  if (phase === "all") return deals;
  return deals.filter((d) => stages.find((s) => s.key === d.stage)?.phase === phase);
}

/** Stuck deals first, then oldest in stage. */
export function sortInStage(list: Deal[], flags: Map<string, Flag[]>): Deal[] {
  return [...list].sort((a, b) => {
    const fa = isStuck(flags.get(a.id) ?? []) ? 0 : 1;
    const fb = isStuck(flags.get(b.id) ?? []) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return a.stageChangedAt.localeCompare(b.stageChangedAt);
  });
}

export interface TaskBuckets {
  overdue: Task[];
  today: Task[];
  due: Task[];
  upcoming: Task[];
  next7: Task[];
  later: Task[];
  noDate: Task[];
  done: Task[];
  stuck: Deal[];
  noNext: Deal[];
  attention: Deal[];
}

export function taskBuckets(
  tasks: Task[], deals: Deal[], flags: Map<string, Flag[]>, openTasks: Map<string, Task[]>, ownerId: string,
): TaskBuckets {
  const mine = ownerId ? tasks.filter((t) => t.ownerId === ownerId) : tasks;
  const open = mine.filter((t) => !t.done).sort(byDue);
  const t0 = today();
  const t7 = addDays(7);
  const ds = ownerId ? deals.filter((d) => d.ownerId === ownerId) : deals;
  const stuck = ds.filter((d) => isStuck(flags.get(d.id) ?? []));
  const stuckIds = new Set(stuck.map((d) => d.id));
  const noNext = ds.filter((d) => d.stage !== "lost" && d.stage !== "s13" && !(openTasks.get(d.id)?.length) && !stuckIds.has(d.id));
  const overdue = open.filter((t) => t.due && t.due < t0);
  const todayList = open.filter((t) => t.due === t0);
  const upcoming = open.filter((t) => !t.due || t.due > t0);
  return {
    overdue,
    today: todayList,
    due: [...overdue, ...todayList],
    upcoming,
    next7: upcoming.filter((t) => t.due && t.due <= t7),
    later: upcoming.filter((t) => t.due && t.due > t7),
    noDate: upcoming.filter((t) => !t.due),
    done: mine.filter((t) => t.done).sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || "")).slice(0, 60),
    stuck,
    noNext,
    attention: [...stuck, ...noNext],
  };
}
