"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useAddTouchpoint } from "../../api/hooks";
import { SYSTEM_TOUCHPOINT_KINDS, TOUCHPOINT_KINDS, TRACKS, touchpointLabel } from "../../config/template";
import { useData } from "../../context/data-context";
import { fmtDay } from "../../lib/dates";
import type { Deal, TouchpointKind } from "../../types";
import { Field, Grid, Section } from "../common";

const SOURCE_LABEL = { booth: "Booth", intake: "Tool", pipeline: "Pipeline", manual: "Added by hand" } as const;
const href = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

/** What the lead has done on the way to a demo: game, analysis, audit, demo steps. */
export function JourneySection({ deal }: { deal: Deal }) {
  const { canWrite } = useData();
  const [adding, setAdding] = useState(false);
  const steps = [...(deal.touchpoints ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  const track = TRACKS.find(([k]) => k === deal.track)?.[1];
  if (!steps.length && !track && !canWrite) return null;
  return (
    <Section
      title="Journey"
      right={<>
        {track && <Badge variant="brand">{track}</Badge>}
        {canWrite && !adding && <Button size="sm" onClick={() => setAdding(true)}>Add a step</Button>}
      </>}
    >
      {steps.length ? (
        <ol className="m-0 list-none p-0">
          {steps.map((t) => (
            <li key={t.id} className="relative border-l-2 border-line pb-3 pl-4 last:pb-0">
              <span aria-hidden className="absolute -left-[5px] top-1.5 size-2 rounded-full bg-brand" />
              <div className="font-medium">
                {touchpointLabel(t.kind)}
                {t.score && <span className="font-normal text-ink-2"> · score {t.score}</span>}
              </div>
              <div className="text-xs text-ink-3">
                {fmtDay(t.at)} · {SOURCE_LABEL[t.source] ?? t.source}{t.byName ? ` · ${t.byName}` : ""}
                {t.detail && <> · {t.detail}</>}
              </div>
              {t.link && <a className="text-[13px] text-info hover:underline" href={href(t.link)} target="_blank" rel="noopener noreferrer">Open the report</a>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="m-0 text-ink-3">No steps yet. The booth form, the tools and demo moves add them here.</p>
      )}
      {adding && <AddStep deal={deal} onDone={() => setAdding(false)} />}
    </Section>
  );
}

function AddStep({ deal, onDone }: { deal: Deal; onDone: () => void }) {
  const add = useAddTouchpoint();
  const [kind, setKind] = useState<TouchpointKind>("audit_report_sent");
  const [link, setLink] = useState("");
  const [score, setScore] = useState("");
  return (
    <div className="mt-3 rounded-[10px] border border-line bg-hover px-3 py-3">
      <Grid>
        <Field id="tp_kind" label="Step">
          <NativeSelect id="tp_kind" value={kind} onChange={(e) => setKind(e.target.value as TouchpointKind)}>
            {TOUCHPOINT_KINDS.filter(([k]) => !SYSTEM_TOUCHPOINT_KINDS.includes(k)).map(([k, text]) => <option key={k} value={k}>{text}</option>)}
          </NativeSelect>
        </Field>
        {kind === "game_played" ? (
          <Field id="tp_score" label="Game score"><Input id="tp_score" inputMode="numeric" value={score} onChange={(e) => setScore(e.target.value)} /></Field>
        ) : (
          <Field id="tp_link" label="Report link (optional)"><Input id="tp_link" type="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} /></Field>
        )}
      </Grid>
      <div className="mt-2.5 flex gap-2">
        <Button size="sm" variant="primary" disabled={add.isPending} onClick={() => add.mutate(
          { dealId: deal.id, input: { kind, link: link.trim() ? href(link.trim()) : "", score: kind === "game_played" ? score.trim() : "" } },
          { onSuccess: onDone },
        )}>
          Add step
        </Button>
        <Button size="sm" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}
