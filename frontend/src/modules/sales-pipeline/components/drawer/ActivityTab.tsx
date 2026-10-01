"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAddActivity, useUpdateActivity } from "../../api/hooks";
import { ACT_TYPES } from "../../config/template";
import { useData } from "../../context/data-context";
import { fmtWhen } from "../../lib/dates";
import { isCall } from "../../lib/involvement";
import type { Activity, ActivityType, Deal } from "../../types";
import { Section, Seg } from "../common";

type NoteType = Exclude<ActivityType, "ai">;

/** Tap the team members who were on a call or meeting (commission is paid on involvement). */
function AttendeePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { team } = useData();
  return (
    <div role="group" aria-label="Who from the team was on it" className="flex flex-wrap gap-1.5">
      {team.map((m) => {
        const on = value.includes(m.id);
        return (
          <button key={m.id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== m.id) : [...value, m.id])}
            className={cn("rounded-full border border-line-2 px-2.5 py-1 text-[13px] font-medium text-ink-2", "aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand-text")}>
            {m.name}
          </button>
        );
      })}
    </div>
  );
}

export function ActivityTab({ deal }: { deal: Deal }) {
  const { canWrite, me } = useData();
  const add = useAddActivity();
  const [type, setType] = useState<NoteType>("note");
  const [text, setText] = useState("");
  const [attendees, setAttendees] = useState<string[]>([]);
  const call = type === "call" || type === "meeting";

  const pick = (t: NoteType) => {
    setType(t);
    // The person writing it up was usually on it
    if ((t === "call" || t === "meeting") && !attendees.length && me) setAttendees([me.id]);
  };
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    add.mutate({ dealId: deal.id, type, text: t, attendeeIds: call ? attendees : [] }, { onSuccess: () => { setText(""); setAttendees([]); } });
  };

  return (
    <>
      {canWrite && (
        <Section>
          <Seg className="mb-2" label="Entry type" value={type} onChange={pick} options={ACT_TYPES} />
          <Textarea autoFocus placeholder="What happened? Paste an email, call notes, or a next step." value={text} onChange={(e) => setText(e.target.value)} />
          {call && (
            <div className="mt-2">
              <span className="mb-1 block text-xs font-medium text-ink-2">Who from the team was on it?</span>
              <AttendeePicker value={attendees} onChange={setAttendees} />
            </div>
          )}
          <div className="mt-2"><Button size="sm" variant="primary" disabled={add.isPending} onClick={submit}>Add to timeline</Button></div>
        </Section>
      )}
      <Section><Timeline deal={deal} /></Section>
    </>
  );
}

function Attendees({ a }: { a: Activity }) {
  const { memberName, canWrite } = useData();
  const update = useUpdateActivity();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string[]>(a.attendeeIds ?? []);
  const names = (a.attendeeIds ?? []).map((id) => memberName(id)).filter(Boolean);
  if (editing) {
    return (
      <div className="mt-1.5">
        <AttendeePicker value={value} onChange={setValue} />
        <div className="mt-1.5 flex gap-1.5">
          <Button size="xs" variant="primary" disabled={update.isPending} onClick={() => update.mutate({ activityId: a.id, attendeeIds: value }, { onSuccess: () => setEditing(false) })}>Save</Button>
          <Button size="xs" onClick={() => { setValue(a.attendeeIds ?? []); setEditing(false); }}>Cancel</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="text-xs text-ink-2">
      {names.length ? `On it: ${names.join(", ")}` : <span className="text-warn">Nobody from the team recorded as on it</span>}
      {canWrite && <button type="button" className="ml-1.5 font-medium text-info hover:underline" onClick={() => setEditing(true)}>Edit</button>}
    </div>
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
          {isCall(a) && <Attendees a={a} />}
          <div className="text-xs text-ink-3">{a.byName || "Someone"}, {fmtWhen(a.at)}</div>
        </>
      ),
    })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  if (!items.length) return <p className="text-ink-3">Nothing yet.</p>;
  return <ul className="sp-tl">{items.map((it) => <li key={it.key} className={it.cls}>{it.node}</li>)}</ul>;
}
