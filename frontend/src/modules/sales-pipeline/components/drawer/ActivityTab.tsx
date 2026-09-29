"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAddActivity } from "../../api/hooks";
import { ACT_TYPES } from "../../config/template";
import { useData } from "../../context/data-context";
import { fmtWhen } from "../../lib/dates";
import type { ActivityType, Deal } from "../../types";
import { Section, Seg } from "../common";

type NoteType = Exclude<ActivityType, "ai">;

export function ActivityTab({ deal }: { deal: Deal }) {
  const { canWrite } = useData();
  const add = useAddActivity();
  const [type, setType] = useState<NoteType>("note");
  const [text, setText] = useState("");

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    add.mutate({ dealId: deal.id, type, text: t }, { onSuccess: () => setText("") });
  };

  return (
    <>
      {canWrite && (
        <Section>
          <Seg className="mb-2" label="Entry type" value={type} onChange={setType} options={ACT_TYPES} />
          <Textarea autoFocus placeholder="What happened? Paste an email, call notes, or a next step." value={text} onChange={(e) => setText(e.target.value)} />
          <div className="mt-2"><Button size="sm" variant="primary" disabled={add.isPending} onClick={submit}>Add to timeline</Button></div>
        </Section>
      )}
      <Section><Timeline deal={deal} /></Section>
    </>
  );
}

function Timeline({ deal }: { deal: Deal }) {
  const { label } = useData();
  type Item = { at: string; key: string; node: React.ReactNode; cls: string };
  const items: Item[] = [
    ...deal.history.map((h, i): Item => ({
      at: h.at, key: `h${i}`, cls: "move",
      node: (
        <>
          <div className="whitespace-pre-wrap break-words">{h.from ? `Moved from ${label(h.from)} to ${label(h.to)}` : `Created at ${label(h.to)}`}</div>
          <div className="text-xs text-ink-3">{h.byName || "Someone"}, {fmtWhen(h.at)}</div>
        </>
      ),
    })),
    ...deal.activities.map((a): Item => ({
      at: a.at, key: a.id, cls: a.type === "ai" ? "ai" : "",
      node: (
        <>
          <div className="text-xs text-ink-3">{a.type === "ai" ? "AI draft saved" : ACT_TYPES.find((x) => x[0] === a.type)?.[1] ?? "Note"}</div>
          <div className="whitespace-pre-wrap break-words">{a.text}</div>
          <div className="text-xs text-ink-3">{a.byName || "Someone"}, {fmtWhen(a.at)}</div>
        </>
      ),
    })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  if (!items.length) return <p className="text-ink-3">Nothing yet.</p>;
  return <ul className="sp-tl">{items.map((it) => <li key={it.key} className={it.cls}>{it.node}</li>)}</ul>;
}
