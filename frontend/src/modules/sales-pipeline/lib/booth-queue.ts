/**
 * Booth leads waiting to sync. Booth Wi-Fi drops; when a save fails for lack of
 * a connection the lead is kept here (this device only) and sent again later.
 * Each lead carries a clientId, so a save that did reach the server is never
 * duplicated by the retry.
 *
 * The queue belongs to the signed-in person (`scope`): on a shared booth tablet
 * the next person never sees, or syncs, someone else's leads.
 */
import { ApiError } from "../api/types";
import type { CreateBoothLeadInput } from "../types";

const PREFIX = "sales-pipeline.booth-queue.v2";
export const QUEUE_EVENT = "sales-pipeline:booth-queue";

const keyFor = (scope: string) => `${PREFIX}.${scope || "local"}`;

export interface QueuedLead {
  input: CreateBoothLeadInput;
  savedAt: string;
  /** Set when the server refused it (not a connection problem): needs a person to look */
  error?: string;
}

/**
 * Worth sending again later: no connection, signed out (401), timeout (408),
 * too many requests (429) or a server error. The clientId keeps retries safe.
 */
export function isRetryable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  return e.code === "network" || e.code === "cancelled" || [401, 408, 429].includes(e.status) || e.status >= 500;
}

export function readQueue(scope: string): QueuedLead[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(keyFor(scope)) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as QueuedLead[]) : [];
  } catch {
    return [];
  }
}

function write(scope: string, q: QueuedLead[]): boolean {
  try {
    if (q.length) window.localStorage.setItem(keyFor(scope), JSON.stringify(q));
    else window.localStorage.removeItem(keyFor(scope));
    window.dispatchEvent(new Event(QUEUE_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Returns false if the device can't store it (private mode, storage full). */
export function enqueue(scope: string, input: CreateBoothLeadInput): boolean {
  const q = readQueue(scope).filter((x) => x.input.clientId !== input.clientId);
  return write(scope, [...q, { input, savedAt: new Date().toISOString() }]);
}

export function dequeue(scope: string, clientId: string): void {
  write(scope, readQueue(scope).filter((x) => x.input.clientId !== clientId));
}

export function markFailed(scope: string, clientId: string, error: string): void {
  write(scope, readQueue(scope).map((x) => (x.input.clientId === clientId ? { ...x, error } : x)));
}

/** Clear the error so the next sync sends it again. */
export function clearFailed(scope: string, clientId: string): void {
  write(scope, readQueue(scope).map((x) => (x.input.clientId === clientId ? { input: x.input, savedAt: x.savedAt } : x)));
}
