/**
 * Django REST Framework implementation of PipelineApi.
 *
 * Auth: per-tenant SimpleJWT. The host app owns login and refresh; it hands this
 * adapter a function that returns the current access token. Tenant isolation is
 * enforced by Postgres RLS on the server; the tenant is resolved from the JWT
 * (and optionally an X-Tenant header when the host uses one).
 *
 * Wire format is snake_case; this adapter converts to and from camelCase.
 * Endpoint contract: see docs/API_CONTRACT.md.
 */
import type { PipelineApi } from "./types";
import { ApiError } from "./types";

export interface DrfApiOptions {
  /** e.g. "/api/sales-pipeline" or "https://tenant.example.com/api/sales-pipeline" */
  baseUrl: string;
  getAccessToken: () => string | null | Promise<string | null>;
  /** Called on 401 so the host can refresh the token or send the user to login. Return true to retry once. */
  onUnauthorized?: () => boolean | Promise<boolean>;
  tenantHeader?: { name: string; value: string };
  fetchImpl?: typeof fetch;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (s: string) => s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

/** Keys whose object values are maps keyed by data (stage keys, rule keys, checklist keys), not field names. */
const OPAQUE_KEYS = new Set([
  "stages", "rules", "targets", "qual", "pilotChecks", "onboarding", "pilot_checks", "answers", "boothFollowup", "booth_followup", "eventCosts", "event_costs",
  // Outreach maps keyed by step / check / research field / channel
  "steps", "verify", "research", "replyChecked", "reply_checked",
]);

function convertKeys(v: unknown, fn: (s: string) => string, opaque = false): unknown {
  if (Array.isArray(v)) return v.map((x) => convertKeys(x, fn));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const nk = opaque ? k : fn(k);
      // Inside an opaque map, keep the keys but still convert the nested objects' fields.
      out[nk] = OPAQUE_KEYS.has(k) || OPAQUE_KEYS.has(nk)
        ? convertKeys(val, fn, true)
        : convertKeys(val, fn);
    }
    return out;
  }
  return v;
}
const snake = (v: unknown) => convertKeys(v, toSnake) as Json;
const camel = <T,>(v: unknown) => convertKeys(v, toCamel) as T;

export function createDrfApi(opts: DrfApiOptions): PipelineApi {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");

  async function req<T>(method: string, path: string, body?: unknown, signal?: AbortSignal, retried = false): Promise<T> {
    const token = await opts.getAccessToken();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.tenantHeader) headers[opts.tenantHeader.name] = opts.tenantHeader.value;
    let res: Response;
    try {
      res = await f(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(snake(body)), signal });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new ApiError("Stopped.", 499, "cancelled");
      throw new ApiError("Network error. Check your connection.", 0, "network");
    }
    const refresh = opts.onUnauthorized;
    // A failed refresh (e.g. offline) counts as "not refreshed", not an unwrapped error
    if (res.status === 401 && !retried && refresh && (await Promise.resolve().then(refresh).catch(() => false))) {
      return req<T>(method, path, body, signal, true);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    // Error pages from Django (unrouted URL, crash) or a proxy (502/504) are HTML, not JSON
    let data: unknown = null;
    let parsed = !text;
    if (text) {
      try { data = JSON.parse(text); parsed = true; } catch { /* keep null */ }
    }
    if (!res.ok) {
      const d = (data ?? {}) as { detail?: string; code?: string };
      const fallback = res.status >= 500 ? "The server had a problem. Try again in a moment." : `Request failed (${res.status}).`;
      throw new ApiError(d.detail ?? fallback, res.status, d.code ?? (res.status === 403 ? "forbidden" : "error"), data);
    }
    if (!parsed) throw new ApiError("The server sent an unexpected reply. Try again in a moment.", res.status, "bad_response");
    return camel<T>(data);
  }

  /**
   * List endpoints return plain arrays, or pages ({results, nextOffset}) for deals and tasks:
   * follow the pages until the last one.
   */
  async function list<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let offset: number | null = 0;
    for (let guard = 0; offset != null && guard < 200; guard++) {
      const sep = path.includes("?") ? "&" : "?";
      const data: T[] | { results: T[]; nextOffset?: number | null } = await req("GET", offset ? `${path}${sep}offset=${offset}` : path);
      if (Array.isArray(data)) return data;
      out.push(...data.results);
      offset = data.nextOffset ?? null;
    }
    return out;
  }

  const q = encodeURIComponent;
  return {
    listPipelines: () => list("/pipelines/"),
    createPipeline: (name, template = "touriq") => req("POST", "/pipelines/", { name, template }),
    importHandoffs: (pipelineId) => req("POST", `/pipelines/${q(pipelineId)}/handoffs/`, {}),
    updatePipeline: (id, patch) => req("PATCH", `/pipelines/${q(id)}/`, patch),
    addStage: (pipelineId, input) => req("POST", `/pipelines/${q(pipelineId)}/stages/`, input),
    removeStage: (pipelineId, stageKey, moveTo) => req("POST", `/pipelines/${q(pipelineId)}/stages/${q(stageKey)}/remove/`, { moveTo }),

    listDeals: (pipelineId) => list(`/deals/?pipeline=${q(pipelineId)}&limit=1000`),
    createDeal: (input) => req("POST", "/deals/", input),
    createBoothLead: (input) => req("POST", "/deals/booth/", input),
    updateDeal: (id, patch) => req("PATCH", `/deals/${q(id)}/`, patch),
    moveDeal: (id, input) => req("POST", `/deals/${q(id)}/move/`, input),
    deleteDeal: (id) => req("DELETE", `/deals/${q(id)}/`),
    addActivity: (dealId, type, text, attendeeIds = []) => req("POST", `/deals/${q(dealId)}/activities/`, { type, text, attendeeIds }),
    updateActivity: (activityId, patch) => req("PATCH", `/activities/${q(activityId)}/`, patch),
    setCallType: (dealId, callType) => req("POST", `/deals/${q(dealId)}/call-type/`, { callType }),
    transferDeal: (dealId, pipelineId) => req("POST", `/deals/${q(dealId)}/transfer/`, { pipelineId }),
    addTouchpoint: (dealId, input) => req("POST", `/deals/${q(dealId)}/touchpoints/`, input),
    createExpansion: (dealId) => req("POST", `/deals/${q(dealId)}/expansion/`, {}),

    listTasks: (pipelineId) => list(`/tasks/?pipeline=${q(pipelineId)}&limit=1000`),
    createTask: (input) => req("POST", "/tasks/", input),
    updateTask: (id, patch) => req("PATCH", `/tasks/${q(id)}/`, patch),
    deleteTask: (id) => req("DELETE", `/tasks/${q(id)}/`),

    listStageTasks: (pipelineId) => list(`/stage-tasks/?pipeline=${q(pipelineId)}`),
    createStageTask: (input) => req("POST", "/stage-tasks/", input),
    deleteStageTask: (id) => req("DELETE", `/stage-tasks/${q(id)}/`),

    listUsers: () => list("/users/"),
    inviteUser: (input) => req("POST", "/users/", input),
    resendInvite: (userId) => req("POST", `/users/${q(userId)}/resend-invite/`, {}),
    listIntakeKeys: () => list("/intake-keys/"),
    createIntakeKey: (name) => req("POST", "/intake-keys/", { name }),
    revokeIntakeKey: (id) => req("DELETE", `/intake-keys/${q(id)}/`),
    syncCalendar: (dealId) => req("POST", `/deals/${q(dealId)}/calendar-sync/`, {}),
    listRecordings: () => list("/recordings/?status=unmatched,failed"),
    linkRecording: (id, dealId) => req("POST", `/recordings/${q(id)}/link/`, { dealId }),
    dismissRecording: (id) => req("POST", `/recordings/${q(id)}/dismiss/`, {}),
    findDuplicates: ({ company = "", email = "", website = "" }) =>
      list(`/deals/duplicates/?company=${q(company)}&email=${q(email)}&website=${q(website)}`),
    getSettings: () => req("GET", "/settings/"),
    updateSettings: (patch) => req("PATCH", "/settings/", patch),

    importLeads: (pipelineId, rows) => req("POST", `/pipelines/${q(pipelineId)}/import/`, { rows }),
    loadSamples: (pipelineId) => req("POST", `/pipelines/${q(pipelineId)}/samples/`, {}),
    removeSamples: (pipelineId) => req("DELETE", `/pipelines/${q(pipelineId)}/samples/`),

    setApprover: (userId, canApprove) => req("PATCH", `/users/${q(userId)}/`, { canApproveOutreach: canApprove }),
    listOutreach: (campaign = "") => req("GET", `/outreach/?campaign=${q(campaign)}`),
    importOutreach: (input) => req("POST", "/outreach/import/", input),
    updateOutreachContact: (id, patch) => req("PATCH", `/outreach/contacts/${q(id)}/`, patch),
    setOutreachStep: (id, step, value) => req("POST", `/outreach/contacts/${q(id)}/step/`, { step, value }),
    answerReplyCheck: (id, channel, replied) => req("POST", `/outreach/contacts/${q(id)}/reply-check/`, { channel, replied }),
    updateResearch: (companyId, patch) => req("PATCH", `/outreach/companies/${q(companyId)}/research/`, patch),
    saveDraft: (contactId, input) => req("POST", `/outreach/contacts/${q(contactId)}/drafts/`, input),
    reviewDraft: (draftId, patch) => req("PATCH", `/outreach/drafts/${q(draftId)}/`, patch),
    deleteDraft: (draftId) => req("DELETE", `/outreach/drafts/${q(draftId)}/`),

    aiDraft: (dealId, input, signal) => req("POST", `/deals/${q(dealId)}/ai-draft/`, input, signal),
  };
}
