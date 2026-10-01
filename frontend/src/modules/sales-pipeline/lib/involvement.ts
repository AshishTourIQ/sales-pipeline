/**
 * Involvement: who worked a deal, for commissions and account management.
 *
 * A person is involved in a deal when they own it, met them at the booth, are its
 * account manager, or were on any of its calls or meetings. Commission is paid on
 * involvement across the whole journey, so the key numbers are how many of a deal's
 * calls each person attended, and the signed deals where they were on every call.
 */
import type { Activity, Deal, Pipeline, TeamMember } from "../types";
import { reachedOrPast } from "./pipeline";

export type Role = "owner" | "met" | "account";
export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", met: "Met at the booth", account: "Account manager" };

export const isCall = (a: Activity) => a.type === "call" || a.type === "meeting";

export interface DealPerson {
  id: string;
  roles: Role[];
  attended: number;
}

/** Everyone involved in one deal, with the calls they were on (of `calls`). */
export function dealInvolvement(deal: Deal): { calls: number; people: DealPerson[] } {
  const calls = deal.activities.filter(isCall);
  const map = new Map<string, DealPerson>();
  const get = (id: string) => {
    let p = map.get(id);
    if (!p) { p = { id, roles: [], attended: 0 }; map.set(id, p); }
    return p;
  };
  if (deal.ownerId) get(deal.ownerId).roles.push("owner");
  if (deal.metById) get(deal.metById).roles.push("met");
  if (deal.accountManagerId) get(deal.accountManagerId).roles.push("account");
  for (const c of calls) for (const id of c.attendeeIds ?? []) get(id).attended++;
  return { calls: calls.length, people: [...map.values()].sort((a, b) => b.attended - a.attended || b.roles.length - a.roles.length) };
}

export interface PersonInvolvement {
  id: string;
  deals: number;
  /** Calls and meetings they were on */
  attended: number;
  /** All calls and meetings on the deals they're involved in */
  callsOnTheirDeals: number;
  /** attended ÷ callsOnTheirDeals, 0..1 (null when there were no calls) */
  rate: number | null;
  signed: number;
  /** Signed deals where they were on every call */
  signedAllCalls: number;
  accountManaged: number;
}

export function teamInvolvement(deals: Deal[], team: TeamMember[], pipeline: Pipeline | null): PersonInvolvement[] {
  const rows = new Map<string, PersonInvolvement>(team.map((m) => [m.id, {
    id: m.id, deals: 0, attended: 0, callsOnTheirDeals: 0, rate: null, signed: 0, signedAllCalls: 0, accountManaged: 0,
  }]));
  for (const d of deals) {
    if (d.sample) continue;
    const inv = dealInvolvement(d);
    const signed = reachedOrPast(pipeline, d, "s11");
    for (const p of inv.people) {
      const r = rows.get(p.id);
      if (!r) continue;
      r.deals++;
      r.attended += p.attended;
      r.callsOnTheirDeals += inv.calls;
      if (p.roles.includes("account")) r.accountManaged++;
      if (signed) {
        r.signed++;
        if (inv.calls > 0 && p.attended === inv.calls) r.signedAllCalls++;
      }
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, rate: r.callsOnTheirDeals ? r.attended / r.callsOnTheirDeals : null }))
    .sort((a, b) => b.deals - a.deals);
}
