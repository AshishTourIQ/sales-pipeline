/**
 * Booth lead scoring: the Arival paper sheet's point system.
 *
 * The server scores every saved lead (backend services/scoring.py); this mirror
 * shows the live total and tier in the form and runs in the mock adapter.
 * tests/test_scoring.py pins the questions and points of both copies.
 */
import { BOOTH_QUESTIONS, CAP_OK, CAP_TIER, NOT_PROSPECT_VISITORS, TIER_BANDS } from "../config/template";
import type { Tier, VisitorType } from "../types";

export interface Score {
  points: number;
  /** "" when the visitor isn't scored (partner, press) */
  tierBeforeCap: Tier | "";
  capped: boolean;
  tier: Tier | "";
  /** Every question answered */
  complete: boolean;
}

const ORDER: Tier[] = TIER_BANDS.map(([t]) => t);

export function cleanAnswers(answers: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of BOOTH_QUESTIONS) {
    const o = answers?.[q.key];
    if (o && q.options.some((x) => x.key === o)) out[q.key] = o;
  }
  return out;
}

export const tierFor = (points: number): Tier => TIER_BANDS.find(([, low]) => points >= low)?.[0] ?? "D";

export function scoreBooth(visitor: VisitorType, answers: Record<string, string> | null | undefined): Score {
  if (NOT_PROSPECT_VISITORS.includes(visitor)) return { points: 0, tierBeforeCap: "D", capped: false, tier: "D", complete: true };
  if (visitor !== "operator") return { points: 0, tierBeforeCap: "", capped: false, tier: "", complete: true };
  const a = cleanAnswers(answers);
  const points = BOOTH_QUESTIONS.reduce((s, q) => s + (q.options.find((o) => o.key === a[q.key])?.points ?? 0), 0);
  const before = tierFor(points);
  // Cap unless both the decider and the booking system are confirmed
  const cap = Object.entries(CAP_OK).some(([q, ok]) => !ok.includes(a[q] ?? ""));
  const tier = cap && ORDER.indexOf(before) < ORDER.indexOf(CAP_TIER) ? CAP_TIER : before;
  return { points, tierBeforeCap: before, capped: tier !== before, tier, complete: Object.keys(a).length === BOOTH_QUESTIONS.length };
}

export function optionLabel(question: string, option: string): string {
  return BOOTH_QUESTIONS.find((q) => q.key === question)?.options.find((o) => o.key === option)?.label ?? "";
}

/** Badge colours per tier: A is the one to call first. */
export const tierVariant = (t: string) => (t === "A" ? "ok" : t === "B" ? "cold" : t === "C" ? "warm" : "default") as "ok" | "cold" | "warm" | "default";
