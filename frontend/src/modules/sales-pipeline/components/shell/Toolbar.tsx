"use client";

import { Columns3, List, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SOURCE_NAMES } from "../../config/template";
import { useData } from "../../context/data-context";
import { useUi } from "../../context/ui-context";
import { filterDeals } from "../../lib/selectors";
import { OptionList, Seg } from "../common";
import { AddTaskDialog } from "../dialogs/AddTaskDialog";

const wrap = "flex flex-wrap items-center gap-1.5 px-3.5 py-2.5 tab:gap-2 tab:px-[18px] tab:py-3 desk:px-6 desk:py-3.5";

export function Toolbar() {
  const ui = useUi();
  const { ready, pipeline, deals, flags, team, canWrite } = useData();
  const [q, setQ] = useState(ui.filters.q);
  const [addTask, setAddTask] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { if (q !== ui.filters.q) ui.setFilters({ q }); }, 120);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready || !pipeline) return null;

  if (ui.view === "board") {
    const shown = filterDeals(deals, ui.filters, flags).length;
    const all = deals.length;
    return (
      <div className={wrap}>
        <div className="relative flex-[1_1_100%] tab:flex-[0_1_280px]">
          <Search aria-hidden className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <Input type="search" aria-label="Search deals" placeholder="Search deals" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <NativeSelect aria-label="Owner" className="flex-[1_1_40%] tab:w-auto tab:flex-none" value={ui.filters.ownerId} onChange={(e) => ui.setFilters({ ownerId: e.target.value })}>
          <option value="">All owners</option>
          {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Lead source" className="flex-[1_1_40%] tab:w-auto tab:flex-none" value={ui.filters.source} onChange={(e) => ui.setFilters({ source: e.target.value })}>
          <OptionList items={SOURCE_NAMES} blank="All sources" />
        </NativeSelect>
        <button
          type="button"
          aria-pressed={ui.filters.flagged}
          onClick={() => ui.setFilters({ flagged: !ui.filters.flagged })}
          className="inline-flex items-center gap-1.5 rounded-md border border-line-2 bg-panel px-[11px] py-[7px] font-medium text-ink-2 aria-pressed:border-danger aria-pressed:bg-danger-soft aria-pressed:text-danger"
        >
          Needs attention
        </button>
        <div className="ml-auto flex items-center gap-2.5">
          <span className="text-[13px] text-ink-3">{shown === all ? `${all} ${all === 1 ? "deal" : "deals"}` : `${shown} of ${all} deals`}</span>
          <Seg
            className="hidden tab:inline-flex"
            label="Layout"
            value={ui.layout}
            onChange={ui.setLayout}
            options={[["board", <><Columns3 />Board</>], ["list", <><List />List</>]] as const}
          />
        </div>
      </div>
    );
  }

  if (ui.view === "tasks") {
    return (
      <div className={wrap}>
        <label htmlFor="towner" className="text-xs font-medium text-ink-2">Tasks for</label>
        <NativeSelect id="towner" className="w-auto" value={ui.taskOwnerId} onChange={(e) => ui.setTaskOwnerId(e.target.value)}>
          <option value="">Everyone</option>
          {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </NativeSelect>
        {canWrite && (
          <div className="ml-auto">
            <Button size="sm" onClick={() => setAddTask(true)}>Add task</Button>
          </div>
        )}
        <AddTaskDialog open={addTask} onOpenChange={setAddTask} />
      </div>
    );
  }
  return null;
}
