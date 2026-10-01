/**
 * Browser-only implementation of PipelineApi. Stores everything in localStorage
 * and runs the same automation the Django backend will run. Use it for UI work
 * and demos; switch to createDrfApi() when the backend is up.
 */
import {
  BOOTH_FOLLOWUP_DEFAULTS, BOOTH_SOURCES, CALL_TYPES, categoryFromText, isCompetitor, CATEGORY_TEMPLATE, CHECKLISTS, VISITOR_CATEGORY, DEFAULT_SETTINGS, isTrack, OFFERS, PARTNER_VISITORS, PLATFORM_FOR_BOOKING,
  TIER_INTEREST, VISITOR_TYPES,
} from "../config/template";
import { boothEntry, defaultOffer, followupKey } from "../lib/booth";
import { cleanAnswers, scoreBooth } from "../lib/scoring";
import { addDays, DAY, dayDiff, nowIso, today } from "../lib/dates";
import {
  defaultStageList, EMPTY_COMPANY, entryForSourceIn, fitScore, mainKeys, newId, nextStageOf, rawStages, resolveStage,
  stageDef, stageIndex, stageLabel, stagesOf,
} from "../lib/pipeline";
import { ruleTasks, type RuleExtra } from "../lib/rules";
import { describe, gated, requirements } from "../lib/gating";
import type {
  Activity, ActivityType, AiDraftInput, AiDraftResult, BoothInfo, CreateBoothLeadInput, CreateDealInput, CreateTaskInput, PipelineTemplate, Touchpoint, TouchpointKind, CurrentUser, Deal,
  DealMutationResult, DealPatch, HistoryEntry, ImportResult, ImportRow, MoveDealInput, Pipeline,
  PipelineSettings, StageKey, StageTaskTemplate, Task, TaskPatch, DuplicateMatch,
} from "../types";
import { ApiError, type PipelineApi } from "./types";

interface MockDb {
  pipelines: Record<string, Pipeline>;
  deals: Record<string, Deal>;
  tasks: Record<string, Task>;
  settings: PipelineSettings;
  stageTasks?: Record<string, StageTaskTemplate>;
  /** Data version: 2 = pipelines have the "Offer sent" stage */
  v?: number;
}

export interface MockApiOptions {
  storageKey?: string;
  /** Simulated network latency in ms. */
  latency?: number;
  getActor?: () => CurrentUser | null;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function templatePipeline(id: string, name: string, template: PipelineTemplate = "touriq"): Pipeline {
  return { id, name, template, pilotEnabled: template === "touriq", stages: defaultStageList(template), createdAt: nowIso() };
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
    if ((base.v ?? 1) < 2) {
      Object.values(base.pipelines).forEach((p) => {
        const list = rawStages(p);
        if (list.some((s) => s.key === "offer")) return;
        const offer = defaultStageList().find((s) => s.key === "offer");
        const i = list.findIndex((s) => s.key === "s5");
        if (offer) list.splice(i >= 0 ? i + 1 : list.findIndex((s) => s.key === "s6"), 0, offer);
        p.stages = list;
      });
      base.v = 2;
    }
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
      lossReason: "", lossCompetitor: "", nurtureReason: "", reengageDate: "", qual: {}, pilotChecks: {}, onboarding: {},
      metById: "", booth: null, track: "", touchpoints: [], callType: "", accountManagerId: "", links: [], commissionPct: null, commissionInPct: null,
      meetingUrl: "", onCalendar: false, event: "", ...p,
    };
  }

  /** Add a journey step; once = skip when the deal already has one of that kind. */
  function addStep(deal: Deal, kind: TouchpointKind, source: Touchpoint["source"], extra: Partial<Touchpoint> = {}, once = false) {
    const list = deal.touchpoints ?? [];
    if (once && list.some((t) => t.kind === kind)) return;
    deal.touchpoints = [...list, { id: newId(), kind, source, at: nowIso(), score: "", link: "", detail: "", byName: actor()?.name ?? "", ...extra }];
  }

  function createDealSync(input: CreateDealInput): DealMutationResult {
    const entry = input.entryStage;
    const deal = newDeal({
      pipelineId: input.pipelineId, stage: entry, company: input.company, contact: input.contact, source: input.source,
      interest: input.interest, ownerId: input.ownerId, fit: fitScore(input.company), history: [hist(null, entry)], event: input.event?.trim() ?? "",
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

  /** Mirror of backend services/booth.py create_booth_lead. */
  function createBoothSync(input: CreateBoothLeadInput): DealMutationResult {
    const existing = input.clientId ? Object.values(db.deals).find((d) => d.booth?.clientId === input.clientId) : undefined;
    if (existing) return { deal: existing, tasksCreated: [], tasksClosed: [] };
    const name = input.company.trim();
    if (!name) throw new ApiError("Add the company name to save.", 400, "company_required");
    const p = pipelineOf(input.pipelineId);
    if (!p) throw new ApiError("Pipeline not found", 404, "not_found");
    const v = input.visitor;
    const answers = v === "operator" ? cleanAnswers(input.answers) : {};
    const sc = scoreBooth(v, answers);
    const offer = (v === "operator" && input.offer) || defaultOffer(v, sc.tier, input.gamePlayed);
    const partner = PARTNER_VISITORS.includes(v);
    const entry = boothEntry(p, v, offer, input.source);
    const lane = entry === "lost" || entry === "nurture" ? entry : null;
    const role = answers.role ?? "";
    const ownerId = input.followupOwnerId || stageDef(p, entry).ownerId;
    const company = {
      ...EMPTY_COMPANY, name, region: input.destination.trim(), platform: PLATFORM_FOR_BOOKING[answers.booking ?? ""] ?? "",
      sellsOut: answers.sellouts === "often", reachable: role === "decider", category: VISITOR_CATEGORY[v],
    };
    const metAt = input.metAt || nowIso().slice(0, 16);
    const booth: BoothInfo = {
      clientId: input.clientId, visitor: v, answers, offer, gamePlayed: input.gamePlayed, gameScore: input.gameScore.trim(), metAt,
      destination: input.destination.trim(), runs: input.runs.trim(), pricingTool: input.pricingTool.trim(), ...sc,
    };
    const metName = db.settings.team.find((m) => m.id === input.metById)?.name ?? actor()?.name ?? "";
    const summary = [
      `Booth lead (${input.source || "booth"})${metName ? `, met by ${metName}` : ""} on ${metAt.replace("T", " ")}.`,
      `Visitor: ${VISITOR_TYPES.find((x) => x[0] === v)?.[1] ?? v}.`,
      sc.tier ? `Tier ${sc.tier} (${sc.points} points${sc.capped ? `, capped from ${sc.tierBeforeCap}` : ""}${sc.complete ? "" : ", some questions unanswered"}).` : "",
      offer ? `Offer: ${OFFERS.find((o) => o[0] === offer)?.[1]}.` : "",
      input.gamePlayed ? `Played the game${input.gameScore ? `, score ${input.gameScore}` : ""}.` : "",
      input.destination ? `Destination: ${input.destination}.` : "", input.runs ? `Runs: ${input.runs}.` : "", input.pricingTool ? `Pricing tool: ${input.pricingTool}.` : "",
    ].filter(Boolean).join(" ");
    const deal = newDeal({
      pipelineId: p.id, stage: entry, company, source: input.source || "Arival booth", event: input.event?.trim() ?? "", ownerId, fit: fitScore(company),
      contact: { name: input.contact.name.trim(), email: input.contact.email.trim(), phone: input.contact.phone.trim(), title: { decider: "Owner / GM", manager: "Manager", staff: "Staff" }[role] ?? "", linkedin: "", decisionMaker: role === "decider" },
      interest: v === "operator" && sc.tier ? TIER_INTEREST[sc.tier] : "", history: [hist(null, entry)],
      activities: [act("meeting", summary), ...(input.note.trim() ? [act("note", input.note.trim())] : [])],
      demoDate: offer === "demo_booked" ? input.bookedAt : "", metById: input.metById || actor()?.id || "", booth,
      locations: { "3_plus": "3+", "2": "2", "1": "1" }[answers.locations ?? ""] ?? "",
      lossReason: lane === "lost" ? "Not a prospect" : "", nurtureReason: lane === "nurture" ? (v === "press" ? "Press hand-off" : "Partner hand-off") : "",
      reengageDate: lane === "nurture" ? addDays(60) : "",
    });
    db.deals[deal.id] = deal;
    const key = followupKey(v, sc.tier);
    const days = key ? (db.settings.boothFollowup ?? BOOTH_FOLLOWUP_DEFAULTS)[key]?.days ?? 2 : 0;
    if (entry === "offer" && isTrack(offer)) deal.track = offer;
    const { created } = applyRules(deal, entry, {
      demoDate: deal.demoDate, booth: true, lossReason: deal.lossReason, reengageDate: deal.reengageDate,
      offer: deal.track, offerDue: input.followupDue || addDays(days), gamePlayed: offer === "game" ? input.gamePlayed : undefined,
    }, ownerId);
    if (input.gamePlayed) addStep(deal, "game_played", "booth", { score: input.gameScore.trim() });
    const notices: string[] = [];
    if (offer === "analysis") {
      const web = (input.website ?? "").trim();
      deal.booth = { ...booth, analysis: { website: web, status: "requested" } };
      if (web && !deal.company.website) deal.company.website = web;
      addStep(deal, "analysis_requested", "booth", { link: web, detail: web });
      deal.activities.push(act("note", `Draft email (not sent yet: goes out with the report once the analysis tool is connected)\n\nSubject: Your comparative analysis: ${name}\n\nView the report: [report link]`));
      notices.push("Comparative analysis requested. The report email is drafted on the deal.");
    }
    if (offer === "game" && !input.gamePlayed) notices.push("Mock mode: the game link email is only sent by the server.");
    if (offer === "demo_booked") addStep(deal, "demo_booked", "booth", { detail: deal.demoDate.replace("T", " ") });
    else if (offer === "demo_given") addStep(deal, "demo_held", "booth", { detail: "Demo given at the booth" });
    if (key && input.followupOwnerId && entry !== "offer") {
      const who = deal.contact.name || name;
      const tag = `booth, tier ${sc.tier}`;
      const title = partner ? `Hand ${who} to the partnerships team` : v === "press" ? `Follow up with ${who} (press / Arival)` : ({
        demo_booked: `Send the demo invite and deck to ${who} (${tag})`, audit: `Send the audit form to ${who} (${tag})`,
        analysis: `Run the comparative analysis and send it to ${who} (${tag})`, game: `Send ${who} their game result and the demo link (${tag})`,
      } as Record<string, string>)[offer] ?? `Follow up with ${who} (${tag})`;
      const t = makeTask({ dealId: deal.id, pipelineId: p.id, title, ownerId: input.followupOwnerId, due: input.followupDue || addDays(days), auto: true, rule: "r_capture48", stage: entry });
      db.tasks[t.id] = t;
      created.push(t);
    }
    return { deal, tasksCreated: created, tasksClosed: [], notices };
  }

  /** Mirror of backend deals.mark_competitor: never contacted. */
  function markCompetitor(d: Deal) {
    Object.values(db.tasks).forEach((t) => { if (t.dealId === d.id && !t.done) Object.assign(t, { done: true, autoClosed: true, doneAt: nowIso() }); });
    if (d.stage !== "lost") moveSync(d, { to: "lost", lossReason: "Not a prospect" }, "Competitor: do not contact", true);
  }

  /** Mirror of backend deals.transfer_deal. */
  function transferSync(deal: Deal, target: Pipeline): DealMutationResult {
    if (isCompetitor(deal)) throw new ApiError("This company is a competitor: do not contact.", 409, "competitor");
    if (deal.pipelineId === target.id) throw new ApiError("The deal is already in that pipeline.", 400, "same_pipeline");
    const to = stagesOf(target).find((s) => !s.lane && !s.optional)?.key;
    if (!to) throw new ApiError("Choose a stage in that pipeline.", 400, "invalid_stage");
    const fromName = pipelineOf(deal.pipelineId)?.name ?? "another";
    const closed: string[] = [];
    Object.values(db.tasks).forEach((t) => {
      if (t.dealId !== deal.id) return;
      if (!t.done && t.auto) { Object.assign(t, { done: true, autoClosed: true, doneAt: nowIso() }); closed.push(t.id); }
      t.pipelineId = target.id;
    });
    const sd = stageDef(target, to);
    const ownerId = ruleOn("r_owner") && sd.ownerId ? sd.ownerId : deal.ownerId;
    const h = hist(deal.stage, to);
    h.byName = h.byName ? `${h.byName} (moved from ${fromName})` : `Moved from ${fromName}`;
    Object.assign(deal, { pipelineId: target.id, stage: to, stageChangedAt: nowIso(), ownerId, track: "", callType: "", history: [...deal.history, h] });
    deal.activities = capActs([...deal.activities, act("note", `Moved from the ${fromName} pipeline to ${target.name}.`)]);
    const { created } = applyRules(deal, to, {}, ownerId);
    return { deal, tasksCreated: created, tasksClosed: closed };
  }

  function moveSync(deal: Deal, input: MoveDealInput, byLabel?: string, system = false): DealMutationResult {
    const to = input.to;
    if (deal.stage === to) return { deal, tasksCreated: [], tasksClosed: [] };
    const p = pipelineOf(deal.pipelineId);
    if (!stagesOf(p).some((s) => s.key === to)) throw new ApiError("That stage isn't used in this pipeline.", 400, "invalid_stage");
    if (to === "lost" && !input.lossReason) throw new ApiError("A loss reason is required", 400, "loss_reason_required");
    if (to !== "lost" && to !== "nurture" && isCompetitor(deal)) throw new ApiError("This company is a competitor: do not contact. It stays in Lost.", 409, "competitor");
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
    if (to === "offer" && input.track) deal.track = input.track;
    if (to === "s9" && input.callType) deal.callType = input.callType;
    if (to === "s6") addStep(deal, "demo_booked", "pipeline", { detail: deal.demoDate.replace("T", " ") }, true);
    if (to === "s7") addStep(deal, "demo_held", "pipeline", {}, true);
    if (overrideNote) deal.activities = capActs([...deal.activities, act("note", overrideNote)]);
    if (input.note) deal.activities = capActs([...deal.activities, act("note", input.note)]);
    const { created, closed } = applyRules(deal, to, {
      demoDate: input.demoDate, reengageDate: input.reengageDate, lossReason: input.lossReason, offer: to === "offer" ? deal.track : "",
      callType: to === "s9" ? deal.callType : "",
    }, ownerId);
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
    importHandoffs: (pipelineId) => run(() => {
      const target = pipelineOf(pipelineId);
      if (!target) throw new ApiError("Pipeline not found", 404, "not_found");
      const cats = Object.entries(CATEGORY_TEMPLATE).filter(([, t]) => t === target.template).map(([c]) => c);
      if (!cats.length) throw new ApiError("Only a Partnerships or Referrals pipeline takes partner hand-offs.", 400, "invalid_template");
      const list = Object.values(db.deals).filter((d) => d.pipelineId !== pipelineId && d.stage === "nurture" && d.nurtureReason === "Partner hand-off" && cats.includes(d.company.category ?? ""));
      list.forEach((d) => transferSync(d, target));
      return { moved: list.length };
    }),
    createPipeline: (name, template = "touriq") => run(() => {
      let id = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || newId();
      if (db.pipelines[id]) id = `${id}-${newId().slice(-4)}`;
      const p = templatePipeline(id, name, template);
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
    createBoothLead: (input) => run(() => createBoothSync(input)),
    updateDeal: (id, patch) => run(() => {
      const d = mustDeal(id);
      const { booth: boothPatch, ...rest } = patch;
      Object.assign(d, rest);
      if (boothPatch) {
        if (!d.booth) throw new ApiError("This deal wasn't captured with the booth form.", 400, "not_booth");
        const b = { ...d.booth, ...boothPatch, answers: cleanAnswers(boothPatch.answers ?? d.booth.answers) };
        d.booth = { ...b, ...scoreBooth(b.visitor, b.answers) };
      }
      if (patch.company) d.fit = fitScore(d.company);
      if (isCompetitor(d)) markCompetitor(d);
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
    addTouchpoint: (dealId, input) => run(() => {
      const d = mustDeal(dealId);
      addStep(d, input.kind, "manual", { score: input.score ?? "", link: input.link ?? "", detail: input.detail ?? "" });
      return d;
    }),
    addActivity: (dealId, type, text, attendeeIds = []) => run(() => {
      const d = mustDeal(dealId);
      d.activities = capActs([...d.activities, { ...act(type, text), attendeeIds: type === "call" || type === "meeting" ? [...new Set(attendeeIds)] : [] }]);
      return d;
    }),
    updateActivity: (activityId, patch) => run(() => {
      const d = Object.values(db.deals).find((x) => x.activities.some((a) => a.id === activityId));
      if (!d) throw new ApiError("Entry not found.", 404, "not_found");
      d.activities = d.activities.map((a) => (a.id === activityId ? { ...a, attendeeIds: [...new Set(patch.attendeeIds)] } : a));
      return d;
    }),
    setCallType: (dealId, callType) => run(() => {
      const d = mustDeal(dealId);
      if (d.stage !== "s9") throw new ApiError("The next call is set while the deal is in the second-call stage.", 400, "invalid_stage");
      if (d.callType === callType) return { deal: d, tasksCreated: [], tasksClosed: [] };
      const before = d.callType;
      d.callType = callType;
      const closed: string[] = [];
      Object.values(db.tasks).forEach((t) => {
        if (t.dealId === d.id && t.stage === "s9" && t.rule === "r_second" && !t.done) { Object.assign(t, { done: true, autoClosed: true, doneAt: nowIso() }); closed.push(t.id); }
      });
      const created = ruleTasks("s9", db.settings, { callType }).map((t) =>
        makeTask({ dealId: d.id, pipelineId: d.pipelineId, title: t.title, ownerId: d.ownerId, due: t.due, auto: true, rule: t.rule, stage: "s9", blocking: t.blocking }));
      created.forEach((t) => { db.tasks[t.id] = t; });
      const name = (k: string) => CALL_TYPES.find((c) => c[0] === k)?.[1] ?? k;
      d.activities = capActs([...d.activities, act("note", `Next call: ${name(callType)}${before ? ` (was ${name(before)}).` : "."}`)]);
      return { deal: d, tasksCreated: created, tasksClosed: closed };
    }),
    transferDeal: (dealId, pipelineId) => run(() => {
      const target = pipelineOf(pipelineId);
      if (!target) throw new ApiError("Pipeline not found", 404, "not_found");
      return transferSync(mustDeal(dealId), target);
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

    findDuplicates: ({ company = "", email = "", website = "" }) => run(() => {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ")
        .filter((w) => w && !["llc", "inc", "ltd", "limited", "co", "company", "the"].includes(w)).join(" ");
      const host = (u: string) => u.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
      const e = email.trim().toLowerCase(), n = norm(company), h = host(website.trim());
      const out: DuplicateMatch[] = [];
      for (const d of Object.values(db.deals)) {
        if (d.sample) continue;
        const match = e && d.contact.email.toLowerCase() === e ? "email"
          : h && d.company.website && host(d.company.website) === h ? "website"
            : n && norm(d.company.name) === n ? "company" : null;
        if (!match) continue;
        const p = db.pipelines[d.pipelineId];
        out.push({ dealId: d.id, pipelineId: d.pipelineId, pipelineName: p?.name ?? "", company: d.company.name,
          contactName: d.contact.name, stage: d.stage, stageName: p ? stageLabel(p, d.stage) : d.stage, ownerId: d.ownerId, match });
      }
      return out.slice(0, 5);
    }),
    getSettings: () => run(() => db.settings),
    updateSettings: (patch) => run(() => {
      const eventCosts = patch.eventCosts
        ? Object.fromEntries(Object.entries({ ...db.settings.eventCosts, ...patch.eventCosts }).filter(([, v]) => v != null))
        : db.settings.eventCosts;
      db.settings = { ...db.settings, ...patch, eventCosts };
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
      const category = categoryFromText(r.category ?? "");
      const competitor = category === "competitor";
      const stage = competitor ? "lost" : resolveStage(p, r.stage);
      const company = { ...EMPTY_COMPANY, name: r.company, region: r.region, segment: r.segment, platform: r.platform, reachable: !!(r.email || r.linkedin), category };
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
        lossReason: stage === "lost" ? (competitor ? "Not a prospect" : "Other") : "", reengageDate: stage === "nurture" ? r.nextDate || addDays(60) : "",
      });
      db.deals[deal.id] = deal;
      if (competitor) { deal.activities.push(act("note", "Competitor: do not contact.")); created++; continue; }
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
  const partner = ["booking_platform", "ota", "revenue_manager", "agency"].includes(d.company.category ?? "");
  if (partner && (input.action === "first" || input.action === "follow" || input.action === "brief")) {
    const goal = d.company.category === "ota" ? "a channel so operators' dynamic prices reach your listings"
      : d.company.category === "booking_platform" ? "an integration so any of your operators is one click from dynamic pricing, starting with one pilot client"
        : "a referral partnership with a commission on every client";
    return { text: `Subject: TourIQ and ${co}\n\nHi ${who},\n\nWe build dynamic pricing for tour operators. I'd like 20 minutes to talk about ${goal}.\n\nDoes a call work? [booking link]${note}` };
  }
  switch (input.action) {
    case "brief":
      return { text: `What they sell\n${co}: ${d.company.segment || "segment unknown"} (guess).\n\nBooking platform\n${d.company.platform || "Unknown"}. Check before contacting.\n\nSuggested angle for the first message\nOffer a free Pricing Snapshot on one of their busiest tours.${note}` };
    case "first":
      return { text: `Subject: A free look at your pricing\n\nHi ${who},\n\nWe build dynamic pricing for tour operators. I'd like to run a free Pricing Snapshot on one of ${co}'s tours to show what the current prices may be leaving on the table. You keep control of every price.\n\nWorth a look? [booking link]\n\nReply 'no thanks' and I won't write again.${note}` };
    case "invite":
      return { text: `Subject: Your TourIQ demo\n\nHi ${who},\n\nLooking forward to showing you dynamic pricing on ${co}'s own tours on [date and time]. If your revenue or operations lead can join, even better. Here's the deck to look at before: [demo deck]\n\nNeed another time? [booking link]${note}` };
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
