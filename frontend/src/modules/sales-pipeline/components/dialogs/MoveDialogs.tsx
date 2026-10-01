"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useMoveDeal } from "../../api/hooks";
import { CALL_TYPES, isCompetitor, isTrack, LOSS_REASONS, NURTURE_REASONS, PILOT_CAP, TRACKS } from "../../config/template";
import { useData } from "../../context/data-context";
import { useModule } from "../../context/module-context";
import { useUi } from "../../context/ui-context";
import { addDays } from "../../lib/dates";
import { describe, gated, requirements } from "../../lib/gating";
import type { CallType, Deal, MoveDealInput, Track } from "../../types";
import { Field, Grid, OptionList } from "../common";
import { ConfirmDialog } from "./ConfirmDialog";

/** Hook used anywhere a deal changes stage (board drop, drawer, list row). */
export function useMove() {
  const { label } = useData();
  const m = useMoveDeal((d) => label(d.stage));
  return (deal: Deal, input: MoveDealInput) => m.mutate({ deal, input });
}

/**
 * Some moves need more information first (Lost needs a reason, Nurture a date,
 * Demo booked a time, Pilot a cap check). The UI calls ui.requestMove(); this
 * component decides whether to ask or move straight away.
 */
export function MoveDialogs() {
  const ui = useUi();
  const { canOverride } = useModule();
  const { dealById, deals, tasks, canWrite, label, pipeline } = useData();
  const move = useMove();
  const req = ui.moveRequest;
  const deal = req ? dealById.get(req.dealId) : undefined;
  const to = req?.to;
  const [override, setOverride] = useState<{ reason: string } | null>(null);

  // Stage gate: forward moves need every task (and checklist item) of the current stage done
  const reqs = deal ? requirements(deal, tasks) : null;
  const blocked = !!(deal && to && reqs && gated(pipeline, deal.stage, to) && !reqs.done);

  const needsDialog = blocked || to === "lost" || to === "nurture" || to === "s6" || to === "offer" || to === "s9" || (to === "pilot" && deals.filter((d) => d.stage === "pilot").length >= PILOT_CAP);

  useEffect(() => {
    setOverride(null);
    if (!req) return;
    if (!deal || !canWrite || deal.stage === req.to) { ui.clearMove(); return; }
    if (isCompetitor(deal) && req.to !== "lost") {
      toast.error("This company is a competitor: do not contact. It stays in Lost.");
      ui.clearMove();
      return;
    }
    if (blocked && !canOverride && reqs) {
      toast.error(`Finish the ${describe(reqs)} in ${label(deal.stage)} first. The deal moves on by itself when they're done.`);
      ui.clearMove();
      return;
    }
    if (!needsDialog) { move(deal, { to: req.to }); ui.clearMove(); }
  }, [req]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { setOverride(null); ui.clearMove(); };
  if (!deal || !to || !needsDialog) return null;

  if (blocked && canOverride && reqs && !override) {
    return (
      <OverrideDialog
        dealName={deal.company.name || "This deal"}
        from={label(deal.stage)}
        to={label(to)}
        open={reqs.openTasks.map((t) => t.title)}
        checklistMissing={reqs.checklistMissing}
        onClose={close}
        onConfirm={(reason) => {
          // Lanes and demo dates still get their own dialog; everything else moves now
          if (to === "s6" || to === "s9") { setOverride({ reason }); return; }
          move(deal, { to, force: true, overrideReason: reason });
          close();
        }}
      />
    );
  }
  const force = override ? { force: true, overrideReason: override.reason } : {};

  if (to === "lost") return <LostDialog deal={deal} onClose={close} onMove={(i) => { move(deal, i); close(); }} />;
  if (to === "nurture") return <NurtureDialog onClose={close} onMove={(i) => { move(deal, i); close(); }} />;
  if (to === "s6") return <DemoDialog deal={deal} onClose={close} onMove={(i) => { move(deal, { ...i, ...force }); close(); }} />;
  if (to === "offer") return <OfferDialog deal={deal} onClose={close} onMove={(i) => { move(deal, i); close(); }} />;
  if (to === "s9") return <CallTypeDialog deal={deal} onClose={close} onMove={(i) => { move(deal, { ...i, ...force }); close(); }} />;
  if (to !== "pilot") return null;
  return (
    <ConfirmDialog
      open
      onOpenChange={(v) => { if (!v) close(); }}
      title={`${PILOT_CAP} pilots are already running`}
      text={`The plan caps pilots at ${PILOT_CAP}, for FareHarbor water operators, until onboarding setup is automated. Start another one anyway?`}
      ok="Start pilot anyway"
      onOk={() => { move(deal, { to: "pilot", ...force }); close(); }}
    />
  );
}

/** Admin only: move forward with open tasks. The reason is saved on the deal. */
function OverrideDialog({ dealName, from, to, open, checklistMissing, onClose, onConfirm }: {
  dealName: string; from: string; to: string; open: string[]; checklistMissing: number;
  onClose: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState(false);
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogTitle>{from} isn&apos;t finished</DialogTitle>
        <DialogDescription>
          {dealName} moves to {to} by itself once these are done. As an admin you can move it now, but the reason is saved in its history.
        </DialogDescription>
        <ul className="m-0 mb-3 list-disc pl-5 text-[13.5px]">
          {open.map((t) => <li key={t} className="my-0.5">{t}</li>)}
          {checklistMissing > 0 && <li className="my-0.5">{checklistMissing} checklist item{checklistMissing === 1 ? "" : "s"} not ticked</li>}
        </ul>
        <Field id="ovReason" label="Why move it now?">
          <Textarea id="ovReason" rows={3} autoFocus placeholder="Booked the demo by phone; tasks were done offline." value={reason} onChange={(e) => { setReason(e.target.value); setErr(false); }} />
          {err && <div className="mt-1 text-[13px] text-danger">Give a reason to continue.</div>}
        </Field>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => { if (!reason.trim()) { setErr(true); return; } onConfirm(reason.trim()); }}>Move anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LostDialog({ deal, onClose, onMove }: { deal: Deal; onClose: () => void; onMove: (i: MoveDealInput) => void }) {
  const [reason, setReason] = useState("");
  const [comp, setComp] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState(false);
  const submit = () => {
    if (!reason) { setErr(true); return; }
    onMove({ to: "lost", lossReason: reason, lossCompetitor: comp.trim(), note: note.trim() || undefined });
    if (reason === "Unsubscribed") toast("Moved to Lost. Honour the unsubscribe: don't email this contact or domain again.");
  };
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogTitle>Move to Lost</DialogTitle>
        <DialogDescription>{deal.company.name || "This deal"} leaves the active pipeline. The reason is required; it&apos;s how you learn what to fix.</DialogDescription>
        <Field id="lostReason" label="Reason">
          <NativeSelect id="lostReason" value={reason} onChange={(e) => { setReason(e.target.value); setErr(false); }}>
            <OptionList items={LOSS_REASONS} blank="Choose a reason" />
          </NativeSelect>
          {err && <div className="mt-1 text-[13px] text-danger">Choose a reason to continue.</div>}
        </Field>
        {reason === "Chose a competitor" && (
          <Field id="lostComp" label="Which competitor" className="mt-2.5">
            <Input id="lostComp" placeholder="Name it" value={comp} onChange={(e) => setComp(e.target.value)} />
          </Field>
        )}
        <Field id="lostNote" label="Note (optional)" className="mt-2.5">
          <Textarea id="lostNote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>Move to Lost</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NurtureDialog({ onClose, onMove }: { onClose: () => void; onMove: (i: MoveDealInput) => void }) {
  const [reason, setReason] = useState("Not now");
  const [date, setDate] = useState(addDays(60));
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogTitle>Move to Nurture</DialogTitle>
        <DialogDescription>Right fit, wrong timing. They stay on the content drip and come back on the date you set.</DialogDescription>
        <Grid>
          <Field id="nurReason" label="Reason">
            <NativeSelect id="nurReason" value={reason} onChange={(e) => setReason(e.target.value)}>
              <OptionList items={NURTURE_REASONS} />
            </NativeSelect>
          </Field>
          <Field id="nurDate" label="Check back on">
            <Input id="nurDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </Grid>
        <Field id="nurNote" label="Note (optional)" className="mt-2.5">
          <Textarea id="nurNote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onMove({ to: "nurture", nurtureReason: reason, reengageDate: date || addDays(60), note: note.trim() || undefined })}>Move to Nurture</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Offer sent" needs to know what was offered: its tasks depend on it. */
function OfferDialog({ deal, onClose, onMove }: { deal: Deal; onClose: () => void; onMove: (i: MoveDealInput) => void }) {
  const [track, setTrack] = useState<Track>(deal.track || (deal.booth?.offer && isTrack(deal.booth.offer) ? deal.booth.offer : "analysis"));
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogTitle>Offer sent</DialogTitle>
        <DialogDescription>What did {deal.company.name || "they"} take instead of a demo? The tasks and reminders follow from it.</DialogDescription>
        <Field id="offerTrack" label="Offer">
          <NativeSelect id="offerTrack" value={track} onChange={(e) => setTrack(e.target.value as Track)}>
            {TRACKS.map(([k, text]) => <option key={k} value={k}>{text}</option>)}
          </NativeSelect>
        </Field>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onMove({ to: "offer", track })}>Move to Offer sent</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Second call: which one? The tasks follow from it. */
function CallTypeDialog({ deal, onClose, onMove }: { deal: Deal; onClose: () => void; onMove: (i: MoveDealInput) => void }) {
  const [callType, setCallType] = useState<CallType>(deal.callType || "commercial");
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogTitle>Next call</DialogTitle>
        <DialogDescription>After the demo, {deal.company.name || "they"} either want their team to see it, or want to talk price.</DialogDescription>
        <Field id="callType" label="Next call">
          <NativeSelect id="callType" value={callType} onChange={(e) => setCallType(e.target.value as CallType)}>
            {CALL_TYPES.map(([k, text, sub]) => <option key={k} value={k}>{text}: {sub}</option>)}
          </NativeSelect>
        </Field>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onMove({ to: "s9", callType })}>Move</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DemoDialog({ deal, onClose, onMove }: { deal: Deal; onClose: () => void; onMove: (i: MoveDealInput) => void }) {
  const [at, setAt] = useState(deal.demoDate || "");
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogTitle>Demo booked</DialogTitle>
        <DialogDescription>Add the demo time so the prep and Snapshot tasks land the day before.</DialogDescription>
        <Field id="demoAt" label="Demo date and time">
          <Input id="demoAt" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={() => onMove({ to: "s6" })}>Move without a date</Button>
          <Button variant="primary" onClick={() => onMove({ to: "s6", demoDate: at || undefined })}>Save and move</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
