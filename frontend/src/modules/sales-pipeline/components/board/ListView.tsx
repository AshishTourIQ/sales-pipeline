"use client";

import {
  createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { SCORE_MAX } from "../../config/template";
import { useData } from "../../context/data-context";
import { useUi } from "../../context/ui-context";
import { daysSince, dueLabel, today } from "../../lib/dates";
import { dealsInPhase, filterDeals } from "../../lib/selectors";
import { tierVariant } from "../../lib/scoring";
import type { Deal, StageKey } from "../../types";
import { Avatar } from "../common";
import { DaysLabel } from "./DealCard";
import { Welcome } from "./Welcome";

const col = createColumnHelper<Deal>();
const INTEREST_ORDER: Record<string, number> = { Hot: 0, Warm: 1, Cold: 2 };

export function ListView() {
  const ui = useUi();
  const { deals, stages, flags, openTasks, memberName, label, pipeline, canWrite } = useData();
  const [sorting, setSorting] = useState<SortingState>([{ id: "stage", desc: false }]);

  const rows = useMemo(
    () => dealsInPhase(filterDeals(deals, ui.filters, flags), stages, ui.sub.board ?? "all"),
    [deals, ui.filters, flags, stages, ui.sub.board],
  );

  const columns = useMemo(() => [
    col.accessor((d) => d.company.name.toLowerCase(), {
      id: "company", header: "Company",
      cell: ({ row: { original: d } }) => (
        <>
          <div className="font-semibold">
            {d.company.name || "Unnamed"}{d.sample && <> <Badge variant="sample">Sample</Badge></>}
            {d.company.category === "competitor" && <> <Badge variant="over">Competitor</Badge></>}
          </div>
          <div className="text-xs text-ink-3">{[d.contact.name, d.contact.title].filter(Boolean).join(", ") || "No contact yet"}</div>
        </>
      ),
    }),
    col.accessor((d) => { const i = stages.findIndex((s) => s.key === d.stage); return i >= 0 ? i : 999; }, {
      id: "stage", header: "Stage",
      cell: ({ row: { original: d } }) => canWrite ? (
        <NativeSelect
          aria-label={`Stage for ${d.company.name || "deal"}`}
          className="w-auto max-w-[190px] px-2 py-[5px] text-[13px]"
          value={d.stage}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => ui.requestMove(d.id, e.target.value as StageKey)}
        >
          {stages.map((s) => <option key={s.key} value={s.key}>{label(s.key)}</option>)}
        </NativeSelect>
      ) : label(d.stage),
    }),
    col.accessor((d) => memberName(d.ownerId) || "~", {
      id: "owner", header: "Owner",
      cell: ({ row: { original: d } }) => <span className="inline-flex items-center gap-[7px]"><Avatar name={memberName(d.ownerId)} />{memberName(d.ownerId) || "Unassigned"}</span>,
    }),
    col.accessor((d) => d.source || "~", { id: "source", header: "Source", cell: ({ row: { original: d } }) => d.source }),
    col.accessor((d) => d.company.platform || "~", { id: "platform", header: "Platform", cell: ({ row: { original: d } }) => d.company.platform }),
    col.accessor((d) => d.booth?.tier || "~", {
      id: "tier", header: "Tier",
      cell: ({ row: { original: d } }) => d.booth?.tier
        ? <Badge variant={tierVariant(d.booth.tier)} title={`${d.booth.points} of ${SCORE_MAX} points`}>{d.booth.tier}</Badge>
        : null,
    }),
    col.accessor((d) => d.fit, { id: "fit", header: "Fit", cell: (c) => <span className="tabular-nums">{c.getValue()}</span> }),
    col.accessor((d) => daysSince(d.stageChangedAt), {
      id: "days", header: "In stage",
      cell: ({ row: { original: d } }) => {
        const f = flags.get(d.id)?.[0];
        return (
          <>
            <DaysLabel deal={d} pipeline={pipeline} />
            {f && <div className={`text-xs ${f.lvl === "over" ? "font-medium text-danger" : "font-medium text-warn"}`}>{f.text}</div>}
          </>
        );
      },
    }),
    col.accessor((d) => openTasks.get(d.id)?.[0]?.due || "9999", {
      id: "next", header: "Next step",
      cell: ({ row: { original: d } }) => {
        const nt = openTasks.get(d.id)?.[0];
        if (!nt) return d.stage !== "lost" && d.stage !== "s13" ? <span className="font-medium text-warn">None</span> : null;
        return (
          <>
            <div className="max-w-[220px] truncate">{nt.title}</div>
            <div className={`text-xs ${nt.due && nt.due < today() ? "font-medium text-danger" : "text-ink-3"}`}>{dueLabel(nt.due)}</div>
          </>
        );
      },
    }),
    col.accessor((d) => INTEREST_ORDER[d.interest] ?? 3, {
      id: "interest", header: "Interest",
      cell: ({ row: { original: d } }) => d.interest ? <Badge variant={d.interest === "Hot" ? "hot" : d.interest === "Warm" ? "warm" : "cold"}>{d.interest}</Badge> : null,
    }),
  ], [canWrite, stages, label, memberName, flags, openTasks, pipeline, ui]);

  const table = useReactTable({
    data: rows, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), sortDescFirst: false,
  });

  if (!rows.length) {
    return (
      <>
        <Welcome />
        {deals.length > 0 && (
          <div className="mx-auto my-14 max-w-[560px] px-5">
            <h2 className="m-0 mb-2 text-[22px] font-semibold tracking-[-.01em]">No deals match</h2>
            <p className="m-0 text-ink-2">Clear the search or filters to see every deal.</p>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <Welcome />
      <div className="mx-[18px] mb-6 overflow-auto rounded-xl border border-line bg-panel shadow-sh1 desk:mx-6">
        <table className="w-full min-w-[1000px] border-separate border-spacing-0 text-[13.5px]">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const s = h.column.getIsSorted();
                  return (
                    <th key={h.id} scope="col" aria-sort={s ? (s === "asc" ? "ascending" : "descending") : undefined}
                      className="sticky top-0 z-[1] whitespace-nowrap border-b border-line bg-panel px-3 py-2.5 text-left text-xs font-semibold text-ink-2">
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className={`inline-flex items-center gap-1 ${s ? "text-ink" : ""}`}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {s === "asc" ? " ↑" : s === "desc" ? " ↓" : ""}
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr
                key={r.id}
                tabIndex={0}
                className="group cursor-pointer"
                onClick={(e) => { if (!(e.target as HTMLElement).closest("select,input,button,a")) ui.openDeal(r.original.id); }}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); ui.openDeal(r.original.id); } }}
              >
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className="whitespace-nowrap border-b border-line px-3 py-2.5 align-middle group-last:border-b-0 group-hover:bg-[#FAFBFC] first:min-w-[230px] first:whitespace-normal">
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
