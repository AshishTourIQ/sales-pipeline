/**
 * Browser-only implementation of PipelineApi. Stores everything in localStorage
 * and runs the same automation the Django backend will run. Use it for UI work
 * and demos; switch to createDrfApi() when the backend is up.
 */
import { BOOTH_SOURCES, CHECKLISTS, DEFAULT_SETTINGS } from "../config/template";
import { addDays, DAY, dayDiff, nowIso, today } from "../lib/dates";
import {
  defaultStageList, EMPTY_COMPANY, entryForSourceIn, fitScore, mainKeys, newId, nextStageOf, rawStages, resolveStage,
  stageDef, stageIndex, stagesOf,
} from "../lib/pipeline";
import { ruleTasks, type RuleExtra } from "../lib/rules";
import { describe, gated, requirements } from "../lib/gating";
import type {
  Activity, ActivityType, AiDraftInput, AiDraftResult, CreateDealInput, CreateTaskInput, CurrentUser, Deal,
  DealMutationResult, DealPatch, HistoryEntry, ImportResult, ImportRow, MoveDealInput, Pipeline,
  PipelineSettings, StageKey, StageTaskTemplate, Task, TaskPatch,
} from "../types";
import { ApiError, type PipelineApi } from "./types";

interface MockDb {
  pipelines: Record<string, Pipeline>;
  deals: Record<string, Deal>;
  tasks: Record<string, Task>;
  settings: PipelineSettings;
  stageTasks?: Record<string, StageTaskTemplate>;
}

export interface MockApiOptions {
  storageKey?: string;
  /** Simulated network latency in ms. */
  latency?: number;
  getActor?: () => CurrentUser | null;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function templatePipeline(id: string, name: string): Pipeline {
  return { id, name, template: "touriq", pilotEnabled: true, stages: defaultStageList(), createdAt: nowIso() };
}

export function createMockApi(opts: MockApiOptions = {}): PipelineApi {
  const key = opts.storageKey ?? "sales-pipeline.mock.v1";
  const latency = opts.latency ?? 120;
  let db: MockDb = load();

  /** Host user if given, else the name picked in Settings (stored by the UI). */
  const actor = (): CurrentUser | null => {
    const a = opts.getActor?.();
    if (a) return a;
    try {
      const meId = (JSON.parse(window.localStorage.getItem("sales-pipeline.ui.v1") ?? "{}") as { meId?: string }).meId;
      return db.settings.team.find((m) => m.id === meId) ?? null;
    } catch {
      return null;
    }
  };

  function load(): MockDb {
    let saved: MockDb | null = null;
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
      saved = raw ? (JSON.parse(raw) as MockDb) : null;
    } catch { /* storage unavailable */ }
    const base: MockDb = saved ?? { pipelines: {}, deals: {}, tasks: {}, settings: clone(DEFAULT_SETTINGS) };
    if (!Object.keys(base.pipelines).length) base.pipelines.touriq = templatePipeline("touriq", "TourIQ");
    return base;
  }
  function save() {
    try { window.localStorage.setItem(key, JSON.stringify(db)); } catch { /* storage unavailable */ }
  }
  async function run<T>(fn: () => T): Promise<T> {
    await new Promise((r) => setTimeout(r, latency));
    db = load();
    const out = fn();
    save();
    return clone(out);
  }
  const mustDeal = (id: string): Deal => {
    const d = db.deals[id];
    if (!d) throw new ApiError("Deal not found", 404, "not_found");
    return d;
  };
  const pipelineOf = (id: string) => db.pipelines[id] ?? null;
  const ruleOn = (k: keyof PipelineSettings["rules"]) => db.settings.rules[k] !== false;

  const hist = (from: StageKey | null, to: StageKey): HistoryEntry => {
    const a = actor();
    return { from, to, at: nowIso(), byId: a?.id ?? null, byName: a?.name ?? "" };
  };
  const act = (type: ActivityType, text: string, at = nowIso()): Activity => {
    const a = actor();
    return { id: newId(), type, text, at, byId: a?.id ?? null, byName: a?.name ?? "" };
  };
  const capActs = (list: Activity[]) => (list.length > 150 ? list.slice(list.length - 150) : list);

  function makeTask(p: Partial<Task> & Pick<Task, "pipelineId" | "title">): Task {
    return {
      id: newId(), dealId: null, ownerId: "", due: "", done: false, doneAt: "", auto: false, autoClosed: false,
      rule: null, stage: null, createdAt: nowIso(), blocking: true, templateId: null, ...p,
    };
  }

  /** Stage tasks ("Guddu must do X in stage 1") for a deal entering `stage` owned by `ownerId`. */
  function templateTasks(deal: Deal, stage: StageKey, ownerId: string): Task[] {
    if (!ownerId) return [];
    return Object.values(db.stageTasks ?? {})
      .filter((t) => t.pipelineId === deal.pipelineId && t.stage === stage && t.ownerId === ownerId)
      .map((t) => {
        const task = makeTask({ dealId: deal.id, pipelineId: deal.pipelineId, title: t.title, ownerId, due: addDays(t.dueInDays), auto: true, stage, templateId: t.id });
        db.tasks[task.id] = task;
        return task;
      });
  }

  function applyRules(deal: Deal, to: StageKey, extra: RuleExtra, ownerId: string): { created: Task[]; closed: string[] } {
    const closed: string[] = [];
    if (ruleOn("r_autoclose")) {
      Object.values(db.tasks).forEach((t) => {
        if (t.dealId === deal.id && !t.done && t.auto && t.stage !== to) {
          Object.assign(t, { done: true, autoClosed: true, doneAt: nowIso() });
          closed.push(t.id);
        }
      });
    }
    const created = ruleTasks(to, db.settings, extra).map((t) =>
      makeTask({ dealId: deal.id, pipelineId: deal.pipelineId, title: t.title, ownerId, due: t.due, auto: true, rule: t.rule, stage: to, blocking: t.blocking }),
    );
    created.forEach((t) => { db.tasks[t.id] = t; });
    created.push(...templateTasks(deal, to, ownerId));
    return { created, closed };
  }

  function newDeal(p: Partial<Deal> & Pick<Deal, "pipelineId" | "stage">): Deal {
    return {
      id: newId(), company: { ...EMPTY_COMPANY }, contact: { name: "", title: "", email: "", phone: "", linkedin: "", decisionMaker: false },
      source: "", interest: "", ownerId: "", fit: 0, stageChangedAt: nowIso(), createdAt: nowIso(), history: [], activities: [],
      snapshotSent: false, demoDate: "", payment: { status: "Not invoiced" }, value: "", package: "", locations: "",
      lossReason: "", lossCompetitor: "", nurtureReason: "", reengageDate: "", qual: {}, pilotChecks: {}, onboarding: {}, ...p,
    };
  }

  function createDealSync(input: CreateDealInput): DealMutationResult {
    const entry = input.entryStage;
    const deal = newDeal({
      pipelineId: input.pipelineId, stage: entry, company: input.company, contact: input.contact, source: input.source,
      interest: input.interest, ownerId: input.ownerId, fit: fitScore(input.company), history: [hist(null, entry)],
      activities: input.note ? [act("note", input.note)] : [], demoDate: input.demoDate ?? "",
    });
    db.deals[deal.id] = deal;
    const booth = BOOTH_SOURCES.includes(deal.source);
    const { created } = applyRules(deal, entry, { demoDate: input.demoDate, booth }, deal.ownerId);
    if (booth && ruleOn("r_capture48")) {
      const t = makeTask({ dealId: deal.id, pipelineId: deal.pipelineId, title: "Follow up within 48 hours (booth lead)", ownerId: deal.ownerId, due: addDays(2), auto: true, rule: "r_capture48", stage: entry });
      db.tasks[t.id] = t;
      created.push(t);
    }
    return { deal, tasksCreated: created, tasksClosed: [] };
  }

  function moveSync(deal: Deal, input: MoveDealInput, byLabel?: string, system = false): DealMutationResult {
    const to = input.to;
    if (deal.stage === to) return { deal, tasksCreated: [], tasksClosed: [] };
    const p = pipelineOf(deal.pipelineId);
    if (!stagesOf(p).some((s) => s.key === to)) throw new ApiError("That stage isn't used in this pipeline.", 400, "invalid_stage");
    if (to === "lost" && !input.lossReason) throw new ApiError("A loss reason is required", 400, "loss_reason_required");
    const from = deal.stage;
    let overrideNote = "";
    if (!system && gated(p, from, to)) {
      const req = requirements(deal, Object.values(db.tasks));
      if (!req.done) {
        const here = stageDef(p, from).name;
        if (!input.force) throw new ApiError(`Finish the ${describe(req)} in ${here} first. The deal moves on by itself when they're done.`, 409, "stage_tasks_open");
        if (!input.overrideReason?.trim()) throw new ApiError("Give a reason for moving with open tasks.", 400, "override_reason_required");
        overrideNote = `Moved on from ${here} with ${describe(req)} still open (admin override). Reason: ${input.overrideReason.trim()}`;
      }
    }
    const sd = stageDef(p, to);
    const ownerId = ruleOn("r_owner") && sd.ownerId ? sd.ownerId : deal.ownerId;
    const h = hist(from, to);
    if (byLabel) h.byName = byLabel;
    Object.assign(deal, { stage: to, stageChangedAt: nowIso(), ownerId, history: [...deal.history, h] });
    if (input.lossReason) { deal.lossReason = input.lossReason; deal.lossCompetitor = input.lossCompetitor ?? ""; }
    if (input.nurtureReason) deal.nurtureReason = input.nurtureReason;
    if (input.reengageDate) deal.reengageDate = input.reengageDate;
    if (input.demoDate) deal.demoDate = input.demoDate;
    if (to === "s11" && ruleOn("r_signed")) {
      if (deal.payment.status === "Not invoiced") deal.payment = { ...deal.payment, status: "Invoiced", invoicedAt: today() };
      if (!deal.signedAt) deal.signedAt = today();
    }
    if (to === "s13" && !deal.liveAt) deal.liveAt = today();
    if (overrideNote) deal.activities = capActs([...deal.activities, act("note", overrideNote)]);
    if (input.note) deal.activities = capActs([...deal.activities, act("note", input.note)]);
    const { created, closed } = applyRules(deal, to, { demoDate: input.demoDate, reengageDate: input.reengageDate, lossReason: input.lossReason }, ownerId);
    return { deal, tasksCreated: created, tasksClosed: closed };
  }

  /** Everything for the current stage done → move to the next main stage. */
  function maybeAdvance(deal: Deal): DealMutationResult | null {
    const p = pipelineOf(deal.pipelineId);
    const target = nextStageOf(p, deal.stage);
    if (!target) return null;
    if (!requirements(deal, Object.values(db.tasks)).done) return null;
    const who = actor()?.name;
    const stageName = stageDef(p, deal.stage).name;
    return moveSync(deal, { to: target }, who ? `${who} (all ${stageName} tasks done)` : "All stage tasks done");
  }

  const api: PipelineApi = {
    listPipelines: () => run(() => Object.values(db.pipelines).map((p) => ({ ...p, dealCount: Object.values(db.deals).filter((d) => d.pipelineId === p.id).length }))),
    createPipeline: (name) => run(() => {
      let id = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || newId();
      if (db.pipelines[id]) id = `${id}-${newId().slice(-4)}`;
      const p = templatePipeline(id, name);
      db.pipelines[id] = p;
      return p;
    }),
    updatePipeline: (id, patch) => run(() => {
      const p = db.pipelines[id];
      if (!p) throw new ApiError("Pipeline not found", 404, "not_found");
      if (patch.name !== undefined) p.name = patch.name.trim() || p.name;
      if (patch.pilotEnabled !== undefined) p.pilotEnabled = patch.pilotEnabled;
      if (patch.stages) {
        const edits = new Map(patch.stages.map((e) => [e.key, e]));
        p.stages = rawStages(p).map((s) => {
          const e = edits.get(s.key);
          if (!e) return s;
          return {
            ...s,
            ...(e.name !== undefined ? { name: e.name.trim() || s.name } : {}),
            ...(e.limit !== undefined ? { limit: e.limit === null ? null : Math.max(0, Number(e.limit)) } : {}),
            ...(e.ownerId !== undefined ? { ownerId: e.ownerId } : {}),
            ...(e.description !== undefined ? { description: e.description } : {}),
            ...(e.phase !== undefined && !s.lane ? { phase: e.phase } : {}),
          };
        });
      }
      return p;
    }),
    addStage: (pipelineId, input) => run(() => {
      const p = db.pipelines[pipelineId];
      if (!p) throw new ApiError("Pipeline not found", 404, "not_found");
      const name = input.name.trim();
      if (!name) throw new ApiError("Give the stage a name.", 400, "name_required");
      const all = rawStages(p);
      if (all.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new ApiError(`There's already a stage called ${name}.`, 400, "duplicate_name");
      const main = all.filter((s) => s.key !== "nurture" && s.key !== "lost");
      const stage = { key: `c_${newId().slice(-8)}`, name, phase: input.phase, limit: input.limit, ownerId: input.ownerId, custom: true, description: input.description };
      const pos = input.after ? main.findIndex((s) => s.key === input.after) + 1 : 0;
      main.splice(pos, 0, stage);
      p.stages = [...main, ...all.filter((s) => s.key === "nurture" || s.key === "lost")];
      return { pipeline: p, stage };
    }),
    removeStage: (pipelineId, stageKey, moveTo) => run(() => {
      const p = db.pipelines[pipelineId];
      if (!p) throw new ApiError("Pipeline not found", 404, "not_found");
      if (stageKey === "nurture" || stageKey === "lost") throw new ApiError("Nurture and Lost can't be removed.", 400, "invalid_stage");
      const target = stagesOf(p).find((s) => s.key === stageKey) ?? rawStages(p).find((s) => s.key === stageKey);
      if (!target) throw new ApiError("Stage not found.", 404, "not_found");
      if (!target.optional && stagesOf(p).filter((s) => !s.lane && !s.optional).length <= 1) throw new ApiError("A pipeline needs at least one main stage.", 400, "last_stage");
      const inStage = Object.values(db.deals).filter((d) => d.pipelineId === pipelineId && d.stage === stageKey);
      if (inStage.length && (!moveTo || moveTo === stageKey || moveTo === "lost")) throw new ApiError("Choose where this stage's deals should go.", 400, "move_to_required");
      const who = actor()?.name;
      const lbl = who ? `${who} (stage '${target.name}' removed)` : `Stage '${target.name}' removed`;
      inStage.forEach((d) => moveSync(d, { to: moveTo, ...(moveTo === "nurture" ? { reengageDate: today() } : {}) }, lbl, true));
      Object.values(db.tasks).forEach((t) => { if (t.pipelineId === pipelineId && t.stage === stageKey && !t.done) Object.assign(t, { done: true, autoClosed: true, doneAt: nowIso() }); });
      Object.values(db.stageTasks ?? {}).forEach((t) => { if (t.pipelineId === pipelineId && t.stage === stageKey) delete db.stageTasks![t.id]; });
      p.stages = rawStages(p).filter((s) => s.key !== stageKey);
      if (stageKey === "pilot") p.pilotEnabled = false;
      return { pipeline: p, moved: inStage.length };
    }),

    listDeals: (pipelineId) => run(() => Object.values(db.deals).filter((d) => d.pipelineId === pipelineId)),
    createDeal: (input) => run(() => createDealSync(input)),
    updateDeal: (id, patch) => run(() => {
      const d = mustDeal(id);
      Object.assign(d, patch);
      if (patch.company) d.fit = fitScore(d.company);
      if (patch.payment?.status === "Paid" && !d.payment.paidAt) d.payment.paidAt = today();
      const cl = CHECKLISTS[d.stage];
      const advanced = cl && patch[cl.field] ? maybeAdvance(d) : null;
      return { deal: d, advanced };
    }),
    moveDeal: (id, input) => run(() => moveSync(mustDeal(id), input)),
    deleteDeal: (id) => run(() => {
      delete db.deals[id];
      Object.values(db.tasks).forEach((t) => { if (t.dealId === id) delete db.tasks[t.id]; });
    }),
    addActivity: (dealId, type, text) => run(() => {
      const d = mustDeal(dealId);
      d.activities = capActs([...d.activities, act(type, text)]);
      return d;
    }),
    createExpansion: (dealId) => run(() => {
      const d = mustDeal(dealId);
      return createDealSync({
        pipelineId: d.pipelineId, entryStage: resolveStage(pipelineOf(d.pipelineId), "s5"), company: clone(d.company), contact: clone(d.contact),
        source: "Existing client (expansion)", interest: "Warm", ownerId: d.ownerId,
        note: "Expansion deal: more locations, add-ons or another product",
      });
    }),

    listTasks: (pipelineId) => run(() => Object.values(db.tasks).filter((t) => t.pipelineId === pipelineId)),
    createTask: (input) => run(() => {
      const deal = input.dealId ? db.deals[input.dealId] : undefined;
      const t = makeTask({ ...input, stage: deal?.stage ?? null });
      db.tasks[t.id] = t;
      return t;
    }),
    updateTask: (id, patch) => run(() => {
      const t = db.tasks[id];
      if (!t) throw new ApiError("Task not found", 404, "not_found");
      Object.assign(t, patch);
      if (patch.done !== undefined) { t.doneAt = patch.done ? nowIso() : ""; t.autoClosed = false; }
      const deal = t.dealId ? db.deals[t.dealId] : undefined;
      const advanced = patch.done && deal && t.stage === deal.stage ? maybeAdvance(deal) : null;
      return { task: t, advanced };
    }),
    deleteTask: (id) => run(() => { delete db.tasks[id]; }),

    listStageTasks: (pipelineId) => run(() => Object.values(db.stageTasks ?? {}).filter((t) => t.pipelineId === pipelineId)),
    createStageTask: (input) => run(() => {
      const def = stagesOf(pipelineOf(input.pipelineId)).find((t) => t.key === input.stage);
      if (!def || def.lane) throw new ApiError("Stage tasks can only be added to the pipeline's main stages.", 400, "invalid_stage");
      if (!input.title.trim()) throw new ApiError("Write what needs doing first.", 400, "title_required");
      const template: StageTaskTemplate = { id: newId(), createdAt: nowIso(), ...input, title: input.title.trim() };
      db.stageTasks = { ...(db.stageTasks ?? {}), [template.id]: template };
      const tasksCreated = Object.values(db.deals)
        .filter((d) => d.pipelineId === input.pipelineId && d.stage === input.stage && d.ownerId === input.ownerId)
        .map((d) => {
          const task = makeTask({ dealId: d.id, pipelineId: d.pipelineId, title: template.title, ownerId: input.ownerId, due: addDays(input.dueInDays), auto: true, stage: input.stage, templateId: template.id });
          db.tasks[task.id] = task;
          return task;
        });
      return { template, tasksCreated };
    }),
    deleteStageTask: (id) => run(() => {
      if (!db.stageTasks?.[id]) throw new ApiError("Stage task not found.", 404, "not_found");
      delete db.stageTasks[id];
      const tasksRemoved = Object.values(db.tasks).filter((t) => t.templateId === id && !t.done).map((t) => t.id);
      tasksRemoved.forEach((tid) => { delete db.tasks[tid]; });
      return { tasksRemoved };
    }),

    getSettings: () => run(() => db.settings),
    updateSettings: (patch) => run(() => {
      db.settings = { ...db.settings, ...patch };
      return db.settings;
    }),

    importLeads: (pipelineId, rows) => run(() => importRows(pipelineId, rows)),
    loadSamples: (pipelineId) => run(() => ({ created: loadSamples(pipelineId) })),
    removeSamples: (pipelineId) => run(() => {
      const ids = new Set(Object.values(db.deals).filter((d) => d.pipelineId === pipelineId && d.sample).map((d) => d.id));
      Object.values(db.tasks).forEach((t) => { if (t.sample || (t.dealId && ids.has(t.dealId))) delete db.tasks[t.id]; });
      ids.forEach((id) => { delete db.deals[id]; });
      return { removed: ids.size };
    }),

    aiDraft: async (dealId, input, signal) => {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 700);
        signal?.addEventListener("abort", () => { clearTimeout(t); reject(new ApiError("Stopped.", 499, "cancelled")); });
      });
      const d = clone(mustDeal(dealId));
      return mockDraft(d, input);
    },
  };

  function importRows(pipelineId: string, rows: ImportRow[]): ImportResult {
    const p = pipelineOf(pipelineId);
    const existing = new Set(Object.values(db.deals).filter((d) => d.pipelineId === pipelineId).map((d) => d.company.name.toLowerCase()));
    const a = actor();
    let created = 0, skipped = 0;
    for (const r of rows) {
      if (existing.has(r.company.toLowerCase())) { skipped++; continue; }
      existing.add(r.company.toLowerCase());
      const stage = resolveStage(p, r.stage);
      const company = { ...EMPTY_COMPANY, name: r.company, region: r.region, segment: r.segment, platform: r.platform, reachable: !!(r.email || r.linkedin) };
      const at = r.last ? new Date(`${r.last}T12:00:00`).toISOString() : nowIso();
      const ownerId = db.settings.team.find((m) => m.name.toLowerCase() === r.owner.toLowerCase())?.id ?? stageDef(p, stage).ownerId;
      const fit = r.fit !== "" && !Number.isNaN(parseFloat(r.fit)) ? parseFloat(r.fit) : fitScore(company);
      const deal = newDeal({
        pipelineId, stage, company, contact: { name: r.contact, title: r.title, email: r.email, linkedin: r.linkedin, phone: "", decisionMaker: false },
        source: r.source, ownerId, fit, stageChangedAt: at, createdAt: at,
        history: [{ from: null, to: stage, at, byId: a?.id ?? null, byName: a ? `${a.name} (import)` : "Lead Tracker import" }],
        activities: [...(r.notes ? [act("note", r.notes)] : []), act("note", "Imported from the Lead Tracker")],
        snapshotSent: r.snap, demoDate: r.demo ? `${r.demo}T09:00` : "",
        payment: { status: r.paid ? "Paid" : stageIndex(p, stage) >= stageIndex(p, resolveStage(p, "s11")) ? "Invoiced" : "Not invoiced" },
        lossReason: stage === "lost" ? "Other" : "", reengageDate: stage === "nurture" ? r.nextDate || addDays(60) : "",
      });
      db.deals[deal.id] = deal;
      if (r.next) { const t = makeTask({ dealId: deal.id, pipelineId, title: r.next, ownerId, due: r.nextDate, stage }); db.tasks[t.id] = t; }
      if (r.fu) { const t = makeTask({ dealId: deal.id, pipelineId, title: "Follow-up call or meeting", ownerId, due: r.fu, stage }); db.tasks[t.id] = t; }
      created++;
    }
    return { created, skipped };
  }

  function loadSamples(pipelineId: string): number {
    const p = pipelineOf(pipelineId);
    // The pipeline may not have every built-in stage: map each sample onto the stages that exist
    const route: StageKey[] = stagesOf(p).filter((s) => !s.lane && !s.optional).map((s) => s.key);
    let n = 0;
    for (const s of SAMPLE_DEALS) {
      const [name, contact, title, rawStage, daysAgo, source, platform, segment, interest, p5, sellsOut] = s;
      const lane = rawStage === "nurture" || rawStage === "lost";
      const stage = lane ? rawStage : resolveStage(p, rawStage);
      const company = { ...EMPTY_COMPANY, name, segment, platform, products5: p5, sellsOut, reachable: true };
      const at = new Date(Date.now() - daysAgo * DAY).toISOString();
      let entry = entryForSourceIn(p, source);
      if (!route.includes(entry)) entry = route[0] ?? stage;
      let target: StageKey = lane ? resolveStage(p, "s4") : stage;
      if (!route.includes(target)) target = entry;
      const steps = route.indexOf(target) > route.indexOf(entry) ? route.slice(route.indexOf(entry) + 1, route.indexOf(target) + 1) : [];
      const total = steps.length + (lane ? 1 : 0);
      const ago = (k: number) => new Date(Date.now() - k * DAY - 3_600_000).toISOString();
      const history: HistoryEntry[] = [{ from: null, to: entry, at: total ? ago(daysAgo + total * 2 + 1) : at, byId: null, byName: "Sample" }];
      let prev: StageKey = entry;
      steps.forEach((k, i) => { history.push({ from: prev, to: k, at: i === total - 1 ? at : ago(daysAgo + (total - i - 1) * 2), byId: null, byName: "Sample" }); prev = k; });
      if (lane) history.push({ from: prev, to: stage, at, byId: null, byName: "Sample" });
      const createdAt = history[0]?.at ?? at;
      const deal = newDeal({
        pipelineId, sample: true, company, contact: { name: contact, title, email: "", phone: "", linkedin: "", decisionMaker: title === "Owner" },
        source, interest, ownerId: stageDef(p, stage).ownerId, fit: fitScore(company), stage, stageChangedAt: at, createdAt, history,
        activities: [{ id: newId(), type: "note", text: "Sample deal for trying the pipeline. Not a real operator.", at: createdAt, byId: null, byName: "Sample" }],
        snapshotSent: stageIndex(p, stage) >= stageIndex(p, resolveStage(p, "s7")) && stageIndex(p, stage) >= 0, demoDate: stage === "s6" ? `${addDays(2)}T10:00` : "",
        payment: { status: stage === "s13" ? "Paid" : stage === "s12" ? "Invoiced" : "Not invoiced" },
        qual: stage === "s8" ? { volume: true, dm: true } : {},
        lossReason: stage === "lost" ? "Wrong platform" : "", nurtureReason: stage === "nurture" ? "Unsupported platform" : "",
        reengageDate: stage === "nurture" ? addDays(40) : "",
      });
      db.deals[deal.id] = deal;
      for (const t of ruleTasks(stage, db.settings, { demoDate: deal.demoDate, lossReason: deal.lossReason, reengageDate: deal.reengageDate })) {
        const due = t.due ? addDays(dayDiff(t.due, today()) - daysAgo) : "";
        const task = makeTask({ dealId: deal.id, pipelineId, title: t.title, ownerId: deal.ownerId, due, auto: true, rule: t.rule, stage, createdAt: at, sample: true, blocking: t.blocking });
        db.tasks[task.id] = task;
      }
      n++;
    }
    return n;
  }

  return api;
}

type SampleRow = [string, string, string, StageKey, number, string, string, string, Deal["interest"], boolean, boolean];
const SAMPLE_DEALS: SampleRow[] = [
  ["Coral Coast Snorkel", "Maya Chen", "Owner", "s1", 1, "Outbound list", "FareHarbor", "Water / boat", "Warm", true, true],
  ["Bayfront Kayak Co", "Luis Ortega", "General manager", "s2", 3, "Outbound list", "Peek Pro", "Water / boat", "", true, false],
  ["Lakeside Pontoon Rentals", "Erin Walsh", "Owner", "s3", 1, "Arival report / newsletter", "FareHarbor", "Water / boat", "Warm", false, true],
  ["Harbor Lights Cruises", "Sam Patel", "Revenue manager", "s4", 6, "Pre-show outreach", "FareHarbor", "Water / boat", "Cold", true, true],
  ["Reef and Ride Adventures", "Kai Nakamura", "Owner", "s5", 0, "Arival booth", "FareHarbor", "Water / boat", "Hot", true, true],
  ["Sunset Sail Collective", "Priya Nair", "Marketing lead", "s6", 2, "Inbound (website, video)", "FareHarbor", "Water / boat", "Hot", true, true],
  ["Blue Fin Charters", "Tom Reyes", "Owner", "s7", 2, "Arival booth", "FareHarbor", "Water / boat", "Warm", true, true],
  ["Island Hop Ferries", "Grace Liu", "Operations lead", "s8", 1, "Partner referral", "Peek Pro", "Water / boat", "Warm", true, false],
  ["Dolphin Watch Tours", "Ben Carter", "General manager", "s9", 4, "Arival booth", "FareHarbor", "Water / boat", "Hot", true, true],
  ["Glass Bottom Boat Co", "Nora Hale", "Owner", "s10", 5, "Client referral", "FareHarbor", "Water / boat", "Hot", true, true],
  ["Paddle North", "Jonas Berg", "Owner", "s12", 8, "Arival booth", "FareHarbor", "Water / boat", "Warm", true, true],
  ["Whale Tail Excursions", "Ana Silva", "Revenue manager", "s13", 20, "Spark booth", "FareHarbor", "Water / boat", "Warm", true, true],
  ["Canyon Jeep Tours", "Rob Miles", "Owner", "nurture", 10, "Outbound list", "Xola", "Adventure", "Cold", false, true],
  ["River Rapids Outfitters", "Dee Brooks", "Owner", "lost", 12, "Pre-show outreach", "Other / unknown", "Adventure", "Cold", false, false],
];

/** Placeholder drafts so the AI tab can be exercised without the backend. */
function mockDraft(d: Deal, input: AiDraftInput): AiDraftResult {
  const co = d.company.name || "the operator";
  const who = d.contact.name?.split(" ")[0] || "there";
  const note = "\n\n(Mock draft: connect the Django AI endpoint for real Claude output.)";
  switch (input.action) {
    case "brief":
      return { text: `What they sell\n${co}: ${d.company.segment || "segment unknown"} (guess).\n\nBooking platform\n${d.company.platform || "Unknown"}. Check before contacting.\n\nSuggested angle for the first message\nOffer a free Pricing Snapshot on one of their busiest tours.${note}` };
    case "first":
      return { text: `Subject: A free look at your pricing\n\nHi ${who},\n\nWe build dynamic pricing for tour operators. I'd like to run a free Pricing Snapshot on one of ${co}'s tours to show what the current prices may be leaving on the table. You keep control of every price.\n\nWorth a look? [booking link]\n\nReply 'no thanks' and I won't write again.${note}` };
    case "follow":
      return { text: `Subject: Quick follow-up\n\nHi ${who}, following up on the Pricing Snapshot for ${co}. Here's the calendar link again: [booking link]${note}` };
    case "tag": {
      const t = (input.pasted ?? "").toLowerCase();
      const tag = /unsubscribe|remove me|stop/.test(t) ? "unsubscribe" : /not now|later|next year/.test(t) ? "not_now" : /wrong person|not me|colleague/.test(t) ? "wrong_person" : /\bno\b|not interested/.test(t) ? "no" : "interested";
      return { tag, text: `Tag: ${tag}\nSummary: ${input.pasted?.slice(0, 120) ?? ""}\n\nSuggested reply:\nThanks ${who}! Here's a link to pick a time: [booking link]${note}` };
    }
    case "summary":
      return { text: `Needs\n- Not mentioned\n\nObjections\n- Not mentioned\n\nNext step: Not agreed\n\nFollow-up email draft\nThanks for the time today, ${who}.${note}` };
    case "next":
      return { text: `Do: confirm the next step with ${who} and put a date on it.\nWhy: every deal needs a dated next step.\nBy: ${addDays(2)}${note}` };
  }
}
