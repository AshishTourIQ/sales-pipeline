/**
 * Booth form routing shared by the form (to preview where a visitor goes) and the
 * mock adapter. Mirror of backend services/booth.py; the server decides for real.
 */
import { isTrack, NOT_PROSPECT_VISITORS, OFFER_FOR_TIER, PARTNER_VISITORS } from "../config/template";
import type { FollowupKey, OfferKey, Pipeline, StageKey, Tier, VisitorType } from "../types";
import { entryForSourceIn, resolveStage, stagesOf } from "./pipeline";

export function boothEntry(p: Pipeline | null | undefined, visitor: VisitorType, offer: OfferKey | "", source: string): StageKey {
  if (NOT_PROSPECT_VISITORS.includes(visitor)) return "lost";
  if (PARTNER_VISITORS.includes(visitor) || visitor === "press") return "nurture";
  if (offer === "demo_booked") return resolveStage(p, "s6");
  if (offer === "demo_given") return resolveStage(p, "s7");
  if (isTrack(offer) && stagesOf(p).some((s) => s.key === "offer")) return "offer";
  return entryForSourceIn(p, source || "Arival booth");
}

/** The offer the form pre-selects: from the tier for operators; vendors who played get "game". */
export function defaultOffer(visitor: VisitorType, tier: Tier | "", gamePlayed: boolean): OfferKey | "" {
  if (visitor === "operator") return tier ? OFFER_FOR_TIER[tier] : "";
  return visitor === "vendor" && gamePlayed ? "game" : "";
}

/** Which follow-up default applies; null = nobody follows up (competitors, vendors). */
export function followupKey(visitor: VisitorType, tier: Tier | ""): FollowupKey | null {
  if (NOT_PROSPECT_VISITORS.includes(visitor)) return null;
  if (PARTNER_VISITORS.includes(visitor)) return "partner";
  if (visitor === "press") return "press";
  return tier || "D";
}

/** Local "YYYY-MM-DDTHH:mm" for datetime-local inputs. */
export function localNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function newClientId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}
