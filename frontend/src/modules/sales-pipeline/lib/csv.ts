import { PLATFORMS, SEGMENTS, SOURCES } from "../config/template";
import type { Deal, ImportRow, Pipeline, StageKey, TeamMember } from "../types";
import { addDays, anyDate, DAY, daysSince, today, ymd } from "./dates";
import { stageLabel, stagesOf } from "./pipeline";
import { writeXlsx } from "./xlsx";

/** CSV or TSV (a paste from Sheets/Excel) → rows of cells. */
export function parseDelimited(input: string): string[][] {
  const text = String(input || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = text.split("\n")[0] ?? "";
  const delim =
    firstLine.includes("\t") && !firstLine.includes(",")
      ? "\t"
      : text.includes("\t") && text.split("\n").some((l) => /\tCompany\t/i.test(`\t${l}\t`))
        ? "\t"
        : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") { q = true; continue; }
    if (ch === delim) { row.push(field); field = ""; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

/**
 * Stage column → [stage, paid]. A stage name of this pipeline (what the import template
 * offers) wins; otherwise Lead Tracker numbering, which differs after stage 7.
 */
export function mapStage(v: string, p?: Pipeline | null): [StageKey, boolean] {
  const s = String(v || "").toLowerCase();
  const named = p ? stagesOf(p).find((x) => x.name.trim().toLowerCase() === s.trim()) : undefined;
  if (named) return [named.key, false];
  if (s.includes("lost")) return ["lost", false];
  if (s.includes("pause") || s.includes("nurture")) return ["nurture", false];
  if (s.includes("pilot")) return ["pilot", false];
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return ["s1", false];
  if (n <= 7) return [`s${Math.max(1, n)}` as StageKey, false];
  const m: Record<number, StageKey> = { 8: "s9", 9: "s10", 10: "s11", 11: "s11", 12: "s12", 13: "s13" };
  return [m[n] ?? "s13", n === 11];
}

export function mapSource(v: string): string {
  const s = String(v || "").toLowerCase();
  if (!s) return "";
  if (s.includes("spark")) return "Spark booth";
  if (s.includes("arival") && (s.includes("report") || s.includes("newsletter"))) return "Arival report / newsletter";
  if (s.includes("arival")) return "Arival booth";
  if (s.includes("pre-show") || s.includes("preshow")) return "Pre-show outreach";
  if (s.includes("partner")) return "Partner referral";
  if (s.includes("referral")) return "Client referral";
  if (s.includes("platform") || s.includes("ota")) return "Platform / OTA intro";
  if (s.includes("inbound")) return "Inbound (website, video)";
  if (s.includes("outbound")) return "Outbound list";
  return SOURCES.find((x) => x[0].toLowerCase() === s)?.[0] ?? String(v).trim();
}

export function mapSegment(v: string): string {
  const s = String(v || "").toLowerCase();
  if (!s) return "";
  if (/water|boat|marine|sail|cruise|snorkel|kayak/.test(s)) return "Water / boat";
  if (/adventure|zip|jeep|raft/.test(s)) return "Adventure";
  if (/food|walk|city/.test(s)) return "Food / walking / city";
  if (/attraction|multi/.test(s)) return "Attractions / multi-product";
  return "Other";
}

export function mapPlatform(v: string): string {
  const s = String(v || "").toLowerCase();
  if (!s) return "";
  return PLATFORMS.find((x) => s.includes((x.toLowerCase().split(" ")[0]) ?? "")) ?? "Other / unknown";
}

export interface ImportPreview {
  rows: ImportRow[];
  skippedExamples: number;
  duplicates: number;
  error?: string;
}

/** `src` is CSV/TSV text, or rows already read from a spreadsheet (lib/xlsx.ts). */
export function previewImport(src: string | string[][], existingCompanies: Set<string>, pipeline?: Pipeline | null): ImportPreview {
  const rows = typeof src === "string" ? parseDelimited(src) : src;
  const hi = rows.findIndex((r) => r.some((c) => String(c).trim().toLowerCase() === "company"));
  if (hi < 0) {
    return { rows: [], skippedExamples: 0, duplicates: 0, error: "Couldn't find a header row with a 'Company' column. Include the header row from the Lead Tracker." };
  }
  const head = (rows[hi] ?? []).map((c) => String(c).trim().toLowerCase());
  const col = (name: string) => head.findIndex((h) => h === name || h.indexOf(name) === 0);
  const C = {
    company: col("company"), contact: col("contact"), title: col("title"), email: col("email"), linkedin: col("linkedin"),
    segment: col("segment"), platform: col("booking platform"), region: col("city"), source: col("source"), fit: col("fit"),
    stage: col("stage"), owner: col("owner"), last: col("last touch"), next: col("next action"), nextDate: col("next date"),
    snap: col("snapshot"), demo: col("demo date"), notes: col("notes"), fu: col("follow-up date"), paid: col("paid"),
  };
  const g = (r: string[], k: keyof typeof C) => (C[k] >= 0 ? String(r[C[k]] ?? "").trim() : "");
  let skipped = 0;
  const out: ImportRow[] = [];
  for (const r of rows.slice(hi + 1)) {
    const co = g(r, "company");
    if (!co) continue;
    if (/^example/i.test(co)) { skipped++; continue; }
    const [stage, paid] = mapStage(g(r, "stage"), pipeline);
    out.push({
      company: co, contact: g(r, "contact"), title: g(r, "title"), email: g(r, "email"), linkedin: g(r, "linkedin"),
      segment: mapSegment(g(r, "segment")), platform: mapPlatform(g(r, "platform")), region: g(r, "region"),
      source: mapSource(g(r, "source")), fit: g(r, "fit"), stage, paid: paid || /^y/i.test(g(r, "paid")), owner: g(r, "owner"),
      last: anyDate(g(r, "last")), next: g(r, "next"), nextDate: anyDate(g(r, "nextDate")),
      snap: /^y/i.test(g(r, "snap")), demo: anyDate(g(r, "demo")), notes: g(r, "notes"), fu: anyDate(g(r, "fu")),
    });
  }
  const duplicates = out.filter((r) => existingCompanies.has(r.company.toLowerCase())).length;
  return { rows: out, skippedExamples: skipped, duplicates };
}

const csvCell = (v: unknown): string => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function dealsToCsv(deals: Deal[], p: Pipeline, team: TeamMember[]): string {
  const name = (id: string) => team.find((m) => m.id === id)?.name ?? id;
  const head = ["Company", "Contact", "Title", "Email", "Phone", "LinkedIn", "Website", "Region", "Segment", "Booking platform", "Fit", "Source", "Stage", "Owner", "Days in stage", "Interest", "Snapshot sent", "Demo date", "Payment", "Loss reason", "Re-engage date", "Created"];
  const rows = deals.map((d) => {
    const c = d.company, ct = d.contact;
    return [c.name, ct.name, ct.title, ct.email, ct.phone, ct.linkedin, c.website, c.region, c.segment, c.platform, d.fit, d.source, stageLabel(p, d.stage), name(d.ownerId), daysSince(d.stageChangedAt), d.interest, d.snapshotSent ? "Yes" : "No", d.demoDate, d.payment.status, d.lossReason, d.reengageDate, ymd(d.createdAt)];
  });
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8"): void {
  downloadBlob(filename, new Blob([text], { type }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const exportFilename = (p: Pipeline): string => `${p.name.replace(/[^\w-]+/g, "-")}-pipeline-${today()}.csv`;

/* ---------- Import template: the columns previewImport() reads, with an example row it skips ---------- */

type TplCol = { head: string; width: number; list?: "stage" | "owner" | "source" | "segment" | "platform" | "yesno"; date?: boolean; hint: string };
const TPL_COLS: TplCol[] = [
  { head: "Company", width: 28, hint: "Required. Rows without a company are ignored; a company already in the pipeline is skipped." },
  { head: "Contact", width: 20, hint: "Contact person's name." },
  { head: "Title", width: 18, hint: "Their role, e.g. Owner or General manager." },
  { head: "Email", width: 30, hint: "Work email." },
  { head: "LinkedIn", width: 28, hint: "Profile URL." },
  { head: "Segment", width: 24, list: "segment", hint: "Pick from the list." },
  { head: "Booking platform", width: 18, list: "platform", hint: "Pick from the list." },
  { head: "City", width: 16, hint: "City or region." },
  { head: "Source", width: 26, list: "source", hint: "Where the lead came from. Pick from the list." },
  { head: "Fit", width: 6, hint: "Fit score 1–5. Leave empty to have it calculated." },
  { head: "Stage", width: 22, list: "stage", hint: "Pick from the list. Empty means the first stage." },
  { head: "Owner", width: 14, list: "owner", hint: "A team member's name. Empty or unknown means the stage's default owner." },
  { head: "Last touch", width: 12, date: true, hint: "Date of the last contact (sets when the deal entered its stage)." },
  { head: "Next action", width: 24, hint: "Becomes a task for the owner." },
  { head: "Next date", width: 12, date: true, hint: "Due date of that task." },
  { head: "Snapshot sent", width: 14, list: "yesno", hint: "Yes or No." },
  { head: "Demo date", width: 12, date: true, hint: "Date of the demo." },
  { head: "Follow-up date", width: 14, date: true, hint: "Adds a follow-up task on this date." },
  { head: "Paid", width: 8, list: "yesno", hint: "Yes marks the payment as Paid." },
  { head: "Notes", width: 40, hint: "Added to the deal's activity." },
];
const EXAMPLE_COMPANY = "Example Tours (this row is skipped)";

function templateLists(p: Pipeline, team: TeamMember[]): Record<NonNullable<TplCol["list"]>, string[]> {
  return {
    stage: stagesOf(p).map((s) => s.name),
    owner: team.map((m) => m.name).filter(Boolean),
    source: SOURCES.map((s) => s[0]),
    segment: SEGMENTS,
    platform: PLATFORMS,
    yesno: ["Yes", "No"],
  };
}

function exampleRow(p: Pipeline, team: TeamMember[]): Record<string, string> {
  const first = stagesOf(p).find((s) => !s.lane);
  return {
    Company: EXAMPLE_COMPANY, Contact: "Jane Doe", Title: "Owner", Email: "jane@example.com", Segment: SEGMENTS[0] ?? "",
    "Booking platform": PLATFORMS[0] ?? "", City: "Miami", Source: SOURCES[0]?.[0] ?? "", Fit: "4", Stage: first?.name ?? "",
    Owner: team[0]?.name ?? "", "Last touch": today(), "Next action": "Send intro email", "Next date": addDays(2),
    "Snapshot sent": "No", Paid: "No", Notes: "Met at the booth",
  };
}

export const templateFilename = (p: Pipeline, ext: "xlsx" | "csv"): string =>
  `${p.name.replace(/[^\w-]+/g, "-")}-lead-import-template.${ext}`;

export function templateCsv(p: Pipeline, team: TeamMember[]): string {
  const ex = exampleRow(p, team);
  // BOM so Excel opens accented names (Bókun) correctly
  return "﻿" + [TPL_COLS.map((c) => c.head), TPL_COLS.map((c) => ex[c.head] ?? "")].map((r) => r.map(csvCell).join(",")).join("\n");
}

/** Excel serial for a YYYY-MM-DD day. */
const serial = (d: string) => Math.round((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(1899, 11, 30)) / DAY);

export function templateXlsx(p: Pipeline, team: TeamMember[]): Blob {
  const lists = templateLists(p, team);
  const listKeys = Object.keys(lists) as (keyof typeof lists)[];
  const ex = exampleRow(p, team);
  const listCol = (k: keyof typeof lists) => String.fromCharCode(65 + listKeys.indexOf(k));
  const longest = Math.max(...listKeys.map((k) => lists[k].length));
  return writeXlsx([
    {
      name: "Lead Tracker",
      header: true,
      widths: TPL_COLS.map((c) => c.width),
      dateCols: TPL_COLS.flatMap((c, i) => (c.date ? [i] : [])),
      lists: TPL_COLS.flatMap((c, i) => (c.list && lists[c.list].length
        ? [{ col: i, range: `Lists!$${listCol(c.list)}$2:$${listCol(c.list)}$${lists[c.list].length + 1}` }]
        : [])),
      rows: [
        TPL_COLS.map((c) => c.head),
        TPL_COLS.map((c) => {
          const v = ex[c.head] ?? "";
          return c.date && v ? serial(v) : c.head === "Fit" && v ? Number(v) : v;
        }),
      ],
    },
    {
      name: "How to fill",
      widths: [20, 100],
      rows: [
        ["Column", "What to put in it"],
        ...TPL_COLS.map((c) => [c.head, c.hint]),
        [],
        ["Tips", "Add one lead per row on the Lead Tracker tab, under the header row. Keep the header row as it is."],
        ["", `The example row ("${EXAMPLE_COMPANY}") is skipped, so you can leave it or delete it.`],
        ["", "Dates: type them as dates (e.g. 2026-10-15)."],
        ["", "Then in the pipeline: Settings → Import and export → choose this file → Check the rows → Import."],
      ],
    },
    {
      name: "Lists",
      widths: listKeys.map(() => 28),
      rows: [
        ["Stages", "Owners", "Sources", "Segments", "Booking platforms", "Yes / No"],
        ...Array.from({ length: longest }, (_, i) => listKeys.map((k) => lists[k][i] ?? "")),
      ],
    },
  ]);
}
