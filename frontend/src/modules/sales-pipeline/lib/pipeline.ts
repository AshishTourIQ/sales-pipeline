import { ALL_TEMPLATE_STAGES, ORDER, PIPELINE_TEMPLATES, ROUTES, SOURCES, TEMPLATE, type Route } from "../config/template";
import type { Company, Deal, Flag, Pipeline, PipelineTemplate, Stage, StageConfig, StageKey, Task } from "../types";
import { daysSince, today } from "./dates";

/*
 * A pipeline's stages are its own ordered list (mirror of backend services/stages.py):
 * the main route in order, then the Nurture and Lost lanes. Built-in keys keep their
 * automation; custom stages ("c_...") have none. Numbers follow the order.
 */

const LANES: StageKey[] = ["nurture", "lost"];
const templateEntry = (key: StageKey): StageConfig => {
  const t = ALL_TEMPLATE_STAGES.find((x) => x.key === key);
  return t
    ? { key, name: t.name, phase: t.phase, limit: t.limit, ownerId: t.ownerId, ...(t.optional ? { optional: true } : {}), ...(t.lane ? { lane: true } : {}) }
    : { key, name: key, phase: "win", limit: null, ownerId: "" };
};

/** A template as a stage list (new pipelines start from it). */
export const defaultStageList = (template: PipelineTemplate = "touriq"): StageConfig[] =>
  (PIPELINE_TEMPLATES[template] ?? PIPELINE_TEMPLATES.touriq).stages.map((t) => templateEntry(t.key));

/** Stored list, tolerating the old {key: overrides} map and always ending with both lanes. */
export function rawStages(p: Pipeline | null | undefined): StageConfig[] {
  const stored: unknown = p?.stages;
  let items: StageConfig[];
  if (Array.isArray(stored)) items = (stored as StageConfig[]).filter((s) => s && s.key);
  else if (stored && typeof stored === "object") {
    const map = stored as Record<string, Partial<StageConfig>>;
    items = TEMPLATE.map((t) => ({ ...templateEntry(t.key), ...(map[t.key] ?? {}) }));
  } else items = defaultStageList();
  const main = items.filter((s) => !LANES.includes(s.key));
  const lanes = LANES.map((k) => items.find((s) => s.key === k) ?? templateEntry(k));
  return [...main, ...lanes];
}

/** Stages in order; Pilot dropped when switched off; main stages numbered 1..n. */
export function stagesOf(p: Pipeline | null | undefined): Stage[] {
  let n = 0;
  const out: Stage[] = [];
  for (const s of rawStages(p)) {
    const base = ALL_TEMPLATE_STAGES.find((t) => t.key === s.key);
    const lane = LANES.includes(s.key);
    const optional = !!(s.optional ?? base?.optional);
    if (s.key === "pilot" && p?.pilotEnabled === false) continue;
    const num = !lane && !optional ? ++n : null;
    out.push({
      ...s,
      name: s.name || base?.name || s.key,
      phase: lane ? "lanes" : s.phase || base?.phase || "win",
      limit: s.limit === undefined ? (base?.limit ?? null) : s.limit === null ? null : Number(s.limit),
      ownerId: s.ownerId || "",
      lane, optional, custom: !base, num,
    });
  }
  return out;
}

export function stageDef(p: Pipeline | null | undefined, key: StageKey): Stage {
  const found = stagesOf(p).find((s) => s.key === key);
  if (found) return found;
  const t = ALL_TEMPLATE_STAGES.find((s) => s.key === key);
  return { ...templateEntry(key), phase: t?.phase ?? "lanes", ownerId: "", num: null, lane: !!t?.lane, optional: false, custom: !t };
}

export function stageLabel(p: Pipeline | null | undefined, key: StageKey): string {
  const s = stageDef(p, key);
  return (s.num ? `${s.num} · ` : "") + s.name;
}

/** The main route (lanes excluded), in order. */
export const mainKeys = (p: Pipeline | null | undefined): StageKey[] => stagesOf(p).filter((s) => !s.lane).map((s) => s.key);

export const stageIndex = (p: Pipeline | null | undefined, key: StageKey): number => mainKeys(p).indexOf(key);

export function isForwardIn(p: Pipeline | null | undefined, from: StageKey, to: StageKey): boolean {
  const route = mainKeys(p);
  return route.includes(from) && route.includes(to) && route.indexOf(to) > route.indexOf(from);
}

/** Where a finished stage goes: the next non-optional main stage. */
export function nextStageOf(p: Pipeline | null | undefined, key: StageKey): StageKey | null {
  const route = stagesOf(p).filter((s) => !s.lane);
  const i = route.findIndex((s) => s.key === key);
  if (i < 0) return null;
  return route.slice(i + 1).find((s) => !s.optional)?.key ?? null;
}

/** A built-in stage that was removed maps to the next stage that still exists. */
export function resolveStage(p: Pipeline | null | undefined, key: StageKey): StageKey {
  const all = stagesOf(p).map((s) => s.key);
  if (all.includes(key)) return key;
  // Optional stages (Pilot, Offer sent) are only entered by choice, never as a stand-in
  const route = stagesOf(p).filter((s) => !s.lane && !s.optional).map((s) => s.key);
  const i = ORDER.indexOf(key);
  if (i >= 0) {
    const later = ORDER.slice(i + 1).find((k) => route.includes(k));
    if (later) return later;
    return route[route.length - 1] ?? "nurture";
  }
  return route[0] ?? "nurture";
}

export const entryForSourceIn = (p: Pipeline | null | undefined, source: string): StageKey =>
  resolveStage(p, SOURCES.find((s) => s[0] === source)?.[1] ?? "s1");

/** Is this deal at or past a milestone (a built-in key that may have been removed)? */
export function reachedOrPast(p: Pipeline | null | undefined, d: Deal, milestone: StageKey): boolean {
  const m = stageIndex(p, resolveStage(p, milestone));
  return m >= 0 && reachedIdx(d, p) >= m;
}

/** Route buttons: built-in routes (targets remapped if removed), or "Done → next" for custom stages. */
export function routesFor(p: Pipeline | null | undefined, key: StageKey): Route[] {
  const all = new Set(stagesOf(p).map((s) => s.key));
  const out: Route[] = [];
  // Partnerships / Referrals pipelines: Nurture comes back to their own first stage
  if (key === "nurture" && p && p.template !== "touriq") {
    const first = stagesOf(p).find((s) => !s.lane && !s.optional);
    return first ? [["Re-engage", first.key]] : [];
  }
  for (const [label, to] of ROUTES[key] ?? []) {
    const target = all.has(to) ? to : resolveStage(p, to);
    if (target !== key && all.has(target) && !out.some((r) => r[1] === target)) out.push([label, target]);
  }
  const next = nextStageOf(p, key);
  if (next && !out.some((r) => r[1] === next) && (stageDef(p, key).custom || !ROUTES[key]?.length)) out.unshift(["Done", next]);
  return out;
}

/** Fit score: the Excel 5-point rule. */
export function fitScore(c: Partial<Company> | null | undefined): number {
  if (!c) return 0;
  let s = 0;
  if (c.segment === "Water / boat") s += 1;
  if (c.products5) s += 1;
  if (c.platform === "FareHarbor") s += 1;
  else if (c.platform === "Peek Pro") s += 0.5;
  if (c.sellsOut) s += 1;
  if (c.reachable) s += 1;
  return s;
}

/** Furthest main-route stage (index in this pipeline's route) the deal ever reached. */
export function reachedIdx(d: Deal, p?: Pipeline | null): number {
  const route = p ? mainKeys(p) : ORDER;
  let m = route.indexOf(d.stage);
  for (const h of d.history) {
    const i = route.indexOf(h.to);
    if (i > m) m = i;
  }
  return m;
}

function firstContactAt(d: Deal): string | null {
  return d.history.find((x) => x.to === "s4" || x.to === "s5")?.at ?? null;
}

export function nearLimit(limit: number | null, days: number): boolean {
  return !!limit && limit >= 3 && days >= Math.ceil(limit * 0.75);
}

export function computeFlags(d: Deal, p: Pipeline | null | undefined): Flag[] {
  const out: Flag[] = [];
  const sd = stageDef(p, d.stage);
  const days = daysSince(d.stageChangedAt);
  if (sd.limit && !sd.lane) {
    if (days > sd.limit) out.push({ lvl: "over", text: `${days - sd.limit}d past the ${sd.limit}-day limit` });
    else if (nearLimit(sd.limit, days)) out.push({ lvl: "near", text: `Near the ${sd.limit}-day limit` });
  }
  if (d.stage === "nurture" && d.reengageDate && d.reengageDate < today()) out.push({ lvl: "over", text: "Re-engage date passed" });
  if (d.stage === "s4" || d.stage === "s5") {
    const fc = firstContactAt(d);
    if (fc && daysSince(fc) >= 5) out.push({ lvl: "near", text: "No demo yet after 5+ days" });
  }
  if (d.payment?.status === "Late") out.push({ lvl: "over", text: "Payment late" });
  return out;
}

export const isStuck = (flags: Flag[]): boolean => flags.some((f) => f.lvl === "over");

export const byDue = (a: Task, b: Task): number => (a.due || "9999").localeCompare(b.due || "9999");

export function openTasksByDeal(tasks: Task[]): Map<string, Task[]> {
  const m = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.done || !t.dealId) continue;
    const list = m.get(t.dealId) ?? [];
    list.push(t);
    m.set(t.dealId, list);
  }
  m.forEach((l) => l.sort(byDue));
  return m;
}

export const initials = (n: string | undefined): string =>
  String(n || "?").trim().split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";

const AV_COLORS = ["#4F6BED", "#7C5CF0", "#1E9E62", "#C2410C", "#BE185D", "#0E7490", "#6D28D9", "#15803D"] as const;
export function avColor(name: string): string {
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length] ?? AV_COLORS[0];
}

export const newId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const EMPTY_COMPANY: Company = {
  name: "", website: "", region: "", segment: "", platform: "", products5: false, sellsOut: false, reachable: false, category: "",
};
