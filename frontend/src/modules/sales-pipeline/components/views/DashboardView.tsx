"use client";

import { useData } from "../../context/data-context";
import { useUi } from "../../context/ui-context";
import { DAY, today } from "../../lib/dates";
import { reachedOrPast } from "../../lib/pipeline";
import type { StageKey } from "../../types";
import { Avatar, Panel, PHASE_COLOR } from "../common";
import { BarChart, type BarRow } from "./BarChart";

const page = "max-w-[1120px] p-3.5 tab:px-[18px] tab:pb-7 tab:pt-4 desk:px-6 desk:pb-8 desk:pt-5";
const th = "whitespace-nowrap border-b border-line px-2 py-[7px] text-left text-xs font-semibold text-ink-2";
const td = "border-b border-line p-2 align-middle";

export function DashboardView() {
  const ui = useUi();
  const { deals, tasks, stages, settings, team, label, memberName, pipeline } = useData();
  const tg = settings.targets;
  // "Reached this stage or further"; built-in milestones that were removed map to the next stage
  const reached = (k: StageKey) => deals.filter((d) => reachedOrPast(pipeline, d, k)).length;
  const leads = deals.length;
  const tab = ui.sub.dash;

  if (tab === "score") {
    const cards: [string, number, number, string?][] = [
      ["Leads in the pipeline", leads, tg.leads],
      ["Outreach sent", reached("s4"), tg.outreach],
      ["Demos booked", reached("s6"), leads, "Goal: a demo with every lead"],
      ["Demos held", reached("s7"), tg.demosHeld],
      ["Snapshots sent", deals.filter((d) => d.snapshotSent).length, tg.snapshots],
      ["Signed", reached("s11"), tg.signed],
    ];
    const rows: BarRow[] = stages.map((s) => ({ id: s.key, label: label(s.key), value: deals.filter((d) => d.stage === s.key).length, color: PHASE_COLOR[s.phase] }));
    return (
      <div className={page}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          {cards.map(([name, n, target, note]) => {
            const pct = target ? Math.min(100, Math.round((n / target) * 100)) : 0;
            return (
              <div key={name} className="rounded-xl border border-line bg-panel px-4 py-3.5 shadow-sh1">
                <span className="block text-xs font-medium text-ink-2">{name}</span>
                <b className="mt-1 block text-[26px] font-semibold tabular-nums tracking-[-.02em]">{n}</b>
                <div className="mt-2.5 h-[5px] overflow-hidden rounded-[5px] bg-sunk" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${name}: ${pct}% of target`}>
                  <i className="block h-full rounded-[5px] bg-brand" style={{ width: `${pct}%` }} />
                </div>
                <small className="mt-1.5 block text-xs text-ink-3">{note ?? `Target ${target}`}{target ? `, ${pct}%` : ""}</small>
              </div>
            );
          })}
        </div>
        <Panel title="Deals in each stage now">
          <BarChart rows={rows} caption="Deals in each stage now" />
        </Panel>
        <p className="mt-3.5 text-xs text-ink-3">Counts include deals that reached the stage or went further. Targets come from the marketing plan; change them in Settings.</p>
      </div>
    );
  }

  if (tab === "funnel") {
    const route = stages.filter((s) => !s.lane && !s.optional).map((s) => s.key);
    const funnel: BarRow[] = route.map((k, i) => {
      const n = reached(k);
      const prevKey = route[i - 1];
      const prev = prevKey ? reached(prevKey) : n;
      const pct = prev ? Math.round((n / prev) * 100) : 0;
      return { id: k, label: label(k), value: n, color: "var(--find)", display: i ? `${n} (${pct}%)` : String(n) };
    });
    const dur: Partial<Record<StageKey, number[]>> = {};
    deals.forEach((d) => {
      for (let i = 0; i < d.history.length - 1; i++) {
        const a = d.history[i], b = d.history[i + 1];
        if (!a || !b) continue;
        const days = (new Date(b.at).getTime() - new Date(a.at).getTime()) / DAY;
        if (days >= 0) (dur[a.to] ??= []).push(days);
      }
    });
    const avg: BarRow[] = stages.filter((s) => dur[s.key]?.length).map((s) => {
      const a = dur[s.key] ?? [];
      const v = a.reduce((x, y) => x + y, 0) / a.length;
      const slow = !!s.limit && v > s.limit;
      return { id: s.key, label: label(s.key), value: Number(v.toFixed(1)), color: slow ? "var(--danger)" : "var(--find)", display: `${v.toFixed(1)}${s.limit ? ` / ${s.limit}` : ""}${slow ? " (slow)" : ""}` };
    });
    return (
      <div className={page}>
        <Panel className="mt-0" title="Conversion along the route" sub="Deals that reached each stage or later, and the share that made it from the stage before">
          <BarChart rows={funnel} caption="Conversion along the route" />
        </Panel>
        <Panel title="Average days in each stage" sub="Red means slower than the stage's time limit">
          {avg.length ? <BarChart rows={avg} caption="Average days in each stage" valueHeader="Average days / limit" /> : <p className="m-0 text-ink-3">Fills in as deals move through stages.</p>}
        </Panel>
      </div>
    );
  }

  if (tab === "sources") {
    const srcs = new Map<string, [number, number, number]>();
    deals.forEach((d) => {
      const s = d.source || "Not set";
      const r = srcs.get(s) ?? [0, 0, 0];
      r[0]++;
      if (reachedOrPast(pipeline, d, "s6")) r[1]++;
      if (reachedOrPast(pipeline, d, "s11")) r[2]++;
      srcs.set(s, r);
    });
    const srcRows = [...srcs.entries()].sort((a, b) => b[1][0] - a[1][0]);
    const lr = new Map<string, number>();
    deals.filter((d) => d.stage === "lost").forEach((d) => { const r = d.lossReason || "No reason"; lr.set(r, (lr.get(r) ?? 0) + 1); });
    const lossRows: BarRow[] = [...lr.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => ({ id: r, label: r, value: n, color: "var(--brand)" }));
    return (
      <div className={page}>
        <Panel className="mt-0" title="Lead sources">
          {srcRows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead><tr><th className={th}>Source</th><th className={th}>Leads</th><th className={th}>Demos booked</th><th className={th}>Signed</th></tr></thead>
                <tbody>{srcRows.map(([s, r]) => <tr key={s}><td className={td}>{s}</td><td className={`${td} tabular-nums`}>{r[0]}</td><td className={`${td} tabular-nums`}>{r[1]}</td><td className={`${td} tabular-nums`}>{r[2]}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="m-0 text-ink-3">No leads yet.</p>}
        </Panel>
        <Panel title="Why deals were lost">
          {lossRows.length ? <BarChart rows={lossRows} caption="Why deals were lost" leftWidth={140} /> : <p className="m-0 text-ink-3">No lost deals yet. Review the reasons monthly once they appear.</p>}
        </Panel>
      </div>
    );
  }

  const own = new Map<string, [number, number, number]>();
  team.forEach((m) => own.set(m.id, [0, 0, 0]));
  const t0 = today();
  tasks.filter((t) => !t.done).forEach((t) => {
    const r = own.get(t.ownerId || "") ?? [0, 0, 0];
    r[0]++;
    if (t.due && t.due < t0) r[1]++;
    own.set(t.ownerId || "", r);
  });
  deals.filter((d) => d.stage !== "lost" && d.stage !== "nurture").forEach((d) => {
    const r = own.get(d.ownerId || "") ?? [0, 0, 0];
    r[2]++;
    own.set(d.ownerId || "", r);
  });
  const ownRows = [...own.entries()].sort((a, b) => b[1][2] - a[1][2]);
  return (
    <div className={page}>
      <Panel className="mt-0" title="Workload by person">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead><tr><th className={th}>Person</th><th className={th}>Active deals</th><th className={th}>Open tasks</th><th className={th}>Overdue</th></tr></thead>
            <tbody>
              {ownRows.map(([id, r]) => {
                const name = memberName(id) || "Unassigned";
                return (
                  <tr key={id || "none"}>
                    <td className={td}><span className="inline-flex items-center gap-2"><Avatar name={id ? name : ""} />{name}</span></td>
                    <td className={`${td} tabular-nums`}>{r[2]}</td>
                    <td className={`${td} tabular-nums`}>{r[0]}</td>
                    <td className={`${td} tabular-nums ${r[1] ? "font-medium text-danger" : ""}`}>{r[1]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
