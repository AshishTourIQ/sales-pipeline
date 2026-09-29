"use client";

import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useData } from "../../context/data-context";
import { useModule } from "../../context/module-context";
import { useUi, type DrawerTab } from "../../context/ui-context";
import { daysSince } from "../../lib/dates";
import { reachedIdx, stageDef } from "../../lib/pipeline";
import type { Deal } from "../../types";
import { Avatar, phaseClass } from "../common";
import { ActivityTab } from "./ActivityTab";
import { AiTab } from "./AiTab";
import { GuideTab } from "./GuideTab";
import { OverviewTab } from "./OverviewTab";
import { TasksTab } from "./TasksTab";

export function DealDrawer() {
  const ui = useUi();
  const { dealById } = useData();
  const deal = ui.openDealId ? dealById.get(ui.openDealId) : undefined;
  return (
    <Sheet open={!!deal} onOpenChange={(v) => { if (!v) ui.closeDeal(); }}>
      {deal && <DrawerBody deal={deal} />}
    </Sheet>
  );
}

function Stepper({ deal }: { deal: Deal }) {
  const ui = useUi();
  const { stages, label, canWrite, pipeline } = useData();
  const steps = stages.filter((s) => !s.lane);
  const cur = steps.findIndex((s) => s.key === deal.stage);
  const reached = reachedIdx(deal, pipeline);
  const inLane = deal.stage === "nurture" || deal.stage === "lost";
  return (
    <div role="group" aria-label="Stages" className="mt-4 flex gap-[3px]">
      {steps.map((s, i) => {
        const isCur = !inLane && s.key === deal.stage;
        const done = inLane ? i <= reached : i < cur;
        const lbl = label(s.key);
        return (
          <button
            key={s.key}
            type="button"
            className={cn("sp-step", phaseClass(s.phase), isCur ? "cur" : done && "done")}
            title={(s.key === deal.stage ? "Current: " : "Move to ") + lbl}
            aria-label={(s.key === deal.stage ? "Current stage: " : "Move to ") + lbl}
            disabled={!canWrite || s.key === deal.stage}
            onClick={() => ui.requestMove(deal.id, s.key)}
          >
            {s.num ?? s.name.charAt(0).toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

function DrawerBody({ deal }: { deal: Deal }) {
  const ui = useUi();
  const { aiEnabled } = useModule();
  const { pipeline, flags, openTasks, memberName, label, canWrite } = useData();
  const sd = stageDef(pipeline, deal.stage);
  const fl = flags.get(deal.id) ?? [];
  const days = daysSince(deal.stageChangedAt);
  const owner = memberName(deal.ownerId);
  const openN = openTasks.get(deal.id)?.length ?? 0;
  const actN = deal.activities.length + deal.history.length;

  const tabs: [DrawerTab, string, number | null][] = [["overview", "Overview", null], ["tasks", "Tasks", openN], ["activity", "Activity", actN]];
  // Drafting is a write (POST); viewers would only get errors
  const showAi = aiEnabled && canWrite;
  if (showAi) tabs.push(["ai", "AI drafts", null]);
  tabs.push(["guide", "How to work this stage", null]);
  const tab = ui.drawerTab === "ai" && !showAi ? "overview" : ui.drawerTab;

  return (
    <SheetContent aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()}>
      <div className="px-3.5 pt-3.5 tab:px-[22px] tab:pt-[18px]">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-ink-3">
              {pipeline?.name ?? "TourIQ"} deal {deal.sample && <Badge variant="sample">Sample</Badge>}
            </div>
            <SheetTitle className="mt-0.5 text-[21px] font-semibold leading-tight tracking-[-.015em]">{deal.company.name || "Unnamed company"}</SheetTitle>
            <SheetDescription asChild>
              <div className="mt-0.5 text-[13px] text-ink-2">
                {[deal.contact.name, deal.contact.title].filter(Boolean).join(", ") || "No contact yet"}
                {deal.contact.email && <>, <a className="text-info hover:underline" href={`mailto:${deal.contact.email}`}>{deal.contact.email}</a></>}
              </div>
            </SheetDescription>
          </div>
          <div className="flex flex-none items-center gap-1.5">
            {canWrite && (deal.stage === "lost" ? (
              <Button size="sm" className="max-[699px]:px-2" onClick={() => ui.requestMove(deal.id, "nurture")}>Reopen</Button>
            ) : deal.stage === "nurture" ? (
              <>
                <Button size="sm" className="max-[699px]:px-2" onClick={() => ui.requestMove(deal.id, "s4")}>Re-engage</Button>
                <Button size="sm" variant="danger" className="max-[699px]:px-2" onClick={() => ui.requestMove(deal.id, "lost")}>Lost</Button>
              </>
            ) : (
              <>
                <Button size="sm" className="max-[699px]:px-2" onClick={() => ui.requestMove(deal.id, "nurture")}>Nurture</Button>
                <Button size="sm" variant="danger" className="max-[699px]:px-2" onClick={() => ui.requestMove(deal.id, "lost")}>Lost</Button>
              </>
            ))}
            <Button variant="ghost" size="sm" aria-label="Close deal" onClick={ui.closeDeal}><X /></Button>
          </div>
        </div>
        <Stepper deal={deal} />
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[13px]">
          <Badge variant="brand">{label(deal.stage)}</Badge>
          <Badge>{days}{sd.limit ? ` of ${sd.limit}` : ""}{days === 1 && !sd.limit ? " day" : " days"} in stage</Badge>
          {owner && <Badge className="gap-1.5"><Avatar name={owner} size={18} />{owner}</Badge>}
          {fl.map((f) => <Badge key={f.text} variant={f.lvl}>{f.text}</Badge>)}
        </div>
      </div>

      <div role="tablist" className="sp-noscroll mt-3.5 flex gap-0.5 overflow-x-auto border-b border-line px-3.5 tab:px-[22px]">
        {tabs.map(([k, t, n]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => ui.setDrawerTab(k)}
            className="-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-2.5 pb-2.5 pt-[9px] font-medium text-ink-2 aria-selected:border-brand aria-selected:text-ink">
            {t}{n ? <span className="rounded-[10px] bg-sunk px-1.5 text-[11.5px] text-ink-3">{n}</span> : null}
          </button>
        ))}
      </div>

      <div key={`${deal.id}-${tab}`} className="flex-1 overflow-y-auto px-3.5 pb-6 pt-1 tab:px-[22px] tab:pb-7">
        {tab === "overview" && <OverviewTab deal={deal} />}
        {tab === "tasks" && <TasksTab deal={deal} />}
        {tab === "activity" && <ActivityTab deal={deal} />}
        {tab === "ai" && <AiTab deal={deal} />}
        {tab === "guide" && <GuideTab stage={deal.stage} description={stageDef(pipeline, deal.stage).description} />}
      </div>
    </SheetContent>
  );
}
