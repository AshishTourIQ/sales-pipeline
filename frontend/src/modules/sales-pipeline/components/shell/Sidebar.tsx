"use client";

import { BarChart3, Columns3, SlidersHorizontal, SquareCheckBig, Waypoints } from "lucide-react";
import type { ReactNode } from "react";
import { useData } from "../../context/data-context";
import { useModule } from "../../context/module-context";
import { useUi, type View } from "../../context/ui-context";
import { today } from "../../lib/dates";
import { Avatar } from "../common";

const NAV: { view: View; label: ReactNode; icon: ReactNode }[] = [
  { view: "board", label: "Pipeline", icon: <Columns3 /> },
  { view: "tasks", label: "Tasks", icon: <SquareCheckBig /> },
  { view: "dash", label: "Dashboard", icon: <BarChart3 /> },
  { view: "guide", label: <>Workflow<span className="hidden desk:inline"> guide</span></>, icon: <Waypoints /> },
  { view: "settings", label: "Settings", icon: <SlidersHorizontal /> },
];

export function useDueCount(): number {
  const { tasks } = useData();
  const { taskOwnerId } = useUi();
  const t0 = today();
  return tasks.filter((t) => !t.done && t.due && t.due <= t0 && (!taskOwnerId || t.ownerId === taskOwnerId)).length;
}

export function Sidebar() {
  const ui = useUi();
  const { pipelines, pipeline, me, ready, canAdmin } = useData();
  const { productName, currentUser } = useModule();
  const due = useDueCount();

  return (
    <aside
      aria-label="Main"
      className={[
        // phones: bottom tab bar
        "fixed inset-x-0 bottom-0 z-30 flex h-[calc(62px+env(safe-area-inset-bottom,0px))] flex-row border-t border-line bg-panel px-1 pt-1 shadow-[0_-4px_16px_rgba(20,24,31,.06)] sp-safe-b",
        // tablets: icon rail
        "tab:static tab:h-full tab:w-[76px] tab:flex-none tab:flex-col tab:items-center tab:overflow-y-auto tab:border-r tab:border-t-0 tab:px-2 tab:py-3.5 tab:shadow-none",
        // desktop: full sidebar
        "desk:w-[236px] desk:items-stretch desk:px-3 desk:pb-3.5 desk:pt-4",
      ].join(" ")}
    >
      <div className="hidden items-center gap-2.5 pb-3.5 tab:flex desk:px-2 desk:pb-[18px] desk:pt-0.5">
        <span aria-hidden className="relative grid size-8 flex-none place-items-center rounded-[9px] bg-black text-[13px] font-bold tracking-[-.02em] text-white">
          IQ<i className="absolute right-[5px] top-1.5 size-[5px] rounded-full bg-brand" />
        </span>
        <div className="hidden desk:block">
          <b className="block text-base leading-[1.1] tracking-[-.01em]">{productName}</b>
          <span className="block text-xs text-ink-3">Sales pipeline</span>
        </div>
      </div>

      <nav className="flex w-full flex-row justify-around tab:flex-col tab:justify-start tab:gap-0.5">
        {NAV.map((n) => {
          const current = ui.view === n.view;
          return (
            <button
              key={n.view}
              type="button"
              aria-current={current ? "page" : undefined}
              onClick={() => ui.setView(n.view)}
              className={[
                "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-[3px] rounded-[10px] py-[7px] font-medium text-ink-2 [&>svg]:size-[18px] [&>svg]:flex-none",
                "aria-[current=page]:text-brand-text",
                "tab:flex-none tab:gap-1 tab:px-0.5 tab:py-[9px] tab:hover:bg-hover tab:hover:text-ink tab:aria-[current=page]:bg-brand-soft",
                "desk:flex-row desk:justify-start desk:gap-2.5 desk:rounded-lg desk:px-2.5 desk:py-2 desk:text-left",
              ].join(" ")}
            >
              {n.icon}
              <span className="max-w-full truncate text-[10.5px] leading-[1.1] desk:text-sm desk:leading-normal">{n.label}</span>
              {n.view === "tasks" && due > 0 && (
                <span className="absolute left-[calc(50%+5px)] top-px rounded-[10px] bg-danger px-[5px] text-[10px] font-semibold leading-[1.4] text-white tab:left-auto tab:right-1.5 tab:top-[3px] desk:static desk:ml-auto desk:px-[7px] desk:py-px desk:text-[11px]">
                  {due}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="hidden desk:block">
        <div className="px-2.5 pb-1.5 pt-5 text-xs font-semibold text-ink-3">Pipelines</div>
        {pipelines.map((p) => {
          const cur = p.id === pipeline?.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-current={cur}
              onClick={() => ui.setPipelineId(p.id)}
              className="flex w-full items-center gap-[9px] rounded-lg px-2.5 py-[7px] text-left text-ink-2 hover:bg-hover hover:text-ink aria-[current=true]:bg-hover aria-[current=true]:font-medium aria-[current=true]:text-ink"
            >
              <span aria-hidden className={`size-2.5 flex-none rounded-[3px] ${cur ? "bg-brand" : "bg-line-2"}`} />
              <span className="truncate">{p.name}</span>
              <span className="ml-auto text-xs text-ink-3">{p.dealCount ?? ""}</span>
            </button>
          );
        })}
        {canAdmin && ready && (
          <button type="button" onClick={() => ui.setView("settings", "products")} className="flex w-full items-center gap-[9px] rounded-lg px-2.5 py-[7px] text-left text-ink-2 hover:bg-hover hover:text-ink">
            <span aria-hidden className="size-2.5 flex-none rounded-[3px] border-[1.5px] border-dashed border-line-2" />
            <span>New pipeline</span>
          </button>
        )}
      </div>

      <div className="mt-auto hidden items-center gap-2.5 border-t border-line px-2 pt-3.5 text-[13px] desk:flex">
        {me ? (
          <>
            <Avatar name={me.name} />
            <div className="min-w-0">
              <b className="block truncate font-medium">{me.name}</b>
              <span className="text-xs text-ink-3">{currentUser ? "Signed in" : "Shared with your team"}</span>
            </div>
          </>
        ) : (
          <div className="min-w-0">
            <b className="block font-medium">Who are you?</b>
            <span className="text-xs text-ink-3">
              <button type="button" className="text-info hover:underline" onClick={() => ui.setView("settings", "profile")}>Pick your name</button> so changes show who made them
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
