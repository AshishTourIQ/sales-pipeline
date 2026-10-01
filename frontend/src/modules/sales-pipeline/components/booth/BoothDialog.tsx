"use client";

import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { errorMessage, useCreateBoothLead } from "../../api/hooks";
import { BOOTH_QUESTIONS, NOT_PROSPECT_VISITORS, OFFERS, PARTNER_VISITORS, SCORE_MAX, sourceForEvent, VISITOR_TYPES } from "../../config/template";
import { useData } from "../../context/data-context";
import { useModule } from "../../context/module-context";
import { useUi } from "../../context/ui-context";
import { boothEntry, defaultOffer, followupKey, localNow, newClientId } from "../../lib/booth";
import { enqueue, isRetryable } from "../../lib/booth-queue";
import { addDays, fmtDay } from "../../lib/dates";
import { scoreBooth, type Score } from "../../lib/scoring";
import type { CreateBoothLeadInput, OfferKey, VisitorType } from "../../types";
import { CheckRow, Field, Grid } from "../common";
import { EventPicker } from "../EventPicker";
import { DuplicateWarning } from "../dialogs/DuplicateWarning";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STEPS = ["Contact", "Visitor", "Score", "Result"] as const;

interface Form {
  /** One per form, so pressing Save again (or the offline retry) never makes a second deal */
  clientId: string;
  metAt: string; metById: string; event: string;
  company: string; name: string; email: string; phone: string; destination: string; runs: string; pricingTool: string;
  visitor: VisitorType; answers: Record<string, string>;
  offer: OfferKey | ""; gamePlayed: boolean; gameScore: string; bookedAt: string;
  followupOwnerId: string; followupDue: string; note: string;
  /** Tier C: their website for the comparative analysis */
  website: string;
}
/** Fields the person changed by hand: their choice wins over the tier's default. */
interface Touched { offer: boolean; owner: boolean; due: boolean }

/** A big tap target: one answer of a row, or one visitor type. */
export function Choice({ selected, onClick, children, sub }: { selected: boolean; onClick: () => void; children: ReactNode; sub?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex min-h-[44px] items-center gap-2 rounded-[10px] border border-line-2 bg-panel px-3 py-2 text-left text-[13.5px] font-medium text-ink",
        "hover:border-ink-3 aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand-text",
      )}
    >
      <span className="min-w-0 flex-1">
        {children}
        {sub && <span className="block text-xs font-normal text-ink-3">{sub}</span>}
      </span>
      {selected && <Check aria-hidden className="size-4 flex-none" />}
    </button>
  );
}

export function TierCard({ score, className }: { score: Score; className?: string }) {
  const tone = score.tier === "A" ? "border-ok/30 bg-ok-soft text-ok" : score.tier === "B" ? "border-info/30 bg-info-soft text-info"
    : score.tier === "C" ? "border-warn/30 bg-warn-soft text-warn" : "border-line bg-sunk text-ink-2";
  return (
    <div className={cn("flex items-center gap-4 rounded-xl border px-4 py-3", tone, className)} aria-live="polite">
      <b className="text-[44px] font-bold leading-none tabular-nums" aria-label={`Tier ${score.tier}`}>{score.tier}</b>
      <div className="min-w-0 text-ink">
        <div className="text-[15px] font-semibold">Tier {score.tier}</div>
        <div className="text-[13px] text-ink-2">
          {score.points} of {SCORE_MAX} points
          {score.capped && <> · capped at {score.tier} (was {score.tierBeforeCap}): not the decider or booking system not connected</>}
          {!score.complete && <> · some questions not answered</>}
        </div>
      </div>
    </div>
  );
}

export function BoothDialog() {
  const ui = useUi();
  const { pipeline, team, settings, me, label, memberName } = useData();
  const create = useCreateBoothLead();
  const scope = useModule().currentUser?.id ?? "";
  const coRef = useRef<HTMLInputElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<{ company?: boolean; email?: boolean; save?: string }>({});
  const teamIds = useMemo(() => new Set(team.map((m) => m.id)), [team]);

  const blank = (keep?: Pick<Form, "metById" | "event">): Form => ({
    clientId: newClientId(), metAt: localNow(), metById: keep?.metById ?? (me && teamIds.has(me.id) ? me.id : ""), event: keep?.event ?? ui.lastEvent,
    company: "", name: "", email: "", phone: "", destination: "", runs: "", pricingTool: "",
    visitor: "operator", answers: {}, offer: "", gamePlayed: false, gameScore: "", bookedAt: "",
    followupOwnerId: "", followupDue: "", note: "",
    website: "",
  });
  const [f, setF] = useState<Form>(() => blank());
  const [touched, setTouched] = useState<Touched>({ offer: false, owner: false, due: false });
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));

  useEffect(() => {
    if (ui.boothOpen) { setF(blank()); setTouched({ offer: false, owner: false, due: false }); setStep(0); setErr({}); }
  }, [ui.boothOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { topRef.current?.scrollIntoView({ block: "start" }); }, [step]);

  // Everything the tier decides, unless the person changed it by hand
  const score = scoreBooth(f.visitor, f.answers);
  const operator = f.visitor === "operator";
  const offer: OfferKey | "" = touched.offer ? f.offer : defaultOffer(f.visitor, score.tier, f.gamePlayed);
  const fk = followupKey(f.visitor, score.tier);
  const def = fk ? settings.boothFollowup[fk] : null;
  const ownerId = touched.owner ? f.followupOwnerId : def && teamIds.has(def.ownerId) ? def.ownerId : "";
  const due = touched.due ? f.followupDue : def ? addDays(def.days) : "";
  const source = sourceForEvent(f.event);
  const entry = boothEntry(pipeline, f.visitor, offer, source);
  const answered = Object.keys(f.answers).length;
  const lastStep = STEPS.length - 1;

  const next = () => {
    if (step === 0) {
      const company = !f.company.trim();
      const email = !!f.email.trim() && !EMAIL_RE.test(f.email.trim());
      if (company || email) { setErr({ company, email }); if (company) coRef.current?.focus(); return; }
    }
    // Only operators are scored
    setStep((s) => (s === 1 && !operator ? lastStep : Math.min(lastStep, s + 1)));
  };
  const back = () => setStep((s) => (s === lastStep && !operator ? 1 : Math.max(0, s - 1)));

  const save = async (again: boolean) => {
    if (!pipeline || create.isPending) return;
    if (!f.company.trim()) { setStep(0); setErr({ company: true }); return; }
    const input: CreateBoothLeadInput = {
      pipelineId: pipeline.id, clientId: f.clientId, source, event: f.event.trim(), metAt: f.metAt, metById: f.metById,
      company: f.company.trim(), contact: { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() },
      destination: f.destination.trim(), runs: f.runs.trim(), pricingTool: f.pricingTool.trim(),
      visitor: f.visitor, answers: operator ? f.answers : {}, offer, gamePlayed: f.gamePlayed, gameScore: f.gamePlayed ? f.gameScore.trim() : "",
      bookedAt: offer === "demo_booked" || offer === "audit" ? f.bookedAt : "",
      followupOwnerId: fk ? ownerId : "", followupDue: fk ? due : "", note: f.note.trim(),
      ...(offer === "analysis" ? { website: f.website.trim() } : {}),
    };
    const done = () => {
      if (again) {
        setF(blank({ metById: f.metById, event: f.event }));
        setTouched({ offer: false, owner: false, due: false });
        setStep(0);
        setTimeout(() => coRef.current?.focus(), 0);
      } else ui.closeBooth();
    };
    setErr({});
    if (input.event) ui.setLastEvent(input.event);
    try {
      const r = await create.mutateAsync(input);
      const t = r.deal.booth?.tier;
      toast(`${r.deal.company.name} saved${t ? `: tier ${t}` : ""}, ${label(r.deal.stage)}.`, r.notices?.length ? { description: r.notices.join(" ") } : undefined);
      done();
    } catch (e) {
      // Offline, signed out, rate-limited or a server error: keep it on this device and
      // send it again later. The same clientId means a save that did land isn't doubled.
      if (isRetryable(e)) {
        if (enqueue(scope, input)) { toast("Couldn't reach the server. The lead is saved on this device and will sync by itself."); done(); }
        else setErr({ save: "No connection, and this device can't store the lead. Keep the form open and try again." });
        return;
      }
      setErr({ save: `Not saved: ${errorMessage(e)}` });
    }
  };

  const routeText = NOT_PROSPECT_VISITORS.includes(f.visitor)
    ? `Filed under Lost as "Not a prospect".${f.visitor === "competitor" ? " Marked do-not-contact: no emails or drafts, ever." : " No follow-up."}`
    : PARTNER_VISITORS.includes(f.visitor) ? "Filed under Nurture as a partner hand-off, with a hand-off task."
      : f.visitor === "press" ? "Filed under Nurture as a press hand-off, with a follow-up task." : `Goes to ${label(entry)}.`;

  return (
    <Dialog open={ui.boothOpen} onOpenChange={(v) => { if (!v) ui.closeBooth(); }}>
      <DialogContent onOpenAutoFocus={(e) => { e.preventDefault(); coRef.current?.focus(); }} className="min-[700px]:w-[min(720px,calc(100vw-32px))]">
        <div ref={topRef} />
        <DialogTitle>Booth lead</DialogTitle>
        <DialogDescription>One visitor per form. Saved straight into the pipeline.</DialogDescription>

        <ol className="-mt-1 mb-4 flex gap-1.5" aria-label="Steps">
          {STEPS.map((s, i) => {
            const skipped = i === 2 && !operator;
            return (
              <li key={s} className="flex-1">
                <button type="button" disabled={skipped || (i > step && !f.company.trim())} onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}
                  className="w-full text-left disabled:opacity-40">
                  <span className={cn("block h-1 rounded-full", i <= step ? "bg-brand" : "bg-sunk")} />
                  <span className={cn("mt-1 block text-xs font-medium", i === step ? "text-ink" : "text-ink-3")}>{skipped ? `${s} (skipped)` : s}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {step === 0 && (
          <div>
            <Grid>
              <Field id="b_co" label="Company">
                <Input id="b_co" ref={coRef} autoComplete="organization" aria-invalid={err.company || undefined} value={f.company}
                  onChange={(e) => { set({ company: e.target.value }); setErr({}); }} />
                {err.company && <div className="mt-1 text-[13px] text-danger">Add the company name to continue.</div>}
              </Field>
              <Field id="b_name" label="First and last name"><Input id="b_name" autoComplete="name" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field id="b_email" label="Email">
                <Input id="b_email" type="email" inputMode="email" autoComplete="email" aria-invalid={err.email || undefined} value={f.email}
                  onChange={(e) => { set({ email: e.target.value }); setErr({}); }} />
                {err.email && <div className="mt-1 text-[13px] text-danger">Check the email address, or leave it empty.</div>}
              </Field>
              <Field id="b_phone" label="Phone"><Input id="b_phone" type="tel" autoComplete="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
              <Field id="b_dest" label="Destination / location"><Input id="b_dest" value={f.destination} onChange={(e) => set({ destination: e.target.value })} /></Field>
              <Field id="b_runs" label="What they run"><Input id="b_runs" placeholder="Sunset cruises, jet ski" value={f.runs} onChange={(e) => set({ runs: e.target.value })} /></Field>
              <Field id="b_tool" label="Pricing tool used / looked at"><Input id="b_tool" value={f.pricingTool} onChange={(e) => set({ pricingTool: e.target.value })} /></Field>
            </Grid>
            <DuplicateWarning company={f.company} email={f.email} />
            <div className="mt-4 border-t border-line pt-3">
              <Grid>
                <Field id="b_staff" label="Staff name">
                  <NativeSelect id="b_staff" value={f.metById} onChange={(e) => set({ metById: e.target.value })}>
                    <option value="">Choose who met them</option>
                    {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </NativeSelect>
                </Field>
                <Field id="b_at" label="Date and time"><Input id="b_at" type="datetime-local" value={f.metAt} onChange={(e) => set({ metAt: e.target.value })} /></Field>
                <Field id="b_event" label="Event">
                  <EventPicker id="b_event" value={f.event} onChange={(event) => set({ event })} />
                </Field>
              </Grid>
            </div>
          </div>
        )}

        {step === 1 && (
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 text-sm font-semibold">Who is this visitor?</legend>
            <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
              {VISITOR_TYPES.map(([v, text, sub]) => (
                <Choice key={v} selected={f.visitor === v} onClick={() => set({ visitor: v })} sub={sub}>{text}</Choice>
              ))}
            </div>
          </fieldset>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="m-0 text-[13px] text-ink-2">Tick one answer per row. Tap again to clear. Skip anything you don&apos;t know.</p>
            {BOOTH_QUESTIONS.map((q) => (
              <fieldset key={q.key} className="m-0 border-0 p-0">
                <legend className="mb-1.5 text-sm font-semibold">{q.label}</legend>
                <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 min-[700px]:grid-cols-4">
                  {q.options.map((o) => (
                    <Choice key={o.key} selected={f.answers[q.key] === o.key} onClick={() => {
                      const answers = { ...f.answers };
                      if (answers[q.key] === o.key) delete answers[q.key]; else answers[q.key] = o.key;
                      set({ answers });
                    }}>
                      {o.label}
                    </Choice>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        )}

        {step === 3 && (
          <div>
            {operator ? <TierCard score={score} /> : (
              <div className="rounded-xl border border-line bg-sunk px-4 py-3">
                <div className="text-[15px] font-semibold">{VISITOR_TYPES.find((v) => v[0] === f.visitor)?.[1]}</div>
                <div className="text-[13px] text-ink-2">{score.tier ? `Tier ${score.tier}. ` : ""}{routeText}</div>
              </div>
            )}

            {operator && (
              <fieldset className="m-0 mt-4 border-0 p-0">
                <legend className="mb-1.5 text-sm font-semibold">Offer given</legend>
                <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
                  {OFFERS.map(([k, text]) => (
                    <Choice key={k} selected={offer === k} onClick={() => { setTouched((t) => ({ ...t, offer: true })); set({ offer: k }); }}
                      sub={score.tier && defaultOffer("operator", score.tier, false) === k ? `Suggested for tier ${score.tier}` : undefined}>
                      {text}
                    </Choice>
                  ))}
                </div>
              </fieldset>
            )}

            {offer === "analysis" && (
              <fieldset className="m-0 mt-4 rounded-xl border border-line px-3.5 py-3">
                <legend className="px-1 text-sm font-semibold">For the comparative analysis</legend>
                <p className="m-0 mb-2 text-[13px] text-ink-2">We compare their website with their top competitors (found automatically). The report is prepared after you save.</p>
                <Field id="b_web" label="Their website">
                  <Input id="b_web" type="url" inputMode="url" placeholder="harborjettours.com" value={f.website} onChange={(e) => set({ website: e.target.value })} />
                </Field>
              </fieldset>
            )}

            <div className="mt-4">
              <CheckRow checked={f.gamePlayed} onChange={(gamePlayed) => set({ gamePlayed })}>Played the game</CheckRow>
              {f.gamePlayed && (
                <Field id="b_game" label="Game score" className="mt-1 max-w-[200px]">
                  <Input id="b_game" inputMode="numeric" value={f.gameScore} onChange={(e) => set({ gameScore: e.target.value })} />
                </Field>
              )}
              {offer === "game" && !f.gamePlayed && (
                <p className={cn("m-0 mt-1 text-[13px]", f.email.trim() ? "text-ink-2" : "text-warn")}>
                  {f.email.trim() ? `When you save, ${f.email.trim()} gets an email with the game link.` : "Add their email (step 1) so we can send them the game link."}
                </p>
              )}
            </div>

            <Grid className="mt-3">
              {(offer === "demo_booked" || offer === "audit") && (
                <Field id="b_booked" label={offer === "audit" ? "Audit date booked" : "Demo date booked"}>
                  <Input id="b_booked" type="datetime-local" value={f.bookedAt} onChange={(e) => set({ bookedAt: e.target.value })} />
                </Field>
              )}
              {fk && (
                <>
                  <Field id="b_fowner" label="Follow-up owner">
                    <NativeSelect id="b_fowner" value={ownerId} onChange={(e) => { setTouched((t) => ({ ...t, owner: true })); set({ followupOwnerId: e.target.value }); }}>
                      <option value="">Nobody yet</option>
                      {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </NativeSelect>
                  </Field>
                  <Field id="b_fdue" label="Follow-up due">
                    <Input id="b_fdue" type="date" value={due} onChange={(e) => { setTouched((t) => ({ ...t, due: true })); set({ followupDue: e.target.value }); }} />
                  </Field>
                </>
              )}
            </Grid>

            <Field id="b_note" label="Notes: busiest days, biggest pain, what drives demand" className="mt-3">
              <Textarea id="b_note" rows={3} value={f.note} onChange={(e) => set({ note: e.target.value })} />
            </Field>

            <p className="m-0 mt-3 text-[13px] text-ink-2">
              {operator && routeText}
              {fk && (ownerId ? ` ${memberName(ownerId)} follows up${due ? ` by ${fmtDay(due)}` : ""}.` : " Nobody is set to follow up.")}
            </p>
          </div>
        )}

        {err.save && <div role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err.save}</div>}

        <DialogFooter className="items-center">
          {step === 2 && (
            <span className="mr-auto text-[13px] text-ink-2" aria-live="polite">
              {answered} of {BOOTH_QUESTIONS.length} answered{answered ? ` · ${score.points} points, tier ${score.tier} so far` : ""}
            </span>
          )}
          {step > 0 ? <Button onClick={back}>Back</Button> : <Button onClick={ui.closeBooth}>Cancel</Button>}
          {step < lastStep ? (
            <Button variant="primary" onClick={next}>{step === 2 ? "See the tier" : "Next"}</Button>
          ) : (
            <>
              <Button disabled={create.isPending} onClick={() => void save(false)}>Save and close</Button>
              <Button variant="primary" disabled={create.isPending} onClick={() => void save(true)}>{create.isPending ? "Saving…" : "Save and next visitor"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
