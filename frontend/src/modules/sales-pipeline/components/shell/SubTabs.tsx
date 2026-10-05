"use client";

import { useEffect, useMemo } from "react";
import { useOutreach, useStageTasks } from "../../api/hooks";
import { outreachTabCounts } from "../views/OutreachView";
import { useData } from "../../context/data-context";
import { useUi, type View } from "../../context/ui-context";
import { dealsInPhase, filterDeals, taskBuckets } from "../../lib/selectors";
import type { PhaseKey } from "../../types";
import { Dot, PHASE_COLOR } from "../common";

interface Tab { v: string; label: string; n?: number; alert?: boolean; dot?: string }

const BOARD_TABS: [string, string][] = [["find", "Find"], ["engage", "Engage"], ["win", "Win"], ["launch", "Launch"], ["lanes", "Nurture and Lost"], ["all", "All stages"]];
const phaseDot = (k: string) => (k in PHASE_COLOR ? PHASE_COLOR[k as PhaseKey] : undefined);

export function useSubTabs(view: View): Tab[] {
  const ui = useUi();
  const { deals, stages, flags, tasks, openTasks, pipeline } = useData();
  const stageTasks = useStageTasks(view === "tasks" ? pipeline?.id ?? null : null).data;
  const outreach = useOutreach(view === "outreach").data;
  return useMemo(() => {
    if (view === "board") {
      const f = filterDeals(deals, ui.filters, flags);
      return BOARD_TABS.map(([v, label]) => ({ v, label, n: dealsInPhase(f, stages, v).length, dot: phaseDot(v) }));
    }
    if (view === "tasks") {
      const b = taskBuckets(tasks, deals, flags, openTasks, ui.taskOwnerId);
      return [
        { v: "due", label: "Due now", n: b.due.length, alert: true },
        { v: "upcoming", label: "Upcoming", n: b.upcoming.length },
        { v: "attention", label: "Stuck deals", n: b.attention.length, alert: true },
        { v: "stage", label: "Stage tasks", n: stageTasks?.length ?? 0 },
        { v: "done", label: "Done" },
      ];
    }
    if (view === "outreach") {
      const n = outreachTabCounts(outreach ?? []);
      return [
        { v: "today", label: "Today", n: n.today, alert: true },
        { v: "approvals", label: "Approvals", n: n.approvals },
        { v: "send", label: "Ready to send", n: n.send },
        { v: "contacts", label: "Contacts", n: n.contacts },
      ];
    }
    if (view === "dash") return [["score", "Scoreboard"], ["journey", "Journey"], ["booth", "Booth"], ["funnel", "Conversion"], ["sources", "Sources and losses"], ["team", "Team"], ["involvement", "Involvement"]].map(([v, label]) => ({ v: v!, label: label! }));
    if (view === "guide") {
      return [["funnel", "Before the pipeline"], ["find", "Find"], ["engage", "Engage"], ["win", "Win"], ["launch", "Launch"], ["lanes", "Side lanes"], ["rules", "Ground rules"]]
        .map(([v, label]) => ({ v: v!, label: label!, dot: phaseDot(v!) }));
    }
    return [["profile", "You and team"], ["stages", "Stages"], ["rules", "Automation"], ["booth", "Booth form"], ["outreach", "Outreach"], ["links", "Files and links"], ["integrations", "Integrations"], ["targets", "Targets"], ["products", "Products"], ["data", "Import and export"]].map(([v, label]) => ({ v: v!, label: label! }));
  }, [view, deals, stages, flags, tasks, openTasks, ui.filters, ui.taskOwnerId, stageTasks, outreach]);
}

export function SubTabs() {
  const ui = useUi();
  const { ready, pipeline } = useData();
  const tabs = useSubTabs(ui.view);
  const current = ui.sub[ui.view];
  const first = tabs[0]?.v;
  useEffect(() => {
    if (first && !tabs.some((t) => t.v === current)) ui.setSub(first);
  }, [current, first, tabs, ui]);

  if (!ready || !pipeline) return null;
  return (
    <div
      role="tablist"
      aria-label="Sections"
      className="sp-noscroll sticky top-0 z-[15] mt-2.5 flex gap-0.5 overflow-x-auto border-b border-line bg-canvas px-3.5 tab:static tab:mt-3.5 tab:px-[18px] desk:px-6"
    >
      {tabs.map((t) => {
        const sel = current === t.v;
        return (
          <button
            key={t.v}
            role="tab"
            type="button"
            aria-selected={sel}
            onClick={() => ui.setSub(t.v)}
            className="-mb-px flex items-center gap-[7px] whitespace-nowrap border-b-2 border-transparent px-3 pb-[11px] pt-2.5 font-medium text-ink-2 hover:text-ink aria-selected:border-brand aria-selected:text-ink"
          >
            {t.dot && <Dot color={t.dot} />}
            {t.label}
            {t.n !== undefined && (
              <span
                className={`rounded-[10px] px-[7px] text-xs tabular-nums ${
                  t.alert && t.n ? "bg-danger text-white" : sel ? "bg-brand-soft text-brand-text" : "bg-sunk text-ink-3"
                }`}
              >
                {t.n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
