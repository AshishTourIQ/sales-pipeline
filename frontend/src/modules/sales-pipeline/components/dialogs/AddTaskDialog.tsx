"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useCreateStageTask, useCreateTask } from "../../api/hooks";
import { useData } from "../../context/data-context";
import { useUi } from "../../context/ui-context";
import { addDays } from "../../lib/dates";
import type { StageKey } from "../../types";
import { Field, Grid } from "../common";

type Mode = "stage" | "one";

/**
 * Two kinds of task:
 *  - Stage task: "Guddu must do X in stage 1". Added to every deal of Guddu's
 *    in that stage now and to every one entering it later. It must be done
 *    before those deals can move on.
 *  - One task: a single task on one deal (or none).
 */
export function AddTaskDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { deals, team, pipeline, me, stages, label, canAdmin } = useData();
  const ui = useUi();
  const createOne = useCreateTask();
  const createStage = useCreateStageTask();
  const [mode, setMode] = useState<Mode>(canAdmin ? "stage" : "one");
  const [titles, setTitles] = useState([""]);
  const focusIdx = useRef<number | null>(null);
  const [dealId, setDealId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [stage, setStage] = useState<StageKey | "">("");
  const [due, setDue] = useState(addDays(1));
  const [dueInDays, setDueInDays] = useState(1);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setMode(canAdmin ? "stage" : "one"); setTitles([""]); setDealId(""); setOwnerId(ui.taskOwnerId || me?.id || ""); setStage("");
      setDue(addDays(1)); setDueInDays(1); setErr("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only the main stages this person owns (their default stages in Settings → Stages)
  const ownedStages = useMemo(() => stages.filter((s) => !s.lane && s.ownerId === ownerId), [stages, ownerId]);
  useEffect(() => {
    if (stage && !ownedStages.some((s) => s.key === stage)) setStage("");
    if (!stage && ownedStages.length === 1) setStage(ownedStages[0]?.key ?? "");
  }, [ownedStages, stage]);

  const affected = stage ? deals.filter((d) => d.stage === stage && d.ownerId === ownerId).length : 0;
  const personName = team.find((m) => m.id === ownerId)?.name ?? "";
  const options = deals.filter((d) => d.stage !== "lost").sort((a, b) => a.company.name.localeCompare(b.company.name));

  // Each non-empty task box becomes its own task; they share the person, stage/deal and due date.
  const setTitleAt = (i: number, v: string) => { setTitles((ts) => ts.map((t, j) => (j === i ? v : t))); setErr(""); };
  const addTitle = () => { focusIdx.current = titles.length; setTitles((ts) => [...ts, ""]); };
  const removeTitle = (i: number) => setTitles((ts) => ts.filter((_, j) => j !== i));

  const submit = () => {
    if (!pipeline) return;
    const list = titles.map((t) => t.trim()).filter(Boolean);
    if (!list.length) { setErr("Write what needs doing first."); return; }
    if (mode === "stage") {
      if (!ownerId) { setErr("Choose the person."); return; }
      if (!stage) { setErr("Choose the stage."); return; }
      for (const t of list) createStage.mutate({ pipelineId: pipeline.id, stage, ownerId, title: t, dueInDays: Math.max(0, dueInDays) });
    } else {
      for (const t of list) createOne.mutate({ pipelineId: pipeline.id, dealId: dealId || null, title: t, ownerId, due });
    }
    onOpenChange(false);
  };
  const count = titles.filter((t) => t.trim()).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Add a task</DialogTitle>
        <DialogDescription>
          {mode === "stage"
            ? "A stage task goes on every deal this person has in the stage, now and later. Deals can't move on until it's done."
            : "A single task, on one deal or on its own. Every deal needs a next step with a date."}
        </DialogDescription>

        {canAdmin && <div role="tablist" className="sp-noscroll -mx-[22px] mb-4 flex gap-0.5 overflow-x-auto border-b border-line px-[22px]">
          {([["stage", "Stage task (all their deals)"], ["one", "One task"]] as const).map(([k, t]) => (
            <button key={k} role="tab" type="button" aria-selected={mode === k} onClick={() => { setMode(k); setErr(""); }}
              className="-mb-px whitespace-nowrap border-b-2 border-transparent px-2.5 pb-2.5 pt-[9px] font-medium text-ink-2 aria-selected:border-brand aria-selected:text-ink">
              {t}
            </button>
          ))}
        </div>}

        <Grid>
          <Field id="atOwner" label="Person">
            <NativeSelect id="atOwner" value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setErr(""); }}>
              <option value="">{mode === "stage" ? "Choose a person" : "Unassigned"}</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </NativeSelect>
          </Field>
          {mode === "stage" ? (
            <Field id="atStage" label="Stage">
              <NativeSelect id="atStage" value={stage} disabled={!ownerId || !ownedStages.length} onChange={(e) => { setStage(e.target.value as StageKey); setErr(""); }}>
                <option value="">{!ownerId ? "Choose the person first" : ownedStages.length ? "Choose a stage" : "Owns no stages"}</option>
                {ownedStages.map((s) => <option key={s.key} value={s.key}>{label(s.key)}</option>)}
              </NativeSelect>
            </Field>
          ) : (
            <Field id="atDeal" label="Deal">
              <NativeSelect id="atDeal" value={dealId} onChange={(e) => setDealId(e.target.value)}>
                <option value="">No deal</option>
                {options.map((d) => <option key={d.id} value={d.id}>{d.company.name || "Deal"}</option>)}
              </NativeSelect>
            </Field>
          )}
        </Grid>
        {mode === "stage" && ownerId && !ownedStages.length && (
          <p className="mb-0 mt-2 text-[13px] text-warn">{personName} isn&apos;t the owner of any stage. Set stage owners in Settings → Stages.</p>
        )}

        <Field id="atTitle" label={titles.length > 1 ? "Tasks" : "Task"} className="mt-3">
          <div className="flex flex-col gap-2">
            {titles.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input id={i === 0 ? "atTitle" : undefined} aria-label={`Task ${i + 1}`} value={t}
                  placeholder={mode === "stage" ? "Check the website and booking platform" : "Send the Snapshot"}
                  ref={(el) => { if (el && focusIdx.current === i) { el.focus(); focusIdx.current = null; } }}
                  onChange={(e) => setTitleAt(i, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
                {titles.length > 1 && (
                  <Button variant="ghost" size="icon" aria-label={`Remove task ${i + 1}`} onClick={() => removeTitle(i)}><X /></Button>
                )}
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="mt-2 self-start" onClick={addTitle}><Plus /> Add another task</Button>
        </Field>

        {mode === "stage" ? (
          <Field id="atDueIn" label="Due (days after the deal enters the stage)" className="mt-3 max-w-[260px]">
            <Input id="atDueIn" type="number" min={0} max={365} value={dueInDays} onChange={(e) => setDueInDays(parseInt(e.target.value, 10) || 0)} />
          </Field>
        ) : (
          <Field id="atDue" label="Due" className="mt-3 max-w-[260px]">
            <Input id="atDue" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        )}

        {mode === "stage" && stage && (
          <p className="mb-0 mt-3 rounded-[10px] border border-line bg-hover px-3 py-2.5 text-[13px] text-ink-2">
            Adds to <b className="font-medium text-ink">{affected} {affected === 1 ? "deal" : "deals"}</b> now ({personName}&apos;s deals in {label(stage)}), and to every deal of {personName}&apos;s that enters {label(stage)} later.
          </p>
        )}
        {err && <div className="mt-2 text-[13px] text-danger">{err}</div>}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit}>{mode === "stage" ? (count > 1 ? `Add ${count} stage tasks` : "Add stage task") : (count > 1 ? `Add ${count} tasks` : "Add task")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
