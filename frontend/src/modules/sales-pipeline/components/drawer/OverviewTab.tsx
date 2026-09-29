"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { errorMessage, useCreateExpansion, useDeleteDeal, useUpdateDeal, useUpdateTask } from "../../api/hooks";
import {
  CHECKLISTS, INTERESTS, ONBOARD_ITEMS, PAY_STATUS, PILOT_ITEMS, PLATFORMS, QUAL_ITEMS, SEGMENTS, SOURCE_NAMES,
  type ChecklistItem,
} from "../../config/template";
import { useData } from "../../context/data-context";
import { useUi } from "../../context/ui-context";
import { dueLabel, fmtDay, today } from "../../lib/dates";
import { requirements } from "../../lib/gating";
import { TaskRow } from "../tasks/TaskRow";
import { fitScore, nextStageOf, reachedOrPast, routesFor, stageDef } from "../../lib/pipeline";
import type { Checklist, Deal, DealPatch, Interest, PaymentStatus, StageKey } from "../../types";
import { CheckRow, Field, Grid, KV, OptionList, Section } from "../common";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";

type ChecklistField = "qual" | "pilotChecks" | "onboarding";

export function OverviewTab({ deal }: { deal: Deal }) {
  const ui = useUi();
  const { label, openTasks, memberName, canWrite, pipeline } = useData();
  const update = useUpdateDeal();
  const updateTask = useUpdateTask();
  const expand = useCreateExpansion();
  const del = useDeleteDeal();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const patch = (p: DealPatch) => update.mutate({ deal, patch: p });

  const routes = routesFor(pipeline, deal.stage);
  const nextAfter = nextStageOf(pipeline, deal.stage);
  const open = openTasks.get(deal.id) ?? [];
  const nt = open[0];
  const t0 = today();

  const checklist = (field: ChecklistField, items: ChecklistItem[], title: string, done?: { to: StageKey; text: string }) => {
    const v: Checklist = deal[field] ?? {};
    const n = items.filter(([k]) => v[k]).length;
    return (
      <Section title={title} right={<Badge variant={n === items.length ? "ok" : "default"}>{n} of {items.length}</Badge>}>
        {items.map(([k, text]) => (
          <CheckRow key={k} checked={!!v[k]} disabled={!canWrite} onChange={(c) => patch({ [field]: { ...v, [k]: c } })}>{text}</CheckRow>
        ))}
        {done && n === items.length && canWrite && (
          <div className="mt-2.5"><Button size="sm" variant="primary" onClick={() => ui.requestMove(deal.id, done.to)}>{done.text} → {label(done.to)}</Button></div>
        )}
      </Section>
    );
  };

  return (
    <>
      <Section title="Where it goes next">
        {routes.length ? (
          <div className="flex flex-wrap gap-1.5">
            {routes.map(([text, to], i) => (
              <Button key={to + text} size="sm" disabled={!canWrite} variant={i === 0 && to !== "lost" && to !== "nurture" ? "primary" : "default"} onClick={() => ui.requestMove(deal.id, to)}>
                {text} → {label(to)}
              </Button>
            ))}
          </div>
        ) : (
          <p className="m-0 text-ink-3">Active client. Referrals and expansion become new deals.</p>
        )}
        {!stageDef(pipeline, deal.stage).lane && !nextStageOf(pipeline, deal.stage) && canWrite && (
          <div className="mt-2.5">
            <Button size="sm" disabled={expand.isPending} onClick={() => expand.mutate(deal, { onSuccess: (r) => { ui.openDeal(r.deal.id); toast(`New deal created at ${label(r.deal.stage)}.`); } })}>
              New expansion deal for this company
            </Button>
          </div>
        )}
      </Section>

      {!stageDef(pipeline, deal.stage).lane && <StageChecklist deal={deal} />}

      <Section title="Next step" right={open.length > 1 ? <Button variant="ghost" size="xs" onClick={() => ui.setDrawerTab("tasks")}>All {open.length} tasks</Button> : undefined}>
        {nt ? (
          <div className="flex items-center gap-2.5 rounded-[10px] border border-brand-border bg-brand-soft px-[13px] py-[11px]">
            <Checkbox checked={false} disabled={!canWrite} aria-label="Mark done" onCheckedChange={() => updateTask.mutate({ task: nt, patch: { done: true } })} />
            <div className="flex-1">
              <div className="font-medium">{nt.title}</div>
              <div className="text-xs text-ink-3">
                {memberName(nt.ownerId) || "Unassigned"}, <span className={cn(nt.due && nt.due < t0 && "font-medium text-danger")}>{dueLabel(nt.due)}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-[10px] border border-warn-border bg-warn-soft px-[13px] py-[11px]">
            <div className="flex-1">No open task. Every deal needs a next step with a date.</div>
            {canWrite && <Button size="sm" onClick={() => ui.setDrawerTab("tasks")}>Add a task</Button>}
          </div>
        )}
      </Section>

      {deal.stage === "s8" && checklist("qual", QUAL_ITEMS, "Qualification checklist", nextAfter ? { to: nextAfter, text: "All checks pass" } : undefined)}
      {deal.stage === "pilot" && checklist("pilotChecks", PILOT_ITEMS, "Pilot checklist")}
      {(deal.stage === "s12" || deal.stage === "s13") && checklist("onboarding", ONBOARD_ITEMS, "Go-live checklist", deal.stage === "s12" && nextAfter ? { to: nextAfter, text: "Go live" } : undefined)}

      {(["s4", "s5", "s6", "s7", "s8", "s9", "pilot"] as StageKey[]).includes(deal.stage) && (
        <Section title="Snapshot and demo">
          <Grid>
            <CheckRow className="self-end" checked={deal.snapshotSent} disabled={!canWrite}
              onChange={(c) => { patch({ snapshotSent: c }); toast(c ? "Snapshot marked as sent." : "Snapshot unmarked."); }}>
              Pricing Snapshot sent
            </CheckRow>
            <Field id="demoDate" label="Demo date">
              <Input id="demoDate" type="datetime-local" disabled={!canWrite} defaultValue={deal.demoDate} onBlur={(e) => { if (e.target.value !== deal.demoDate) patch({ demoDate: e.target.value }); }} />
            </Field>
          </Grid>
        </Section>
      )}

      {deal.stage === "nurture" && (
        <Section title="Nurture">
          <Grid>
            <KV label="Reason" value={deal.nurtureReason} />
            <Field id="reDate" label="Check back on">
              <Input id="reDate" type="date" disabled={!canWrite} defaultValue={deal.reengageDate} onChange={(e) => patch({ reengageDate: e.target.value })} />
            </Field>
          </Grid>
        </Section>
      )}

      {deal.stage === "lost" && (
        <Section title="Why it was lost">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-x-[18px] gap-y-3">
            <KV label="Reason" value={deal.lossReason} />
            <KV label="Competitor" value={deal.lossCompetitor} />
          </div>
        </Section>
      )}

      {(!!deal.signedAt || reachedOrPast(pipeline, deal, "s11")) && <PaymentSection deal={deal} onPatch={patch} />}

      <Section title="Company and contact" right={canWrite && !editing ? <Button size="sm" onClick={() => setEditing(true)}>Edit</Button> : undefined}>
        {editing ? <DetailsForm deal={deal} onDone={() => setEditing(false)} /> : <DetailsView deal={deal} />}
      </Section>

      {canWrite && (
        <Section>
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>Delete this deal</Button>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Delete this deal?"
            text={`This removes ${deal.company.name || "the deal"}, its timeline and its tasks for everyone. To keep the history, move it to Lost instead.`}
            ok="Delete deal"
            danger
            onOk={() => { ui.closeDeal(); del.mutate(deal); }}
          />
        </Section>
      )}
    </>
  );
}

function PaymentSection({ deal, onPatch }: { deal: Deal; onPatch: (p: DealPatch) => void }) {
  const { canWrite } = useData();
  const pay = deal.payment;
  const set = (k: "invoice" | "amount" | "paidAt", v: string) => { if ((pay[k] ?? "") !== v) onPatch({ payment: { ...pay, [k]: v } }); };
  return (
    <Section title="Payment" right={<span className="text-xs text-ink-3">Runs alongside onboarding</span>}>
      <Grid>
        <Field id="payStatus" label="Status">
          <NativeSelect id="payStatus" disabled={!canWrite} value={pay.status} onChange={(e) => {
            const status = e.target.value as PaymentStatus;
            onPatch({ payment: { ...pay, status, ...(status === "Paid" && !pay.paidAt ? { paidAt: today() } : {}) } });
          }}>
            <OptionList items={PAY_STATUS} />
          </NativeSelect>
        </Field>
        <Field id="payInv" label="Invoice number"><Input id="payInv" disabled={!canWrite} defaultValue={pay.invoice ?? ""} onBlur={(e) => set("invoice", e.target.value)} /></Field>
        <Field id="payAmt" label="Amount"><Input id="payAmt" disabled={!canWrite} defaultValue={pay.amount ?? ""} onBlur={(e) => set("amount", e.target.value)} /></Field>
        <Field id="payDate" label="Paid on"><Input id="payDate" type="date" disabled={!canWrite} value={pay.paidAt ?? ""} onChange={(e) => set("paidAt", e.target.value)} /></Field>
      </Grid>
    </Section>
  );
}

function DetailsView({ deal }: { deal: Deal }) {
  const { memberName } = useData();
  const c = deal.company, ct = deal.contact;
  const href = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-x-[18px] gap-y-3">
      <KV label="Contact" value={ct.name} />
      <KV label="Role" value={ct.title} />
      <KV label="Email" value={ct.email} />
      <KV label="Phone" value={ct.phone} />
      <KV label="LinkedIn" value={ct.linkedin} href={ct.linkedin ? href(ct.linkedin) : undefined} />
      <KV label="Decision-maker" value={ct.decisionMaker ? "Yes" : "Not confirmed"} />
      <KV label="Website" value={c.website} href={c.website ? href(c.website) : undefined} />
      <KV label="Region" value={c.region} />
      <KV label="Segment" value={c.segment} />
      <KV label="Booking platform" value={c.platform} />
      <KV label="Fit score" value={`${deal.fit} of 5`} />
      <KV label="Lead source" value={deal.source} />
      <KV label="Owner" value={memberName(deal.ownerId)} />
      <KV label="Interest" value={deal.interest} />
      <KV label="Package" value={deal.package} />
      <KV label="Monthly value" value={deal.value} />
      <KV label="Locations" value={deal.locations} />
      <KV label="Created" value={fmtDay(deal.createdAt)} />
    </div>
  );
}

function DetailsForm({ deal, onDone }: { deal: Deal; onDone: () => void }) {
  const { team } = useData();
  const update = useUpdateDeal();
  const [c, setC] = useState(deal.company);
  const [ct, setCt] = useState(deal.contact);
  const [d, setD] = useState({ source: deal.source, ownerId: deal.ownerId, interest: deal.interest, package: deal.package, value: deal.value, locations: deal.locations });
  const txt = (id: string, lbl: string, val: string, on: (v: string) => void, type = "text") => (
    <Field id={id} label={lbl}><Input id={id} type={type} value={val} onChange={(e) => on(e.target.value)} /></Field>
  );
  const [err, setErr] = useState("");
  const save = () => {
    const company = { ...c, name: c.name.trim() || deal.company.name };
    const contact = { ...ct, email: ct.email.trim() };
    if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) { setErr("Check the email address, or leave it empty."); return; }
    setErr("");
    // Close only once saved: on an error the edits stay in the form
    update.mutate(
      { deal: { ...deal, fit: fitScore(company) }, patch: { company, contact, ...d, interest: d.interest as Interest | "" } },
      { onSuccess: () => { toast("Details saved."); onDone(); }, onError: (e) => setErr(`Not saved: ${errorMessage(e)}`) },
    );
  };
  return (
    <>
      <Grid>
        {txt("e_co", "Company", c.name, (name) => setC({ ...c, name }))}
        {txt("e_web", "Website", c.website, (website) => setC({ ...c, website }))}
        {txt("e_region", "City or region", c.region, (region) => setC({ ...c, region }))}
        <Field id="e_seg" label="Segment"><NativeSelect id="e_seg" value={c.segment} onChange={(e) => setC({ ...c, segment: e.target.value })}><OptionList items={SEGMENTS} blank="Not set" /></NativeSelect></Field>
        <Field id="e_plat" label="Booking platform"><NativeSelect id="e_plat" value={c.platform} onChange={(e) => setC({ ...c, platform: e.target.value })}><OptionList items={PLATFORMS} blank="Not set" /></NativeSelect></Field>
        {txt("e_name", "Contact name", ct.name, (name) => setCt({ ...ct, name }))}
        {txt("e_title", "Role", ct.title, (title) => setCt({ ...ct, title }))}
        {txt("e_email", "Email", ct.email, (email) => setCt({ ...ct, email }), "email")}
        {txt("e_phone", "Phone", ct.phone, (phone) => setCt({ ...ct, phone }), "tel")}
        {txt("e_li", "LinkedIn", ct.linkedin, (linkedin) => setCt({ ...ct, linkedin }))}
        <Field id="e_src" label="Lead source"><NativeSelect id="e_src" value={d.source} onChange={(e) => setD({ ...d, source: e.target.value })}><OptionList items={SOURCE_NAMES} blank="Not set" /></NativeSelect></Field>
        <Field id="e_owner" label="Owner">
          <NativeSelect id="e_owner" value={d.ownerId} onChange={(e) => setD({ ...d, ownerId: e.target.value })}>
            <option value="">Unassigned</option>
            {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </NativeSelect>
        </Field>
        <Field id="e_int" label="Interest"><NativeSelect id="e_int" value={d.interest} onChange={(e) => setD({ ...d, interest: e.target.value as Interest | "" })}><OptionList items={INTERESTS} blank="Not set" /></NativeSelect></Field>
        {txt("e_pkg", "Package", d.package, (v) => setD({ ...d, package: v }))}
        {txt("e_val", "Monthly value", d.value, (v) => setD({ ...d, value: v }))}
        {txt("e_loc", "Locations", d.locations, (v) => setD({ ...d, locations: v }))}
      </Grid>
      <div className="mt-2.5">
        <CheckRow checked={ct.decisionMaker} onChange={(decisionMaker) => setCt({ ...ct, decisionMaker })}>Decision-maker confirmed</CheckRow>
        <CheckRow checked={c.products5} onChange={(products5) => setC({ ...c, products5 })}>5+ products or many daily departures</CheckRow>
        <CheckRow checked={c.sellsOut} onChange={(sellsOut) => setC({ ...c, sellsOut })}>Sells out often or big seasonal swings</CheckRow>
        <CheckRow checked={c.reachable} onChange={(reachable) => setC({ ...c, reachable })}>Owner, GM or revenue lead is reachable</CheckRow>
      </div>
      {err && <div role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</div>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="primary" disabled={update.isPending} onClick={save}>{update.isPending ? "Saving…" : "Save details"}</Button>
        <Button size="sm" onClick={onDone}>Cancel</Button>
      </div>
    </>
  );
}


/** The stage's gate: every blocking task (and checklist item) done → the deal moves on by itself. */
function StageChecklist({ deal }: { deal: Deal }) {
  const { tasks, label, pipeline } = useData();
  const reqs = requirements(deal, tasks);
  const stageTasks = tasks
    .filter((t) => t.dealId === deal.id && t.stage === deal.stage && t.blocking !== false && !(t.done && t.autoClosed))
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.due || "9999").localeCompare(b.due || "9999"));
  const cl = CHECKLISTS[deal.stage];
  const total = stageTasks.length + (cl ? cl.items.length : 0);
  const doneCount = total - reqs.count;
  const nxt = nextStageOf(pipeline, deal.stage);

  if (!total) {
    return (
      <Section title="To finish this stage">
        <p className="m-0 text-ink-2">
          This stage has no tasks, so it won&apos;t move on by itself. Move it when you&apos;re ready, or add a stage task on the Tasks page.
        </p>
      </Section>
    );
  }
  return (
    <Section title="To finish this stage" right={<Badge variant={reqs.done ? "ok" : "default"}>{doneCount} of {total} done</Badge>}>
      <p className="m-0 mb-1 text-[13px] text-ink-2">
        {reqs.done
          ? "Everything for this stage is done."
          : nxt
            ? <>When these are done, the deal moves to <b className="font-medium text-ink">{label(nxt)}</b> by itself. Moving it forward before then is blocked.</>
            : "Finish these to complete the stage."}
      </p>
      <div className="h-1.5 overflow-hidden rounded bg-sunk" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount} aria-label="Stage progress">
        <i className="block h-full rounded bg-brand" style={{ width: `${Math.round((doneCount / total) * 100)}%` }} />
      </div>
      <div className="mt-1">{stageTasks.map((t) => <TaskRow key={t.id} task={t} />)}</div>
      {cl && reqs.checklistMissing > 0 && (
        <p className="m-0 mt-1 text-[13px] text-ink-2">Plus {reqs.checklistMissing} checklist item{reqs.checklistMissing === 1 ? "" : "s"} below.</p>
      )}
    </Section>
  );
}
