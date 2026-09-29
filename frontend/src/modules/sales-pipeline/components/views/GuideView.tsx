"use client";

import { Badge } from "@/components/ui/badge";
import { GUIDE, guideFor, type GuideEntry, type GuideKey } from "../../config/template";
import { useData } from "../../context/data-context";
import { routesFor } from "../../lib/pipeline";
import { useUi } from "../../context/ui-context";
import type { StageKey } from "../../types";
import { Dot, Panel, PHASE_COLOR } from "../common";
import { stageSub } from "../board/BoardView";
import { GuideGrid } from "../drawer/GuideTab";

function GuideCard({ k, title, meta, color, g }: { k: GuideKey | StageKey; title: string; meta: string; color: string; g: GuideEntry }) {
  const { label, pipeline } = useData();
  const routes = ["f1", "f2", "f3", "g1"].includes(k) ? [] : routesFor(pipeline, k);
  return (
    <div className="mb-3 rounded-xl border border-line bg-panel px-[18px] py-4 shadow-sh1">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <Dot color={color} size={10} />
        <b className="text-[15px]">{title}</b>
        <span className="ml-auto text-[12.5px] text-ink-3">{meta}</span>
      </div>
      <GuideGrid g={g} labels="guide" />
      {routes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {routes.map(([t, to]) => <Badge key={t}>{t} → {label(to)}</Badge>)}
        </div>
      )}
    </div>
  );
}

export function GuideView() {
  const ui = useUi();
  const { stages, label, memberName } = useData();
  const tab = ui.sub.guide;
  const page = "max-w-[1120px] p-3.5 tab:px-[18px] tab:pb-7 tab:pt-4 desk:px-6 desk:pb-8 desk:pt-5";

  if (tab === "rules") {
    return (
      <div className={page}>
        <Panel className="mt-0" title="Rules at every step">
          <ul className="m-0 pl-[18px] leading-[1.7]">
            <li>AI drafts, a person sends. After a demo, nothing goes out automatically.</li>
            <li>Every deal has an owner, a next task with a date, and a lead source.</li>
            <li>Every stage change is saved with the date and who made it.</li>
            <li>Cold outreach goes from a separate warmed domain, never touriq.ai, with an unsubscribe line in every email. LinkedIn stays manual.</li>
            <li>Only promise what works today: FareHarbor is live, water operators are proven.</li>
            <li>Every lost deal needs a reason.</li>
          </ul>
        </Panel>
        <Panel title="Payment">
          <p className="m-0">Payment runs alongside the deal from Signed onward: the invoice is raised at signing, late payment is flagged to the owner, and it doesn&apos;t block onboarding.</p>
        </Panel>
      </div>
    );
  }
  if (tab === "funnel") {
    return (
      <div className={page}>
        {(["f1", "f2", "f3"] as const).map((k) => {
          const g = GUIDE[k];
          return <GuideCard key={k} k={k} title={g.t ?? k} meta={`${g.o}, ${g.l}`} color="var(--brand)" g={g} />;
        })}
      </div>
    );
  }
  return (
    <div className={page}>
      {stages.filter((s) => s.phase === tab).map((s) => (
        <GuideCard key={s.key} k={s.key} title={label(s.key)} meta={stageSub(s, memberName(s.ownerId)).replace("active clients", "")} color={PHASE_COLOR[s.phase]} g={guideFor(s.key, s.description)} />
      ))}
      {tab === "launch" && <GuideCard k="g1" title={GUIDE.g1.t ?? ""} meta={`${GUIDE.g1.o}, ${GUIDE.g1.l}`} color="var(--brand)" g={GUIDE.g1} />}
    </div>
  );
}
