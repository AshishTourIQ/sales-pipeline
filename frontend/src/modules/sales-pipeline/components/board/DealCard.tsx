"use client";

import { ArrowRightLeft, Calendar } from "lucide-react";
import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CHECKLISTS, SCORE_MAX, TRACKS } from "../../config/template";
import { useData } from "../../context/data-context";
import { useUi } from "../../context/ui-context";
import { daysSince, dueLabel, fmtDay, today } from "../../lib/dates";
import { requirements } from "../../lib/gating";
import { tierVariant } from "../../lib/scoring";
import { isStuck, nearLimit, reachedOrPast, stageDef } from "../../lib/pipeline";
import type { Deal, Pipeline } from "../../types";
import { Avatar } from "../common";

const interestVariant = (i: string) => (i === "Hot" ? "hot" : i === "Warm" ? "warm" : i === "Cold" ? "cold" : "default");

/** "12d / 14d" style days-in-stage label, colored by the stage limit. */
export function DaysLabel({ deal, pipeline }: { deal: Deal; pipeline: Pipeline | null }) {
  const sd = stageDef(pipeline, deal.stage);
  const days = daysSince(deal.stageChangedAt);
  if (deal.stage === "nurture") {
    if (!deal.reengageDate) return <span>In nurture</span>;
    return <span className={deal.reengageDate < today() ? "font-medium text-danger" : ""}>Back {fmtDay(deal.reengageDate)}</span>;
  }
  if (deal.stage === "lost") return <span>{deal.lossReason || "Lost"}</span>;
  const cls = sd.limit ? (days > sd.limit ? "font-medium text-danger" : nearLimit(sd.limit, days) ? "font-medium text-warn" : "") : "";
  return (
    <span className={cls} title={`${days} days in this stage${sd.limit ? `, limit ${sd.limit}` : ""}`}>
      {days}d{sd.limit ? ` / ${sd.limit}d` : ""}
    </span>
  );
}

/**
 * "Move to…" on the card: drag-and-drop doesn't work on touch screens (booth tablets)
 * or from the keyboard. Goes through the same move checks and dialogs as a drop.
 */
function MoveMenu({ deal }: { deal: Deal }) {
  const { stages } = useData();
  const ui = useUi();
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Move ${deal.company.name || "this deal"} to another stage`} title="Move to…"
          onClick={stop} onKeyDown={stop} onPointerDown={stop}
          className="-my-1 -mr-1 grid size-7 flex-none place-items-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
          <ArrowRightLeft className="size-[14px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[60vh] w-[230px] overflow-y-auto" onClick={stop}>
        {stages.filter((s) => s.key !== deal.stage).map((s) => (
          <DropdownMenuItem key={s.key} onSelect={() => ui.requestMove(deal.id, s.key)}>
            {s.num != null ? `${s.num}. ` : ""}{s.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const DealCard = memo(function DealCard({ deal }: { deal: Deal }) {
  const { pipeline, flags, openTasks, memberName, canWrite, tasks } = useData();
  const ui = useUi();
  const fl = flags.get(deal.id) ?? [];
  const stuck = isStuck(fl);
  const nt = openTasks.get(deal.id)?.[0];
  const t0 = today();
  const pay = deal.payment?.status;
  const showPay = (!!deal.signedAt || reachedOrPast(pipeline, deal, "s11")) && pay && pay !== "Not invoiced";
  const owner = memberName(deal.ownerId);
  const f0 = fl[0];
  // Stage progress: blocking tasks of this stage + its checklist
  const stageTotal = !stageDef(pipeline, deal.stage).lane
    ? tasks.filter((t) => t.dealId === deal.id && t.stage === deal.stage && t.blocking !== false && !(t.done && t.autoClosed)).length + (CHECKLISTS[deal.stage]?.items.length ?? 0)
    : 0;
  const stageLeft = stageTotal ? requirements(deal, tasks).count : 0;

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={canWrite}
      data-deal={deal.id}
      onClick={() => ui.openDeal(deal.id)}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); ui.openDeal(deal.id); } }}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", deal.id); e.dataTransfer.effectAllowed = "move"; e.currentTarget.classList.add("opacity-45"); }}
      onDragEnd={(e) => e.currentTarget.classList.remove("opacity-45")}
      className={cn(
        "relative flex-none cursor-pointer rounded-[10px] border border-line bg-panel px-3 pb-2.5 pt-[11px] shadow-sh1 hover:border-line-2 hover:shadow-sh2",
        stuck && "border-l-[3px] border-l-danger pl-2.5",
      )}
    >
      <div className="text-sm font-semibold leading-[1.3]">{deal.company.name || "Unnamed company"}</div>
      <div className="mt-0.5 truncate text-[12.5px] text-ink-2">{[deal.contact.name, deal.contact.title].filter(Boolean).join(", ") || "No contact yet"}</div>
      <div className="mt-[9px] flex flex-wrap gap-1 [&>span]:whitespace-normal">
        {deal.sample && <Badge variant="sample">Sample</Badge>}
        {deal.event && <Badge variant="brand" title="The event this lead came from">{deal.event}</Badge>}
        {deal.company.category === "competitor" && <Badge variant="over" title="Never contact: no emails or AI drafts">Competitor</Badge>}
        {deal.stage === "offer" && deal.track && <Badge variant="brand" title="Offer sent: waiting for them to book a demo">{TRACKS.find(([k]) => k === deal.track)?.[1]}</Badge>}
        {deal.booth?.tier && <Badge variant={tierVariant(deal.booth.tier)} title={`Booth tier ${deal.booth.tier}: ${deal.booth.points} of ${SCORE_MAX} points`}>Tier {deal.booth.tier}</Badge>}
        {deal.interest && <Badge variant={interestVariant(deal.interest)}>{deal.interest}</Badge>}
        {deal.company.platform && <Badge>{deal.company.platform}</Badge>}
        {deal.fit > 0 && <Badge title="Fit score out of 5">Fit {deal.fit}</Badge>}
        {showPay && <Badge variant={pay === "Paid" ? "ok" : pay === "Late" ? "over" : "default"}>{pay}</Badge>}
        {f0 && <Badge variant={f0.lvl}>{f0.text}</Badge>}
        {stageTotal > 0 && (
          <Badge variant={stageLeft ? "default" : "ok"} title={stageLeft ? `${stageLeft} left before this deal can move on` : "Stage done"}>
            {stageTotal - stageLeft}/{stageTotal} done
          </Badge>
        )}
      </div>
      <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-[9px] text-xs text-ink-2">
        <Avatar name={owner} />
        {nt ? (
          <span title={nt.title} className={cn("inline-flex min-w-0 items-center gap-1 truncate", nt.due && nt.due < t0 ? "font-medium text-danger" : nt.due === t0 ? "font-medium text-warn" : "")}>
            <Calendar className="size-[13px] flex-none" />
            {dueLabel(nt.due).replace(/ days? overdue/, "d overdue")}
          </span>
        ) : deal.stage !== "lost" && deal.stage !== "s13" ? (
          <span className="font-medium text-warn">No next step</span>
        ) : null}
        <span className="ml-auto whitespace-nowrap"><DaysLabel deal={deal} pipeline={pipeline} /></span>
        {canWrite && <MoveMenu deal={deal} />}
      </div>
    </div>
  );
});
