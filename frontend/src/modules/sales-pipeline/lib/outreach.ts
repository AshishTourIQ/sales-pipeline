/**
 * Outreach (the Arival outreach tracker): labels, the rules' plain-words text, and reading the
 * tracker workbook. Mirrors backend config.OUTREACH_*; the server enforces every rule.
 */
import type {
  DraftChannel, DraftStatus, OutreachContact, OutreachImportRow, OutreachResearchRow, OutreachStep, ResearchKey, VerifyKey,
} from "../types";
import { anyDate, DAY } from "./dates";

export const STEP_GROUPS: { key: string; title: string; steps: [OutreachStep, string][] }[] = [
  { key: "linkedin", title: "LinkedIn (Nikunj's personal account)", steps: [["li_note", "Connection note sent"], ["li_msg", "Message sent"], ["li_reply", "Reply received"], ["li_demo", "Demo set"]] },
  { key: "email", title: "Email (hello@touriq.ai)", steps: [["em_draft", "Email drafted"], ["em_sent", "Email sent"], ["em_follow", "Follow-up sent"], ["em_reply", "Reply received"]] },
  { key: "app", title: "Arival app", steps: [["app_sent", "Message sent"], ["app_reply", "Reply received"]] },
  { key: "calendar", title: "Calendar", steps: [["cal_demo", "Demo booked (TourIQ calendar)"], ["arival_meeting", "Arival meeting"]] },
];
export const STEP_LABEL = Object.fromEntries(STEP_GROUPS.flatMap((g) => g.steps.map(([k, l]) => [k, `${g.key === "linkedin" ? "LinkedIn" : g.key === "email" ? "Email" : g.key === "app" ? "Arival app" : "Calendar"}: ${l.toLowerCase()}`]))) as Record<OutreachStep, string>;

/** Ticking these needs an approved draft of this channel (server-checked). */
export const SEND_STEP_CHANNEL: Partial<Record<OutreachStep, DraftChannel>> = {
  li_note: "li_note", li_msg: "li_msg", em_sent: "email", em_follow: "email_follow", app_sent: "app",
};

export const CHANNELS: [DraftChannel, string, string][] = [
  ["li_note", "LinkedIn connection note", "Under 200 characters"],
  ["li_msg", "LinkedIn message", "40 to 80 words"],
  ["email", "Email", "100 to 140 words, with a subject"],
  ["email_follow", "Email follow-up", "Under 50 words"],
  ["app", "Arival app message", "Short and specific"],
];
export const CHANNEL_LABEL = Object.fromEntries(CHANNELS.map(([k, l]) => [k, l])) as Record<DraftChannel, string>;

export const DRAFT_STATUS: Record<DraftStatus, [string, "default" | "warm" | "ok" | "hot" | "brand"]> = {
  pending: ["Waiting for approval", "warm"],
  changes: ["Changes asked", "hot"],
  approved: ["Approved: ready to send", "ok"],
  sent: ["Sent", "default"],
};

export const VERIFY: [VerifyKey, string][] = [
  ["company", "It's the right company: the name and website match"],
  ["person", "The person works there in this role (LinkedIn or the company site)"],
  ["contact_info", "The email and LinkedIn are theirs, not a shared inbox"],
];

export const RESEARCH: [ResearchKey, string, boolean][] = [
  ["booking_platform", "Booking platform", true],
  ["example_tour", "Example tour or product (name)", true],
  ["listed_price", "Listed price (as shown on their site)", true],
  ["sources", "Sources (the URLs you opened)", true],
  ["price_variation", "Price variation", false],
  ["demand_language", "Demand language on their own site", false],
  ["size", "Size (tours, boats, locations)", false],
  ["unverified", "Not confirmed yet", false],
  ["notes", "Notes", false],
];

export const PRIORITIES = ["P1", "P2", "P3", "P4", "Review", "Skip"] as const;
export const PRIORITY_HINT: Record<string, string> = {
  P1: "Only the P1 owner messages them",
  P2: "Team messages them after approval",
  P3: "Team messages them after approval",
  P4: "Low priority",
  Review: "Confirm first",
  Skip: "Never contacted (duplicate or competitor)",
};

/** Ask-today items for the Today list, in the order people should do them. */
export const TODAY_ORDER: OutreachContact["next"]["key"][] = [
  "ask_linkedin", "ask_email", "ask_app", "send", "fix", "email", "follow", "book", "li_msg", "verify", "write", "approval",
];

export const isOpen = (c: OutreachContact) => !["none", "done", "wait"].includes(c.next.key);

export function hasResearch(c: OutreachContact): boolean {
  return !!c.company.researchVerifiedAt;
}

export function fmtStep(step: OutreachStep, v: string | undefined): string {
  if (!v) return "";
  if (step === "arival_meeting") return v.replace("T", " ");
  return v;
}

/* ---------- reading the tracker workbook ---------- */

const norm = (s: string) => String(s ?? "").trim().toLowerCase();

/** Excel date (serial, with or without a time) or a typed date → "YYYY-MM-DD" (meeting: "YYYY-MM-DDTHH:MM"). */
function cellDate(v: string, withTime = false): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (withTime && /^\d{5}\.\d+$/.test(s)) {
    const d = new Date(Math.round((parseFloat(s) - 25569) * DAY));
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  }
  if (withTime && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) return s.slice(0, 16).replace(" ", "T");
  return anyDate(s);
}

function headerRow(rows: string[][], must: string): number {
  return rows.findIndex((r) => r.some((c) => norm(c) === must));
}

export interface TrackerPreview {
  contacts: OutreachImportRow[];
  research: OutreachResearchRow[];
  error?: string;
  /** People per priority, for the preview */
  byPriority: Record<string, number>;
  companies: number;
}

/** The outreach tracker's Contacts and Research tabs → import rows. Nothing is sent anywhere here. */
export function parseTracker(sheets: Map<string, string[][]>): TrackerPreview {
  const empty: TrackerPreview = { contacts: [], research: [], byPriority: {}, companies: 0 };
  const contactsTab = [...sheets.entries()].find(([n, rows]) => norm(n) === "contacts" || headerRow(rows, "participant") >= 0)?.[1];
  if (!contactsTab) return { ...empty, error: "Couldn't find the Contacts tab (a header row with a 'Participant' column)." };
  const hi = headerRow(contactsTab, "participant");
  const head = contactsTab[hi]!.map(norm);
  const col = (name: string, from = 0) => head.indexOf(name, from);
  const li = col("connection note sent");
  const em = col("email drafted");
  const cal = col("demo booked (touriq calendar)");
  // The three Arival app columns sit between the email group and the calendar: one per sender
  const appCols = em >= 0 && cal > em + 4 ? Array.from({ length: cal - (em + 4) }, (_, i) => em + 4 + i) : [];
  const g = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");

  const contacts: OutreachImportRow[] = [];
  for (const r of contactsTab.slice(hi + 1)) {
    const company = g(r, col("company"));
    const name = g(r, col("participant"));
    if (!company || !name) continue;
    const steps: OutreachImportRow["steps"] = {};
    const put = (k: OutreachStep, i: number, withTime = false) => { const d = cellDate(g(r, i), withTime); if (d) steps[k] = d; };
    if (li >= 0) { put("li_note", li); put("li_msg", li + 1); put("li_reply", li + 2); put("li_demo", li + 3); }
    if (em >= 0) { put("em_draft", em); put("em_sent", em + 1); put("em_follow", em + 2); put("em_reply", em + 3); }
    let appSender = "";
    for (const i of appCols) {
      const d = cellDate(g(r, i));
      if (d && (!steps.app_sent || d < steps.app_sent)) { steps.app_sent = d; appSender = head[i] ?? ""; }
    }
    if (cal >= 0) { put("cal_demo", cal); put("arival_meeting", cal + 1, true); }
    contacts.push({
      extId: g(r, col("id")), name, title: g(r, col("job title")), email: g(r, col("participant email")),
      country: g(r, col("country")), company, segment: g(r, col("segment")), priority: g(r, col("priority")),
      roleType: g(r, col("role type (from title)")), competitor: g(r, col("competitor?")),
      leadReview: g(r, head.findIndex((h) => h.startsWith("nikunj reviews"))), flags: g(r, col("data flags")),
      notes: g(r, col("notes")), steps, appSender,
    });
  }

  const research: OutreachResearchRow[] = [];
  const resTab = [...sheets.entries()].find(([n]) => norm(n) === "research")?.[1];
  if (resTab) {
    const ri = headerRow(resTab, "company");
    const rh = (resTab[ri] ?? []).map(norm);
    const rc = (prefix: string) => rh.findIndex((h) => h.startsWith(prefix));
    for (const r of resTab.slice(ri + 1)) {
      const company = g(r, rc("company"));
      if (!company) continue;
      research.push({
        company, website: g(r, rc("website")), competitor: g(r, rc("competitor")), bookingPlatform: g(r, rc("booking platform")),
        exampleTour: g(r, rc("example tour")), listedPrice: g(r, rc("listed price")), priceVariation: g(r, rc("price variation")),
        demandLanguage: g(r, rc("demand language")), size: g(r, rc("size")), sources: g(r, rc("sources")), unverified: g(r, rc("unverified")),
      });
    }
  }
  const byPriority: Record<string, number> = {};
  contacts.forEach((c) => { byPriority[c.priority || "Review"] = (byPriority[c.priority || "Review"] ?? 0) + 1; });
  return { contacts, research, byPriority, companies: new Set(contacts.map((c) => c.company.toLowerCase())).size };
}
