"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage, qk } from "../../api/hooks";
import { useModule } from "../../context/module-context";
import { clearFailed, dequeue, isRetryable, markFailed, QUEUE_EVENT, readQueue, type QueuedLead } from "../../lib/booth-queue";

const RETRY_MS = 30_000;

/** Leads saved on this device while offline, sent again when the connection is back. */
export function useBoothSync() {
  const { api, currentUser } = useModule();
  const scope = currentUser?.id ?? "";
  const qc = useQueryClient();
  const [queue, setQueue] = useState<QueuedLead[]>([]);
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);

  const flush = useCallback(async () => {
    if (busy.current) return;
    const pending = readQueue(scope).filter((x) => !x.error);
    if (!pending.length) return;
    busy.current = true;
    setSyncing(true);
    let sent = 0;
    try {
      for (const item of pending) {
        try {
          await api.createBoothLead(item.input);
          dequeue(scope, item.input.clientId);
          sent++;
        } catch (e) {
          // Offline, signed out, rate-limited or a server error: stop and try again later.
          // Anything else (the server refused the lead) needs a person.
          if (isRetryable(e)) break;
          markFailed(scope, item.input.clientId, errorMessage(e));
        }
      }
    } finally {
      busy.current = false;
      setSyncing(false);
    }
    if (sent) {
      void qc.invalidateQueries({ queryKey: qk.all });
      toast(`${sent} booth ${sent === 1 ? "lead" : "leads"} saved on this device ${sent === 1 ? "is" : "are"} now in the pipeline.`);
    }
  }, [api, qc, scope]);

  useEffect(() => {
    const refresh = () => setQueue(readQueue(scope));
    refresh();
    void flush();
    const online = () => void flush();
    window.addEventListener(QUEUE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("online", online);
    const t = setInterval(() => { if (readQueue(scope).some((x) => !x.error)) void flush(); }, RETRY_MS);
    return () => {
      window.removeEventListener(QUEUE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("online", online);
      clearInterval(t);
    };
  }, [flush, scope]);

  return { queue, syncing, flush, scope };
}

/** Shown while booth leads are waiting on this device. */
export function BoothQueueBanner() {
  const { queue, syncing, flush, scope } = useBoothSync();
  if (!queue.length) return null;
  const failed = queue.filter((x) => x.error);
  const waiting = queue.length - failed.length;
  const cls = "mx-3.5 mt-2.5 flex flex-wrap items-center gap-2.5 rounded-[10px] px-3.5 py-2.5 text-[13px] tab:mx-[18px] tab:mt-3 desk:mx-6";
  return (
    <>
      {waiting > 0 && (
        <div className={`${cls} bg-warn-soft text-warn`} role="status">
          {waiting} booth {waiting === 1 ? "lead is" : "leads are"} saved on this device and will sync when the connection is back.
          <Button size="xs" disabled={syncing} onClick={() => void flush()}>{syncing ? "Syncing…" : "Sync now"}</Button>
        </div>
      )}
      {failed.map((x) => (
        <div key={x.input.clientId} className={`${cls} bg-danger-soft text-danger`} role="alert">
          <span className="min-w-0 flex-1">
            Booth lead <b className="font-semibold">{x.input.company}</b> couldn&apos;t be saved: {x.error}
          </span>
          <Button size="xs" disabled={syncing} onClick={() => { clearFailed(scope, x.input.clientId); void flush(); }}>Retry</Button>
          <Button size="xs" variant="ghost" onClick={() => dequeue(scope, x.input.clientId)}>Discard</Button>
        </div>
      ))}
    </>
  );
}
