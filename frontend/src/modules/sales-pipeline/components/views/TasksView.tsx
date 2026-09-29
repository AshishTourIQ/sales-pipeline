"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useDeleteStageTask, useStageTasks } from "../../api/hooks";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";
import type { StageTaskTemplate } from "../../types";
import { useData } from "../../context/data-context";
import { useUi } from "../../context/ui-context";
import { taskBuckets } from "../../lib/selectors";
import type { Deal, Task } from "../../types";
import { EmptyBox } from "../common";
import { TaskRow } from "../tasks/TaskRow";

const Group = ({ title, list, note }: { title: string; list: Task[]; note?: string }) =>
  list.length ? (
    <>
      <div className="mb-2 mt-[22px] flex items-baseline gap-2 text-[13px] font-semibold first:mt-1">
        {title}<span className="font-normal text-ink-3">{list.length}{note ? `, ${note}` : ""}</span>
      </div>
      <div className="rounded-xl border border-line bg-panel px-4 py-0.5 shadow-sh1">{list.map((t) => <TaskRow key={t.id} task={t} showDeal />)}</div>
    </>
  ) : null;

export function TasksView() {
  const ui = useUi();
  const { tasks, deals, flags, openTasks, label, memberName } = useData();
  const b = taskBuckets(tasks, deals, flags, openTasks, ui.taskOwnerId);
  const tab = ui.sub.tasks;

  const dealRow = (d: Deal, text: string, cls: string) => (
    <div key={d.id} className="flex items-start gap-2.5 border-t border-line py-2.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <button type="button" className="text-info hover:underline" onClick={() => ui.openDeal(d.id)}>{d.company.name || "Deal"}</button>
        <div className="mt-0.5 flex flex-wrap gap-2.5 text-xs text-ink-3">
          <span>{label(d.stage)}</span><span className={cls}>{text}</span><span>{memberName(d.ownerId) || "No owner"}</span>
        </div>
      </div>
      <Button size="sm" onClick={() => ui.openDeal(d.id)}>Open</Button>
    </div>
  );

  return (
    <div className="max-w-[1120px] p-3.5 tab:px-[18px] tab:pb-7 tab:pt-4 desk:px-6 desk:pb-8 desk:pt-5">
      {tab === "due" && (
        <>
          <Group title="Overdue" list={b.overdue} />
          <Group title="Today" list={b.today} />
          {!b.due.length && <EmptyBox title="Nothing due right now" text="Tasks show up here on the day they're due. Check Upcoming for what's next." />}
        </>
      )}
      {tab === "upcoming" && (
        <>
          <Group title="Next 7 days" list={b.next7} />
          <Group title="Later" list={b.later} />
          <Group title="No date" list={b.noDate} note="give these a date" />
          {!b.upcoming.length && <EmptyBox title="No upcoming tasks" text="Tasks are added automatically when deals move, or you can add your own." />}
        </>
      )}
      {tab === "attention" && (
        <>
          {b.stuck.length > 0 && (
            <>
              <div className="mb-2 mt-1 flex items-baseline gap-2 text-[13px] font-semibold">Past the stage time limit<span className="font-normal text-ink-3">{b.stuck.length}</span></div>
              <div className="rounded-xl border border-line bg-panel px-4 py-0.5 shadow-sh1">
                {b.stuck.map((d) => dealRow(d, flags.get(d.id)?.find((f) => f.lvl === "over")?.text ?? "", "font-medium text-danger"))}
              </div>
            </>
          )}
          {b.noNext.length > 0 && (
            <>
              <div className="mb-2 mt-[22px] flex items-baseline gap-2 text-[13px] font-semibold">No next step with a date<span className="font-normal text-ink-3">{b.noNext.length}</span></div>
              <div className="rounded-xl border border-line bg-panel px-4 py-0.5 shadow-sh1">
                {b.noNext.map((d) => dealRow(d, "Add a task so it doesn't stall", "font-medium text-warn"))}
              </div>
            </>
          )}
          {!b.attention.length && <EmptyBox title="Every deal is on track" text="Deals appear here when they pass a stage's time limit or have no next step." />}
        </>
      )}
      {tab === "stage" && <StageTasksList />}
      {tab === "done" && (
        <>
          <Group title="Recently done" list={b.done} />
          {!b.done.length && <EmptyBox title="Nothing done yet" text="Ticked-off tasks appear here." />}
        </>
      )}
    </div>
  );
}


/** Stage tasks: added to every deal of that person in that stage, now and later. */
function StageTasksList() {
  const ui = useUi();
  const { pipeline, stages, label, memberName, tasks, canAdmin } = useData();
  const list = useStageTasks(pipeline?.id ?? null).data ?? [];
  const del = useDeleteStageTask();
  const [confirm, setConfirm] = useState<StageTaskTemplate | null>(null);
  const shown = ui.taskOwnerId ? list.filter((t) => t.ownerId === ui.taskOwnerId) : list;
  const openCopies = (t: StageTaskTemplate) => tasks.filter((x) => x.templateId === t.id && !x.done).length;

  const hidden = list.length - shown.length;
  const hiddenNote = hidden > 0 && (
    <p className="m-0 mt-2 text-[13px] text-ink-2">
      {hidden} more for other people.{" "}
      <button type="button" className="text-info hover:underline" onClick={() => ui.setTaskOwnerId("")}>Show everyone&apos;s</button>
    </p>
  );
  if (!shown.length) {
    return (
      <>
        <EmptyBox
          title={hidden ? `No stage tasks for ${memberName(ui.taskOwnerId)}` : "No stage tasks yet"}
          text="Use Add task → Stage task to give a person a task in one of their stages. Every deal of theirs in that stage gets it, and can't move on until it's done."
        />
        {hiddenNote}
      </>
    );
  }
  return (
    <>
      <p className="m-0 mb-1 text-[13px] text-ink-2">Each one is added to every deal of that person in that stage, now and whenever a deal enters the stage. Deals can&apos;t move on until it&apos;s done.</p>
      {hiddenNote}
      {stages.filter((s) => shown.some((t) => t.stage === s.key)).map((s) => (
        <div key={s.key}>
          <div className="mb-2 mt-[22px] flex items-baseline gap-2 text-[13px] font-semibold">{label(s.key)}<span className="font-normal text-ink-3">{shown.filter((t) => t.stage === s.key).length}</span></div>
          <div className="rounded-xl border border-line bg-panel px-4 py-0.5 shadow-sh1">
            {shown.filter((t) => t.stage === s.key).map((t) => (
              <div key={t.id} className="flex items-start gap-2.5 border-t border-line py-2.5 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <div>{t.title}</div>
                  <div className="mt-0.5 flex flex-wrap gap-2.5 text-xs text-ink-3">
                    <span>{memberName(t.ownerId)}</span>
                    <span>Due {t.dueInDays === 0 ? "the day" : `${t.dueInDays} day${t.dueInDays === 1 ? "" : "s"} after`} the deal enters</span>
                    <span>{openCopies(t)} open on deals now</span>
                  </div>
                </div>
                {canAdmin && <Button variant="ghost" size="xs" onClick={() => setConfirm(t)}>Remove</Button>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(v) => { if (!v) setConfirm(null); }}
        title="Remove this stage task?"
        text={confirm ? `"${confirm.title}" stops being added to new deals, and its ${openCopies(confirm)} open copies are removed so they no longer block. Ticked copies stay in the history.` : ""}
        ok="Remove stage task"
        danger
        onOk={() => { if (confirm) del.mutate(confirm); }}
      />
    </>
  );
}
