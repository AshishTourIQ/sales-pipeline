"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useCreateTask } from "../../api/hooks";
import { useData } from "../../context/data-context";
import { addDays } from "../../lib/dates";
import { byDue } from "../../lib/pipeline";
import type { Deal } from "../../types";
import { Field, Section } from "../common";
import { TaskRow } from "../tasks/TaskRow";

export function TasksTab({ deal }: { deal: Deal }) {
  const { tasks, team, me, canWrite } = useData();
  const create = useCreateTask();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(addDays(1));
  const [ownerId, setOwnerId] = useState(deal.ownerId || me?.id || "");
  const [err, setErr] = useState(false);
  const mine = tasks.filter((t) => t.dealId === deal.id).sort(byDue);
  const open = mine.filter((t) => !t.done);
  const done = mine.filter((t) => t.done);

  const add = () => {
    if (!title.trim()) { setErr(true); return; }
    create.mutate({ pipelineId: deal.pipelineId, dealId: deal.id, title: title.trim(), ownerId, due });
    setTitle(""); setErr(false);
  };

  return (
    <>
      {canWrite && (
        <Section>
          <div className="grid grid-cols-1 items-end gap-3 tab:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Field id="ntTitle" label="New task">
              <Input id="ntTitle" autoFocus placeholder="What needs doing next?" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
            </Field>
            <Field id="ntDue" label="Due"><Input id="ntDue" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <Field id="ntOwner" label="Owner">
              <NativeSelect id="ntOwner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">Unassigned</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </NativeSelect>
            </Field>
            <Button size="sm" variant="primary" onClick={add}>Add</Button>
          </div>
          {err && <div className="mt-1 text-[13px] text-danger">Write what needs doing first.</div>}
        </Section>
      )}
      <Section title="Open" right={<Badge>{open.length}</Badge>}>
        {open.length ? open.map((t) => <TaskRow key={t.id} task={t} />) : <p className="m-0 text-ink-3">No open tasks.</p>}
      </Section>
      {done.length > 0 && (
        <Section title="Done" right={<Badge>{done.length}</Badge>}>
          {done.map((t) => <TaskRow key={t.id} task={t} />)}
        </Section>
      )}
    </>
  );
}
