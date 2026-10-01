"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { errorMessage, useUpdateDeal } from "../../api/hooks";
import { BOOTH_QUESTIONS, OFFERS, VISITOR_TYPES } from "../../config/template";
import { useData } from "../../context/data-context";
import { optionLabel, scoreBooth } from "../../lib/scoring";
import type { Deal, OfferKey, VisitorType } from "../../types";
import { Choice, TierCard } from "../booth/BoothDialog";
import { CheckRow, Field, Grid, KV, Section } from "../common";

const visitorName = (v: string) => VISITOR_TYPES.find((x) => x[0] === v)?.[1] ?? v;
const offerName = (o: string) => OFFERS.find((x) => x[0] === o)?.[1] ?? "";

/** What the booth sheet recorded, and re-scoring it. Re-scoring never moves the deal. */
export function BoothSection({ deal }: { deal: Deal }) {
  const { canWrite, memberName } = useData();
  const [editing, setEditing] = useState(false);
  const b = deal.booth;
  if (!b) return null;
  return (
    <Section title="Booth score" right={canWrite && !editing ? <Button size="sm" onClick={() => setEditing(true)}>Re-score</Button> : undefined}>
      {editing ? <BoothEditor deal={deal} onDone={() => setEditing(false)} /> : (
        <>
          {b.visitor === "operator" ? <TierCard score={b} /> : (
            <p className="m-0 text-ink-2">{visitorName(b.visitor)}{b.tier ? `, tier ${b.tier}` : ""}: not scored.</p>
          )}
          <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-x-[18px] gap-y-3">
            <KV label="Visitor" value={visitorName(b.visitor)} />
            <KV label="Offer given" value={offerName(b.offer)} />
            <KV label="Game" value={b.gamePlayed ? `Played${b.gameScore ? `, score ${b.gameScore}` : ""}` : "Not played"} />
            <KV label="Met by" value={memberName(deal.metById)} />
            <KV label="Met at" value={b.metAt.replace("T", " ")} />
            <KV label="Destination" value={b.destination} />
            <KV label="What they run" value={b.runs} />
            <KV label="Pricing tool" value={b.pricingTool} />
          </div>
          {b.analysis && (
            <div className="mt-3 rounded-[10px] border border-line px-3 py-2.5 text-[13px]">
              <b className="block font-semibold">Comparative analysis ({b.analysis.status === "requested" ? "waiting for the report" : b.analysis.status})</b>
              <div className="mt-1 text-ink-2">
                {b.analysis.website
                  ? <><a className="text-info hover:underline" href={b.analysis.website} target="_blank" rel="noopener noreferrer">{b.analysis.website}</a>, compared with their top competitors</>
                  : "No website given: add it so the report can run"}
              </div>
            </div>
          )}
          {b.visitor === "operator" && (
            <dl className="m-0 mt-3 grid grid-cols-[minmax(130px,auto)_1fr] gap-x-3 gap-y-1 text-[13px]">
              {BOOTH_QUESTIONS.map((q) => (
                <div key={q.key} className="contents">
                  <dt className="text-ink-3">{q.label}</dt>
                  <dd className="m-0">{optionLabel(q.key, b.answers[q.key] ?? "") || <span className="text-ink-3">Not answered</span>}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </Section>
  );
}

function BoothEditor({ deal, onDone }: { deal: Deal; onDone: () => void }) {
  const { team } = useData();
  const update = useUpdateDeal();
  const b = deal.booth!;
  const [visitor, setVisitor] = useState<VisitorType>(b.visitor);
  const [answers, setAnswers] = useState<Record<string, string>>(b.answers);
  const [offer, setOffer] = useState<OfferKey | "">(b.offer);
  const [game, setGame] = useState({ played: b.gamePlayed, score: b.gameScore });
  const [metById, setMetById] = useState(deal.metById);
  const [err, setErr] = useState("");
  const score = scoreBooth(visitor, answers);

  const save = () => {
    setErr("");
    update.mutate(
      { deal, patch: { metById, booth: { visitor, answers: visitor === "operator" ? answers : {}, offer, gamePlayed: game.played, gameScore: game.played ? game.score : "" } } },
      { onSuccess: () => { toast("Booth score saved. The deal stays where it is."); onDone(); }, onError: (e) => setErr(`Not saved: ${errorMessage(e)}`) },
    );
  };

  return (
    <>
      <Grid>
        <Field id="bs_vis" label="Visitor">
          <NativeSelect id="bs_vis" value={visitor} onChange={(e) => setVisitor(e.target.value as VisitorType)}>
            {VISITOR_TYPES.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
          </NativeSelect>
        </Field>
        <Field id="bs_offer" label="Offer given">
          <NativeSelect id="bs_offer" value={offer} onChange={(e) => setOffer(e.target.value as OfferKey | "")}>
            <option value="">None</option>
            {OFFERS.map(([k, text]) => <option key={k} value={k}>{text}</option>)}
          </NativeSelect>
        </Field>
        <Field id="bs_met" label="Met by">
          <NativeSelect id="bs_met" value={metById} onChange={(e) => setMetById(e.target.value)}>
            <option value="">Not set</option>
            {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </NativeSelect>
        </Field>
      </Grid>
      {visitor === "operator" && (
        <div className="mt-3 space-y-3">
          {BOOTH_QUESTIONS.map((q) => (
            <fieldset key={q.key} className="m-0 border-0 p-0">
              <legend className="mb-1 text-[13px] font-semibold">{q.label}</legend>
              <div className="grid grid-cols-1 gap-1.5 min-[480px]:grid-cols-2">
                {q.options.map((o) => (
                  <Choice key={o.key} selected={answers[q.key] === o.key} onClick={() => setAnswers((a) => {
                    const n = { ...a };
                    if (n[q.key] === o.key) delete n[q.key]; else n[q.key] = o.key;
                    return n;
                  })}>
                    {o.label}
                  </Choice>
                ))}
              </div>
            </fieldset>
          ))}
          <TierCard score={score} />
        </div>
      )}
      <div className="mt-3">
        <CheckRow checked={game.played} onChange={(played) => setGame((g) => ({ ...g, played }))}>Played the game</CheckRow>
        {game.played && (
          <Field id="bs_game" label="Game score" className="mt-1 max-w-[200px]">
            <Input id="bs_game" inputMode="numeric" value={game.score} onChange={(e) => setGame((g) => ({ ...g, score: e.target.value }))} />
          </Field>
        )}
      </div>
      {err && <div role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</div>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="primary" disabled={update.isPending} onClick={save}>{update.isPending ? "Saving…" : "Save score"}</Button>
        <Button size="sm" onClick={onDone}>Cancel</Button>
      </div>
    </>
  );
}
