"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useAddActivity } from "../../api/hooks";
import { ApiError } from "../../api/types";
import { useData } from "../../context/data-context";
import { useModule } from "../../context/module-context";
import { useUi } from "../../context/ui-context";
import { resolveStage } from "../../lib/pipeline";
import type { AiAction, Deal, ReplyTag, StageKey } from "../../types";
import { Field, Section } from "../common";

const AI_ACTIONS: { key: AiAction; label: string; stages: StageKey[] | null; paste?: string; opts?: boolean }[] = [
  { key: "brief", label: "Draft research brief", stages: ["s1", "s2", "s3", "s6", "pt1", "pt2", "ch1", "ch2", "rf1"] },
  { key: "first", label: "Draft first message", stages: ["s1", "s2", "s3", "s4", "nurture", "pt2", "pt3", "ch2", "ch3", "rf1", "rf2"] },
  { key: "follow", label: "Draft a follow-up", stages: ["s4", "s5", "offer", "pt3", "ch3", "rf2", "rf3"], opts: true },
  { key: "invite", label: "Draft the demo invite (with the deck)", stages: ["s6"] },
  { key: "tag", label: "Tag a reply", stages: ["s4", "s5"], paste: "Paste their reply" },
  { key: "summary", label: "Summarize call notes", stages: ["s6", "s7", "s8", "s9", "pilot", "pt3", "pt4", "pt5", "ch3", "ch4", "rf2", "rf3"], paste: "Paste your call notes or the transcript" },
  { key: "next", label: "Suggest the next step", stages: null },
];

const TAG_ROUTE: Record<ReplyTag, [string, StageKey]> = {
  interested: ["Interested", "s6"], not_now: ["Not now", "nurture"], wrong_person: ["Wrong person", "s2"], no: ["No", "lost"], unsubscribe: ["Unsubscribed", "lost"],
};

const AI_ERR: Record<string, string> = {
  rate_limited: "Too many drafts at once. Wait a minute and try again.",
  prompt_too_large: "That's too much text. Paste a shorter part.",
  refused: "Claude declined this one. Rephrase the notes and try again.",
  invalid_json: "The answer came back in the wrong shape. Try again.",
  timeout: "Claude took too long. Try again.",
  network: "Couldn't reach Claude. Try again in a moment.",
};

interface AiState { action: AiAction; running: boolean; text: string; tag?: ReplyTag; error: string }

export function AiTab({ deal }: { deal: Deal }) {
  const { api } = useModule();
  const ui = useUi();
  const { label, canWrite, pipeline } = useData();
  const addAct = useAddActivity();
  const [ai, setAi] = useState<AiState | null>(null);
  const [opt, setOpt] = useState("3");
  const [pasted, setPasted] = useState("");
  const [pasteErr, setPasteErr] = useState(false);
  const ctl = useRef<AbortController | null>(null);

  const actions = AI_ACTIONS.filter((a) => !a.stages || a.stages.includes(deal.stage));
  const def = ai ? AI_ACTIONS.find((a) => a.key === ai.action) : undefined;

  const run = async (action: AiAction, option?: string, text?: string) => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setAi({ action, running: true, text: "", error: "" });
    try {
      const r = await api.aiDraft(deal.id, { action, option, pasted: text }, c.signal);
      // The server already ends a truncated draft with a "Cut short" note
      setAi({ action, running: false, text: r.text, tag: r.tag, error: "" });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setAi({ action, running: false, text: "", error: code === "cancelled" ? "Stopped." : AI_ERR[code] ?? (e instanceof ApiError && e.status > 0 ? e.message : "Couldn't get a draft. Try again in a moment.") });
    }
  };

  const pick = (a: (typeof AI_ACTIONS)[number]) => {
    if (a.paste || a.opts) { setAi({ action: a.key, running: false, text: "", error: "" }); setPasted(""); setPasteErr(false); }
    else void run(a.key);
  };

  const submit = () => {
    if (!ai || !def) return;
    const p = pasted.trim();
    if (def.paste && !p) { setPasteErr(true); return; }
    if (p && (ai.action === "tag" || ai.action === "summary")) addAct.mutate({ dealId: deal.id, type: ai.action === "tag" ? "email" : "call", text: p });
    void run(ai.action, def.opts ? opt : undefined, p || undefined);
  };

  const copy = async () => {
    if (!ai) return;
    try { await navigator.clipboard.writeText(ai.text); toast("Copied."); } catch { toast("Select the text and copy it."); }
  };

  const tagRoute = ai?.tag ? TAG_ROUTE[ai.tag] : undefined;
  // The suggested stage may have been removed from this pipeline: use the next one that exists
  const route = tagRoute ? ([tagRoute[0], resolveStage(pipeline, tagRoute[1])] as const) : undefined;
  const asking = ai && def && (def.paste || def.opts) && !ai.running && !ai.text && !ai.error;

  return (
    <Section title="AI drafts" right={<span className="text-xs text-ink-3">Claude drafts; a person checks and sends</span>}>
      <div className="flex flex-wrap gap-1.5">
        {actions.map((a) => <Button key={a.key} size="sm" disabled={ai?.running} onClick={() => pick(a)}>{a.label}</Button>)}
      </div>

      {asking && (
        <>
          {def.opts && (
            <Field id="aiOpt" label="Which follow-up" className="mt-2.5">
              <NativeSelect id="aiOpt" className="w-auto" value={opt} onChange={(e) => setOpt(e.target.value)}>
                <option value="3">Day 3: one useful line about their tours, calendar link again</option>
                <option value="7">Day 7: proof, a video or the Modern Pricing Report</option>
                <option value="14">Day 14: short break-up message</option>
                <option value="reply">Answer to their reply</option>
              </NativeSelect>
            </Field>
          )}
          {def.paste && (
            <Field id="aiPaste" label={def.paste} className="mt-2.5">
              <Textarea id="aiPaste" rows={5} autoFocus value={pasted} onChange={(e) => { setPasted(e.target.value); setPasteErr(false); }} />
              {pasteErr && <div className="mt-1 text-[13px] text-danger">Paste the text first.</div>}
            </Field>
          )}
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" onClick={submit}>{def.label}</Button>
            <Button size="sm" onClick={() => setAi(null)}>Cancel</Button>
          </div>
        </>
      )}

      {ai && !asking && (
        <>
          <div aria-live="polite" className="mt-2.5 max-h-[440px] overflow-auto whitespace-pre-wrap rounded-[10px] border border-line bg-hover px-3.5 py-3 text-[13.5px]">
            {ai.running ? "Thinking…" : ai.error || ai.text}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {ai.running && <Button size="sm" onClick={() => ctl.current?.abort()}>Stop</Button>}
            {!ai.running && !ai.error && (
              <>
                <Button size="sm" onClick={copy}>Copy</Button>
                {canWrite && <Button size="sm" onClick={() => addAct.mutate({ dealId: deal.id, type: "ai", text: ai.text }, { onSuccess: () => toast("Saved to the timeline.") })}>Save to timeline</Button>}
                {route && canWrite && deal.stage !== route[1] && (
                  <Button size="sm" variant="primary" onClick={() => {
                    if (ai.tag === "unsubscribe") toast("Don't email this contact or domain again.");
                    setAi(null);
                    ui.requestMove(deal.id, route[1]);
                  }}>
                    {route[0]} → {label(route[1])}
                  </Button>
                )}
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => setAi(null)}>Clear</Button>
          </div>
        </>
      )}
    </Section>
  );
}
