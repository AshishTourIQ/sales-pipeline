"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, useCreateDeal } from "../../api/hooks";
import { BOOTH_SOURCES, INTERESTS, PLATFORMS, ROLE_SUGGESTIONS, SEGMENTS, SOURCE_NAMES } from "../../config/template";
import { entryForSourceIn, resolveStage } from "../../lib/pipeline";
import { useData } from "../../context/data-context";
import { useUi } from "../../context/ui-context";
import { EMPTY_COMPANY, fitScore, stageDef } from "../../lib/pipeline";
import type { Interest, StageKey } from "../../types";
import { CheckRow, Field, Grid, OptionList, Seg } from "../common";
import { EventPicker } from "../EventPicker";
import { DuplicateWarning } from "./DuplicateWarning";

type Tab = "lead" | "fit" | "route";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Form {
  co: string; name: string; title: string; email: string; phone: string; note: string; interest: Interest;
  region: string; platform: string; segment: string; products5: boolean; sellsOut: boolean; reachable: boolean;
  source: string; event: string; entry: StageKey; ownerId: string; demo: boolean; demoAt: string;
}

export function CaptureDialog() {
  const ui = useUi();
  const { pipeline, stages, team, label } = useData();
  const create = useCreateDeal();
  const coRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("lead");
  const [err, setErr] = useState(false);
  const [emailErr, setEmailErr] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [touched, setTouched] = useState({ entry: false, owner: false });

  const initial = (): Form => {
    const entry = ui.capture.stage ?? entryForSourceIn(pipeline, ui.lastSource);
    return {
      co: "", name: "", title: "", email: "", phone: "", note: "", interest: "Warm",
      region: "", platform: "", segment: "Water / boat", products5: false, sellsOut: false, reachable: true,
      source: ui.lastSource, event: BOOTH_SOURCES.includes(ui.lastSource) ? ui.lastEvent : "",
      entry, ownerId: stageDef(pipeline, entry).ownerId, demo: false, demoAt: "",
    };
  };
  const [f, setF] = useState<Form>(initial);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));

  useEffect(() => {
    if (ui.capture.open) {
      setF(initial()); setTab("lead"); setErr(false); setEmailErr(false); setSaveErr(""); setTouched({ entry: !!ui.capture.stage, owner: false });
    }
  }, [ui.capture.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSource = (source: string) => {
    const e = entryForSourceIn(pipeline, source);
    if (!touched.entry) set({ source, entry: e, ...(touched.owner ? {} : { ownerId: stageDef(pipeline, e).ownerId }) });
    else set({ source });
  };
  const onEntry = (entry: StageKey) => {
    setTouched((t) => ({ ...t, entry: true }));
    set({ entry, ...(touched.owner ? {} : { ownerId: stageDef(pipeline, entry).ownerId }) });
  };

  const fit = fitScore({ segment: f.segment, platform: f.platform, products5: f.products5, sellsOut: f.sellsOut, reachable: f.reachable });
  const entry: StageKey = f.demo ? resolveStage(pipeline, "s6") : f.entry;
  const ownerName = team.find((m) => m.id === f.ownerId)?.name;

  const save = (again: boolean) => {
    const co = f.co.trim();
    if (!co) { setTab("lead"); setErr(true); setTimeout(() => coRef.current?.focus(), 0); return; }
    const email = f.email.trim();
    if (email && !EMAIL_RE.test(email)) { setTab("lead"); setEmailErr(true); return; }
    if (!pipeline || create.isPending) return;
    setSaveErr("");
    ui.setLastSource(f.source);
    // Close or clear only once the server has saved it: on an error the typed lead stays in the form
    create.mutate(
      {
        pipelineId: pipeline.id, entryStage: entry, source: f.source, event: f.event.trim() || undefined, interest: f.interest, ownerId: f.ownerId,
        company: { ...EMPTY_COMPANY, name: co, region: f.region.trim(), segment: f.segment, platform: f.platform, products5: f.products5, sellsOut: f.sellsOut, reachable: f.reachable },
        contact: { name: f.name.trim(), title: f.title.trim(), email, phone: f.phone.trim(), linkedin: "", decisionMaker: false },
        note: f.note.trim() || undefined,
        demoDate: f.demo && f.demoAt ? f.demoAt : undefined,
      },
      {
        onSuccess: (r) => {
          const n = r.tasksCreated.length;
          toast(`${co} saved at ${label(entry)}.${n ? ` ${n} ${n === 1 ? "task" : "tasks"} created.` : ""}`);
          const ph = stageDef(pipeline, entry).phase;
          if (ui.view !== "board") ui.setView("board", ph);
          else if (ui.sub.board !== "all" && ui.sub.board !== ph) ui.setSub(ph);
          ui.setMobileStage(ph, entry);
          if (again) {
            set({ co: "", name: "", title: "", email: "", phone: "", note: "", demoAt: "", products5: false, sellsOut: false, demo: false });
            setTab("lead");
            setTimeout(() => coRef.current?.focus(), 0);
          } else ui.closeCapture();
        },
        onError: (e) => setSaveErr(`Not saved: ${errorMessage(e)}`),
      },
    );
  };

  return (
    <Dialog open={ui.capture.open} onOpenChange={(v) => { if (!v) ui.closeCapture(); }}>
      <DialogContent onOpenAutoFocus={(e) => { e.preventDefault(); coRef.current?.focus(); }}>
        <DialogTitle>Add a lead</DialogTitle>
        <DialogDescription>Only the company is required. The other tabs are optional and already filled with sensible defaults.</DialogDescription>

        <div role="tablist" className="sp-noscroll -mx-[22px] mb-4 mt-1 flex gap-0.5 overflow-x-auto border-b border-line px-[22px]">
          {([["lead", "Lead"], ["fit", "Company and fit"], ["route", "Stage and owner"]] as const).map(([k, t]) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
              className="-mb-px whitespace-nowrap border-b-2 border-transparent px-2.5 pb-2.5 pt-[9px] font-medium text-ink-2 aria-selected:border-brand aria-selected:text-ink">
              {t}
            </button>
          ))}
        </div>

        {tab === "lead" && (
          <div>
            <Grid>
              <Field id="c_co" label="Company">
                <Input id="c_co" ref={coRef} autoComplete="organization" value={f.co} onChange={(e) => { set({ co: e.target.value }); setErr(false); }} />
                {err && <div className="mt-1 text-[13px] text-danger">Add the company name to save.</div>}
              </Field>
              <Field id="c_name" label="Contact name"><Input id="c_name" autoComplete="name" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field id="c_title" label="Role">
                <Input id="c_title" list="sp-roles" value={f.title} onChange={(e) => set({ title: e.target.value })} />
                <datalist id="sp-roles">{ROLE_SUGGESTIONS.map((r) => <option key={r} value={r} />)}</datalist>
              </Field>
              <Field id="c_email" label="Email">
                <Input id="c_email" type="email" autoComplete="email" aria-invalid={emailErr || undefined} value={f.email} onChange={(e) => { set({ email: e.target.value }); setEmailErr(false); }} />
                {emailErr && <div className="mt-1 text-[13px] text-danger">Check the email address, or leave it empty.</div>}
              </Field>
              <Field id="c_phone" label="Phone"><Input id="c_phone" type="tel" autoComplete="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
              <div>
                <span className="mb-[5px] block text-xs font-medium text-ink-2">Interest</span>
                <Seg label="Interest" value={f.interest} onChange={(interest) => set({ interest })} options={INTERESTS.map((v) => [v, v] as const)} />
              </div>
            </Grid>
            <DuplicateWarning company={f.co} email={f.email} onOpen={ui.closeCapture} />
            <Field id="c_note" label="What they said" className="mt-3">
              <Textarea id="c_note" rows={3} placeholder="Sells out Saturday sunsets weeks ahead. Wants a Snapshot." value={f.note} onChange={(e) => set({ note: e.target.value })} />
            </Field>
          </div>
        )}

        {tab === "fit" && (
          <div>
            <Grid>
              <Field id="c_region" label="City or region"><Input id="c_region" value={f.region} onChange={(e) => set({ region: e.target.value })} /></Field>
              <Field id="c_plat" label="Booking platform">
                <NativeSelect id="c_plat" value={f.platform} onChange={(e) => set({ platform: e.target.value })}><OptionList items={PLATFORMS} blank="Not sure yet" /></NativeSelect>
              </Field>
              <Field id="c_seg" label="Segment">
                <NativeSelect id="c_seg" value={f.segment} onChange={(e) => set({ segment: e.target.value })}><OptionList items={SEGMENTS} /></NativeSelect>
              </Field>
            </Grid>
            <div className="mt-2.5">
              <CheckRow checked={f.products5} onChange={(products5) => set({ products5 })}>5+ products or many daily departures</CheckRow>
              <CheckRow checked={f.sellsOut} onChange={(sellsOut) => set({ sellsOut })}>Sells out often or big seasonal swings</CheckRow>
              <CheckRow checked={f.reachable} onChange={(reachable) => set({ reachable })}>Owner, GM or revenue lead is reachable</CheckRow>
            </div>
            <div className="mt-2 flex items-center gap-3 rounded-[10px] border border-line bg-hover px-3 py-2.5">
              <b className="min-w-[30px] text-center text-[22px] tabular-nums">{fit}</b>
              <span className="text-ink-2">of 5 fit score. 5 means call first. Water, FareHarbor (Peek Pro counts half), 5+ products, sells out, reachable.</span>
            </div>
          </div>
        )}

        {tab === "route" && (
          <div>
            <Grid>
              <Field id="c_src" label="Lead source">
                <NativeSelect id="c_src" value={f.source} onChange={(e) => onSource(e.target.value)}><OptionList items={SOURCE_NAMES} /></NativeSelect>
              </Field>
              <Field id="c_event" label="Event (if they came from one)">
                <EventPicker id="c_event" allowNone value={f.event} onChange={(event) => set({ event })} />
              </Field>
              <Field id="c_entry" label="Starts at">
                <NativeSelect id="c_entry" value={f.entry} onChange={(e) => onEntry(e.target.value as StageKey)}>
                  {stages.filter((s) => !s.lane).map((s) => <option key={s.key} value={s.key}>{label(s.key)}</option>)}
                </NativeSelect>
              </Field>
              <Field id="c_owner" label="Owner">
                <NativeSelect id="c_owner" value={f.ownerId} onChange={(e) => { setTouched((t) => ({ ...t, owner: true })); set({ ownerId: e.target.value }); }}>
                  <option value="">Unassigned</option>
                  {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </NativeSelect>
              </Field>
            </Grid>
            <CheckRow className="mt-3" checked={f.demo} onChange={(demo) => set({ demo })}>Demo booked on the spot</CheckRow>
            {f.demo && (
              <Field id="c_demoAt" label="Demo date and time" className="mt-1.5 max-w-[280px]">
                <Input id="c_demoAt" type="datetime-local" autoFocus value={f.demoAt} onChange={(e) => set({ demoAt: e.target.value })} />
              </Field>
            )}
          </div>
        )}

        {saveErr && <div role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{saveErr}</div>}

        <DialogFooter>
          <span className="mr-auto min-w-0 flex-[1_1_160px] self-center text-[12.5px] text-ink-3 max-[699px]:w-full">
            Goes to {label(entry)}{ownerName ? `, owner ${ownerName}` : ""}
          </span>
          <Button onClick={ui.closeCapture}>Cancel</Button>
          <Button disabled={create.isPending} onClick={() => save(true)}>Save and add another</Button>
          <Button variant="primary" disabled={create.isPending} onClick={() => save(false)}>{create.isPending ? "Saving…" : "Save lead"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
