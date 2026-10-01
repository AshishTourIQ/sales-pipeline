"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { eventOptions } from "../config/template";
import { useData } from "../context/data-context";

const OTHER = "__other__";

/**
 * Event dropdown: Arival 2026, Spark 2026 and every event already used, plus
 * "Other event…" to type a new one. `allowNone` adds "No event" (Add lead, deal details).
 */
export function EventPicker({ id, value, onChange, allowNone = false }: {
  id: string; value: string; onChange: (v: string) => void; allowNone?: boolean;
}) {
  const { deals } = useData();
  const options = eventOptions(deals.map((d) => d.event));
  const known = !value || options.includes(value);
  const [typing, setTyping] = useState(!known);
  return (
    <>
      <NativeSelect id={id} value={typing ? OTHER : value} onChange={(e) => {
        if (e.target.value === OTHER) { setTyping(true); onChange(""); return; }
        setTyping(false);
        onChange(e.target.value);
      }}>
        {allowNone && <option value="">No event</option>}
        {!allowNone && !value && !typing && <option value="">Choose the event</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value={OTHER}>Other event…</option>
      </NativeSelect>
      {typing && (
        <Input className="mt-1.5" aria-label="Event name" placeholder="e.g. ITB Berlin 2027" autoFocus value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </>
  );
}
