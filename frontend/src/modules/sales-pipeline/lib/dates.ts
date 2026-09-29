export const DAY = 86_400_000;

export function ymd(d: Date | string | number): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

export const today = (): string => ymd(new Date());
export const nowIso = (): string => new Date().toISOString();

export function addDays(n: number, from?: string): string {
  const d = from ? new Date(`${from}T12:00:00`) : new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export const parseDay = (s: string): Date => new Date(`${s}T00:00:00`);

export const dayDiff = (a: string, b: string): number =>
  Math.round((parseDay(a).getTime() - parseDay(b).getTime()) / DAY);

export function daysSince(iso: string | undefined | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
}

export function fmtDay(s: string | undefined | null): string {
  if (!s) return "";
  const d = s.length === 10 ? parseDay(s) : new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

export function fmtWhen(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export function dueLabel(due: string | undefined | null): string {
  if (!due) return "No date";
  const diff = dayDiff(due, today());
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "1 day overdue";
  if (diff < 0) return `${-diff} days overdue`;
  if (diff < 7) return parseDay(due).toLocaleDateString(undefined, { weekday: "long" });
  return fmtDay(due);
}

/** Excel serial dates and free-form strings → "YYYY-MM-DD" or "" */
export function anyDate(v: string): string {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((parseFloat(s) - 25569) * DAY));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? "" : ymd(t);
}
