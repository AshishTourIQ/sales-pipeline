"use client";

import { OFFERS, TIER_BANDS, TOUCHPOINT_KINDS, TRACKS, VISITOR_TYPES, touchpointLabel } from "../../config/template";
import { useData } from "../../context/data-context";
import { useUi } from "../../context/ui-context";
import { DAY, daysSince, dueLabel, fmtDay, today } from "../../lib/dates";
import { isCall, teamInvolvement } from "../../lib/involvement";
import { reachedOrPast } from "../../lib/pipeline";
import type { StageKey } from "../../types";
import { Avatar, Panel, PHASE_COLOR } from "../common";
import { BarChart, type BarRow } from "./BarChart";

const page = "max-w-[1120px] p-3.5 tab:px-[18px] tab:pb-7 tab:pt-4 desk:px-6 desk:pb-8 desk:pt-5";
const th = "whitespace-nowrap border-b border-line px-2 py-[7px] text-left text-xs font-semibold text-ink-2";
const td = "border-b border-line p-2 align-middle";
const HOUR = 3_600_000;
/** Tier A with no touch after this many hours: flagged here, and emailed by the server (TIER_A_TOUCH_HOURS). */
const TIER_A_TOUCH_HOURS = 24;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const hoursBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / HOUR;
const fmtHours = (h: number | null) => (h == null ? "–" : h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`);
const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

export function DashboardView() {
  const ui = useUi();
  const { deals, tasks, stages, settings, team, label, memberName, pipeline, openTasks } = useData();
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

  if (tab === "involvement") {
    const rows = teamInvolvement(deals, team, pipeline).filter((r) => r.deals > 0);
    const calls = deals.reduce((n, d) => n + d.activities.filter(isCall).length, 0);
    const unrecorded = deals.reduce((n, d) => n + d.activities.filter((a) => isCall(a) && !(a.attendeeIds ?? []).length).length, 0);
    return (
      <div className={page}>
        <Panel className="mt-0" title="Involvement by person" sub="Commission follows involvement across the whole journey: owner, met at the booth, account manager, or on the calls.">
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead><tr>
                  <th className={th}>Person</th><th className={th}>Deals involved</th><th className={th}>Calls attended</th><th className={th}>Attendance</th>
                  <th className={th}>Signed deals</th><th className={th}>Signed, on every call</th><th className={th}>Account manager for</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const name = memberName(r.id);
                    return (
                      <tr key={r.id}>
                        <td className={td}><span className="inline-flex items-center gap-2"><Avatar name={name} />{name}</span></td>
                        <td className={`${td} tabular-nums`}>{r.deals}</td>
                        <td className={`${td} tabular-nums`}>{r.attended} of {r.callsOnTheirDeals}</td>
                        <td className={`${td} tabular-nums`}>{r.rate == null ? "No calls" : `${Math.round(r.rate * 100)}%`}</td>
                        <td className={`${td} tabular-nums`}>{r.signed}</td>
                        <td className={`${td} tabular-nums ${r.signedAllCalls ? "font-medium text-ok" : ""}`}>{r.signedAllCalls}</td>
                        <td className={`${td} tabular-nums`}>{r.accountManaged}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="m-0 text-ink-3">Nobody is recorded on a deal yet.</p>}
        </Panel>
        {unrecorded > 0 && (
          <p className="mt-3.5 text-[13px] text-warn">{unrecorded} of {calls} calls and meetings don&apos;t say who from the team was on them. Add attendees in each deal&apos;s Activity tab so the numbers are right.</p>
        )}
        <p className="mt-2 text-xs text-ink-3">Attendance = calls attended ÷ all calls and meetings on the deals they&apos;re involved in. Sample deals are left out.</p>
      </div>
    );
  }

  if (tab === "journey") {
    const TRACK_COLOR: Record<string, string> = { game: "var(--engage)", analysis: "var(--info)", audit: "var(--launch)" };
    const onTrack = TRACKS.map(([k, text]) => {
      const list = deals.filter((d) => d.track === k);
      return { k, text, n: list.length, demo: list.filter((d) => reachedOrPast(pipeline, d, "s6")).length };
    });
    const trackRows: BarRow[] = onTrack.map((t) => ({ id: t.k, label: t.text, value: t.n, color: TRACK_COLOR[t.k] ?? "var(--find)" }));
    const shareRows: BarRow[] = onTrack.map((t) => {
      const pct = t.n ? Math.round((t.demo / t.n) * 100) : 0;
      return { id: t.k, label: t.text, value: pct, color: TRACK_COLOR[t.k] ?? "var(--find)", display: `${pct}% (${t.demo} of ${t.n})` };
    });
    const stepRows: BarRow[] = TOUCHPOINT_KINDS.map(([k, text]) => ({
      id: k, label: text, value: deals.filter((d) => (d.touchpoints ?? []).some((t) => t.kind === k)).length, color: "var(--find)",
    }));
    const waiting = deals.filter((d) => d.stage === "offer").sort((a, b) => a.stageChangedAt.localeCompare(b.stageChangedAt));
    const offerLimit = stages.find((s) => s.key === "offer")?.limit ?? 14;
    if (!deals.some((d) => d.track || d.touchpoints?.length)) {
      return <div className={page}><Panel className="mt-0" title="Journey"><p className="m-0 text-ink-3">Nothing yet. Leads show up here once they play the game, take the comparative analysis or the audit, or book a demo.</p></Panel></div>;
    }
    return (
      <div className={page}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          {[...onTrack.map((t) => [t.text, t.n] as const), ["Waiting in Offer sent", waiting.length] as const].map(([name, n]) => (
            <div key={name} className="rounded-xl border border-line bg-panel px-4 py-3.5 shadow-sh1">
              <span className="block text-xs font-medium text-ink-2">{name}</span>
              <b className="mt-1 block text-[26px] font-semibold tabular-nums tracking-[-.02em]">{n}</b>
            </div>
          ))}
        </div>
        <Panel title="Leads on each track" sub="The offer each lead took instead of a demo: game (tier D), comparative analysis (C), audit (B)">
          <BarChart rows={trackRows} caption="Leads on each track" leftWidth={170} />
        </Panel>
        <Panel title="Share of each track that reached a demo" sub="Booked a demo or went further">
          <BarChart rows={shareRows} caption="Share of each track that reached a demo" valueHeader="Reached a demo" leftWidth={170} />
        </Panel>
        <Panel title="Steps taken" sub="Leads with each step on their journey">
          <BarChart rows={stepRows} caption="Steps taken" valueHeader="Leads" leftWidth={220} />
        </Panel>
        <Panel title="Waiting for a demo" sub={`In Offer sent, longest first. Red is past ${offerLimit} days.`}>
          {waiting.length ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead><tr><th className={th}>Company</th><th className={th}>Track</th><th className={th}>Waiting</th><th className={th}>Last step</th><th className={th}>Owner</th><th className={th}>Next task</th></tr></thead>
                <tbody>
                  {waiting.map((d) => {
                    const days = daysSince(d.stageChangedAt);
                    const last = [...(d.touchpoints ?? [])].sort((a, b) => b.at.localeCompare(a.at))[0];
                    const next = openTasks.get(d.id)?.[0];
                    return (
                      <tr key={d.id} className="cursor-pointer hover:bg-hover" onClick={() => ui.openDeal(d.id)}>
                        <td className={`${td} font-medium`}>{d.company.name}</td>
                        <td className={td}>{TRACKS.find(([k]) => k === d.track)?.[1] ?? "Not set"}</td>
                        <td className={`${td} tabular-nums ${days > offerLimit ? "font-medium text-danger" : ""}`}>{days}d</td>
                        <td className={td}>{last ? `${touchpointLabel(last.kind)}, ${fmtDay(last.at)}` : <span className="text-ink-3">None yet</span>}</td>
                        <td className={td}>{memberName(d.ownerId) || "Unassigned"}</td>
                        <td className={td}>{next ? <>{next.title}<div className="text-xs text-ink-3">{dueLabel(next.due)}</div></> : <span className="font-medium text-warn">None</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="m-0 text-ink-3">Nobody is waiting in Offer sent.</p>}
        </Panel>
      </div>
    );
  }

  if (tab === "booth") {
    const booth = deals.filter((d) => d.booth);
    const operators = booth.filter((d) => d.booth?.visitor === "operator");
    const TIER_COLOR: Record<string, string> = { A: "var(--ok)", B: "var(--info)", C: "var(--warn)", D: "var(--lanes)" };
    const tierRows: BarRow[] = TIER_BANDS.map(([t]) => ({ id: t, label: `Tier ${t}`, value: operators.filter((d) => d.booth?.tier === t).length, color: TIER_COLOR[t] ?? "var(--find)" }));
    const offerRows: BarRow[] = OFFERS.map(([k, text]) => ({ id: k, label: text, value: booth.filter((d) => d.booth?.offer === k).length, color: "var(--engage)" }));
    const visitorRows: BarRow[] = VISITOR_TYPES.map(([k, text]) => ({ id: k, label: text, value: booth.filter((d) => d.booth?.visitor === k).length, color: "var(--find)" }))
      .filter((r) => r.value > 0);
    const staff = new Map<string, [number, number, number]>();
    booth.forEach((d) => {
      const r = staff.get(d.metById) ?? [0, 0, 0];
      r[0]++;
      if (d.booth?.tier === "A") r[1]++;
      if (reachedOrPast(pipeline, d, "s6")) r[2]++;
      staff.set(d.metById, r);
    });
    const staffRows = [...staff.entries()].sort((a, b) => b[1][0] - a[1][0]);
    // Speed to lead: booth → first touch (email, call, meeting or the follow-up ticked) and → demo
    const speed = TIER_BANDS.map(([t]) => {
      const list = operators.filter((d) => d.booth?.tier === t);
      const fu = settings.boothFollowup[t];
      const targetH = Math.max(1, fu?.days ?? 1) * 24;
      const touchH = list.filter((d) => d.firstTouchAt).map((d) => hoursBetween(d.createdAt, d.firstTouchAt!));
      const demoH = list.filter((d) => d.demoAt).map((d) => Math.max(0, hoursBetween(d.createdAt, d.demoAt!)));
      return { t, n: list.length, touched: touchH.length, onTime: touchH.filter((h) => h <= targetH).length, targetH,
        touchMed: median(touchH), demo: demoH.length, demoMed: median(demoH) };
    }).filter((r) => r.n > 0);
    const now = Date.now();
    const waitingTouch = operators
      .filter((d) => !d.firstTouchAt && d.stage !== "lost" && d.stage !== "nurture" && (d.booth?.tier === "A" || d.booth?.tier === "B"))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!booth.length) {
      return <div className={page}><Panel className="mt-0" title="Booth leads"><p className="m-0 text-ink-3">No booth leads yet. Use Booth lead at the top to score a visitor.</p></Panel></div>;
    }
    return (
      <div className={page}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
          {[["Booth leads", booth.length], ...TIER_BANDS.map(([t]) => [`Tier ${t}`, operators.filter((d) => d.booth?.tier === t).length] as const)].map(([name, n]) => (
            <div key={name} className="rounded-xl border border-line bg-panel px-4 py-3.5 shadow-sh1">
              <span className="block text-xs font-medium text-ink-2">{name}</span>
              <b className="mt-1 block text-[26px] font-semibold tabular-nums tracking-[-.02em]">{n}</b>
            </div>
          ))}
        </div>
        <Panel title="Speed to lead" sub="From the booth to the first time the team reached out (email, call, meeting, or the follow-up ticked), and to a booked demo. On time = within the tier's follow-up days (Settings → Booth form), at least 24 hours.">
          {speed.length ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead><tr>
                  <th className={th}>Tier</th><th className={th}>Leads</th><th className={th}>Contacted</th><th className={th}>On time</th>
                  <th className={th}>Median to first touch</th><th className={th}>Reached a demo</th><th className={th}>Median to demo</th>
                </tr></thead>
                <tbody>
                  {speed.map((r) => (
                    <tr key={r.t}>
                      <td className={`${td} font-medium`}>Tier {r.t}</td>
                      <td className={`${td} tabular-nums`}>{r.n}</td>
                      <td className={`${td} tabular-nums ${r.touched < r.n ? "text-warn" : ""}`}>{r.touched} of {r.n}</td>
                      <td className={`${td} tabular-nums`} title={`Within ${fmtHours(r.targetH)}`}>{r.touched ? `${Math.round((r.onTime / r.touched) * 100)}%` : "–"}</td>
                      <td className={`${td} tabular-nums`}>{fmtHours(r.touchMed)}</td>
                      <td className={`${td} tabular-nums`}>{r.demo} of {r.n}</td>
                      <td className={`${td} tabular-nums`}>{fmtHours(r.demoMed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="m-0 text-ink-3">No operators scored yet.</p>}
        </Panel>
        <Panel title="Not contacted yet" sub={`Tier A and B operators nobody has reached out to, oldest first. Tier A turns red after ${TIER_A_TOUCH_HOURS} hours, and the owner and the GTM lead get an email.`}>
          {waitingTouch.length ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead><tr><th className={th}>Company</th><th className={th}>Tier</th><th className={th}>Since the booth</th><th className={th}>Owner</th><th className={th}>Next task</th></tr></thead>
                <tbody>
                  {waitingTouch.map((d) => {
                    const h = (now - new Date(d.createdAt).getTime()) / HOUR;
                    const late = d.booth?.tier === "A" && h > TIER_A_TOUCH_HOURS;
                    const next = openTasks.get(d.id)?.[0];
                    return (
                      <tr key={d.id} className="cursor-pointer hover:bg-hover" onClick={() => ui.openDeal(d.id)}>
                        <td className={`${td} font-medium`}>{d.company.name}</td>
                        <td className={td}>{d.booth?.tier}</td>
                        <td className={`${td} tabular-nums ${late ? "font-medium text-danger" : ""}`}>{fmtHours(h)}</td>
                        <td className={td}>{memberName(d.ownerId) || "Unassigned"}</td>
                        <td className={td}>{next ? <>{next.title}<div className="text-xs text-ink-3">{dueLabel(next.due)}</div></> : <span className="font-medium text-warn">None</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="m-0 text-ink-3">Every Tier A and B operator has been contacted.</p>}
        </Panel>
        <Panel title="Operators by tier" sub="A = call first. Capped leads count at their capped tier.">
          <BarChart rows={tierRows} caption="Operators by tier" />
        </Panel>
        <Panel title="Offer given at the booth">
          <BarChart rows={offerRows} caption="Offer given at the booth" leftWidth={160} />
        </Panel>
        {visitorRows.length > 1 && (
          <Panel title="Visitors by type">
            <BarChart rows={visitorRows} caption="Visitors by type" leftWidth={160} />
          </Panel>
        )}
        <Panel title="By staff member" sub="Who met them at the booth">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead><tr><th className={th}>Staff</th><th className={th}>Leads</th><th className={th}>Tier A</th><th className={th}>Reached Demo booked</th></tr></thead>
              <tbody>
                {staffRows.map(([id, r]) => {
                  const name = memberName(id) || "Not set";
                  return (
                    <tr key={id || "none"}>
                      <td className={td}><span className="inline-flex items-center gap-2"><Avatar name={id ? name : ""} />{name}</span></td>
                      <td className={`${td} tabular-nums`}>{r[0]}</td>
                      <td className={`${td} tabular-nums`}>{r[1]}</td>
                      <td className={`${td} tabular-nums`}>{r[2]}</td>
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
    const evs = new Map<string, [number, number, number]>();
    deals.filter((d) => d.event).forEach((d) => {
      const r = evs.get(d.event) ?? [0, 0, 0];
      r[0]++;
      if (reachedOrPast(pipeline, d, "s6")) r[1]++;
      if (reachedOrPast(pipeline, d, "s11")) r[2]++;
      evs.set(d.event, r);
    });
    const eventRows = [...evs.entries()].sort((a, b) => b[1][0] - a[1][0]);
    const costOf = (e: string) => settings.eventCosts?.[e] ?? null;
    const anyCost = eventRows.some(([e]) => costOf(e) != null);
    const per = (cost: number | null, n: number) => (cost == null ? "–" : n ? money(cost / n) : "No result yet");
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
        <Panel title="Leads by event" sub={`Every lead with an event, whatever its source (booth, game, analysis, Arival app meeting).${anyCost ? " Costs come from Settings → Booth form, divided by this pipeline's results." : " Add what each event cost in Settings → Booth form to see cost per lead, demo and signed deal."}`}>
          {eventRows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead><tr>
                  <th className={th}>Event</th><th className={th}>Leads</th><th className={th}>Demos booked</th><th className={th}>Signed</th>
                  {anyCost && <><th className={th}>Cost</th><th className={th}>Per lead</th><th className={th}>Per demo</th><th className={th}>Per signed</th></>}
                </tr></thead>
                <tbody>{eventRows.map(([e, r]) => {
                  const c = costOf(e);
                  return (
                    <tr key={e}>
                      <td className={td}>{e}</td><td className={`${td} tabular-nums`}>{r[0]}</td><td className={`${td} tabular-nums`}>{r[1]}</td><td className={`${td} tabular-nums`}>{r[2]}</td>
                      {anyCost && <>
                        <td className={`${td} tabular-nums`}>{c == null ? "–" : money(c)}</td>
                        <td className={`${td} tabular-nums`}>{per(c, r[0])}</td>
                        <td className={`${td} tabular-nums`}>{per(c, r[1])}</td>
                        <td className={`${td} tabular-nums`}>{per(c, r[2])}</td>
                      </>}
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          ) : <p className="m-0 text-ink-3">No leads from an event yet.</p>}
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
