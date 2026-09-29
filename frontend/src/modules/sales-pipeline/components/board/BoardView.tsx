"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useData } from "../../context/data-context";
import { useUi } from "../../context/ui-context";
import { filterDeals, sortInStage } from "../../lib/selectors";
import type { Deal, Stage, StageKey } from "../../types";
import { phaseClass } from "../common";
import { DealCard } from "./DealCard";
import { Welcome } from "./Welcome";

export function useBoardData() {
  const ui = useUi();
  const { deals, stages, flags } = useData();
  return useMemo(() => {
    const phase = ui.sub.board ?? "find";
    const shown = phase === "all" ? stages : stages.filter((s) => s.phase === phase);
    const by = new Map<StageKey, Deal[]>(stages.map((s) => [s.key, []]));
    for (const d of filterDeals(deals, ui.filters, flags)) {
      // Deals parked in Pilot while Pilot is switched off show under Second call.
      (by.get(d.stage) ?? by.get("s9"))?.push(d);
    }
    by.forEach((list, k) => by.set(k, sortInStage(list, flags)));
    return { phase, shown, by };
  }, [ui.sub.board, ui.filters, deals, stages, flags]);
}

export function stageSub(s: Stage, ownerName: string): string {
  const lim = s.limit ? `max ${s.limit} ${s.limit === 1 ? "day" : "days"}` : s.optional ? "optional" : s.key === "s13" ? "active clients" : "";
  return [ownerName, lim].filter(Boolean).join(", ");
}

function AddHere({ stage }: { stage: StageKey }) {
  const ui = useUi();
  return (
    <button
      type="button"
      onClick={() => ui.openCapture(stage)}
      className="flex-none rounded-[9px] border border-dashed border-line-2 bg-transparent p-2 text-[13px] font-medium text-ink-3 hover:border-brand hover:bg-panel hover:text-brand-text"
    >
      + Add lead here
    </button>
  );
}

export function BoardView() {
  const ui = useUi();
  const { canWrite, memberName } = useData();
  const { phase, shown, by } = useBoardData();
  const [over, setOver] = useState<StageKey | null>(null);
  const fit = phase !== "all";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Welcome />
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-[18px] pb-3.5 desk:px-6 desk:pb-[18px]">
        <div className={cn("flex h-full gap-2", fit ? "min-w-full" : "min-w-max")}>
          {shown.map((s, i) => {
            const list = by.get(s.key) ?? [];
            return (
              <section key={s.key} aria-label={s.name} className={cn("flex min-h-0 flex-col", fit ? "min-w-[185px] flex-[1_1_0]" : "w-[252px] flex-none")}>
                <div className={cn("sp-chev", phaseClass(s.phase), s.lane ? "lane" : i === 0 && "first", s.optional && "opt")}>
                  <div className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-semibold">
                    {s.num && <span className="tabular-nums text-[var(--pc)]">{s.num}</span>}
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto min-w-[22px] rounded-[10px] bg-white px-[7px] text-center text-xs font-semibold text-[var(--pc)]">{list.length}</span>
                  </div>
                  <div className="mt-px truncate text-xs text-ink-2">{stageSub(s, memberName(s.ownerId))}</div>
                </div>
                <div
                  className={cn(
                    "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-xl bg-sunk p-2 transition-[background,box-shadow] duration-100",
                    over === s.key && "bg-brand-soft shadow-[inset_0_0_0_2px_var(--brand)]",
                  )}
                  onDragOver={(e) => { if (!canWrite) return; e.preventDefault(); if (over !== s.key) setOver(s.key); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(null);
                    const id = e.dataTransfer.getData("text/plain");
                    if (id) ui.requestMove(id, s.key);
                  }}
                >
                  {list.length ? list.map((d) => <DealCard key={d.id} deal={d} />) : <div className="px-1.5 py-3.5 text-center text-[12.5px] text-ink-3">No deals here</div>}
                  {canWrite && !s.lane && <AddHere stage={s.key} />}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Phones: stage pills, one stage's cards at a time. */
export function MobileStageList() {
  const ui = useUi();
  const { canWrite, memberName, label } = useData();
  const { phase, shown, by } = useBoardData();
  let sel = ui.mobileStage[phase];
  if (!shown.some((s) => s.key === sel)) sel = (shown.find((s) => (by.get(s.key) ?? []).length) ?? shown[0])?.key;
  const s = shown.find((x) => x.key === sel);
  if (!s) return <Welcome />;
  const list = by.get(s.key) ?? [];

  return (
    <div>
      <Welcome />
      <div role="tablist" aria-label="Stages" className="sp-noscroll flex gap-1.5 overflow-x-auto px-3.5 pb-3 pt-0.5">
        {shown.map((x) => (
          <button
            key={x.key}
            role="tab"
            type="button"
            aria-selected={x.key === sel}
            onClick={() => ui.setMobileStage(phase, x.key)}
            className={cn(
              phaseClass(x.phase),
              "inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border border-line-2 bg-panel px-3 py-[7px] font-medium text-ink-2",
              "aria-selected:border-[var(--pc)] aria-selected:bg-[var(--ps)] aria-selected:text-ink",
            )}
          >
            {x.num && <span className="font-semibold text-[var(--pc)]">{x.num}</span>}
            {x.name}
            <span className={cn("rounded-[10px] px-[7px] text-xs", x.key === sel ? "bg-white text-[var(--pc)]" : "bg-sunk text-ink-3")}>{(by.get(x.key) ?? []).length}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2.5 px-3.5 pb-5">
        <div className={cn(phaseClass(s.phase), "flex flex-col gap-px rounded-[10px] border-l-4 border-[var(--pc)] bg-[var(--ps)] px-3.5 py-2.5")}>
          <b>{label(s.key)}</b>
          <span className="text-xs text-ink-2">{stageSub(s, memberName(s.ownerId))}</span>
        </div>
        {list.length ? list.map((d) => <DealCard key={d.id} deal={d} />) : <div className="px-1.5 py-3.5 text-center text-[12.5px] text-ink-3">No deals in this stage</div>}
        {canWrite && !s.lane && <AddHere stage={s.key} />}
      </div>
    </div>
  );
}
