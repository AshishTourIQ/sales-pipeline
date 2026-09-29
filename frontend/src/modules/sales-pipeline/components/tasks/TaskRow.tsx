"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useDeleteTask, useUpdateTask } from "../../api/hooks";
import { useData } from "../../context/data-context";
import { useUi } from "../../context/ui-context";
import { dueLabel, today } from "../../lib/dates";
import type { Task } from "../../types";

export function TaskRow({ task, showDeal }: { task: Task; showDeal?: boolean }) {
  const ui = useUi();
  const { dealById, memberName, canWrite } = useData();
  const update = useUpdateTask();
  const del = useDeleteTask();
  const deal = task.dealId ? dealById.get(task.dealId) : undefined;
  const overdue = !task.done && task.due && task.due < today();

  return (
    <div className="flex items-start gap-2.5 border-t border-line py-2.5 first:border-t-0">
      <Checkbox
        checked={task.done}
        disabled={!canWrite}
        aria-label={`Mark done: ${task.title}`}
        onCheckedChange={(v) => update.mutate({ task, patch: { done: v === true } })}
      />
      <div className="min-w-0 flex-1">
        <div className={cn(task.done && "text-ink-3 line-through")}>{task.title}</div>
        <div className="mt-0.5 flex flex-wrap gap-2.5 text-xs text-ink-3">
          {showDeal && deal && (
            <button type="button" className="text-info hover:underline" onClick={() => ui.openDeal(deal.id)}>{deal.company.name || "Deal"}</button>
          )}
          <span>{memberName(task.ownerId) || "Unassigned"}</span>
          <span className={cn(overdue && "font-medium text-danger")}>
            {task.done ? (task.autoClosed ? "Closed automatically" : "Done") : dueLabel(task.due)}
          </span>
          {task.templateId ? <span>Stage task</span> : task.auto && <span>Automatic</span>}
          {task.blocking === false && <span className="rounded bg-sunk px-1.5 text-ink-2">Reminder, doesn&apos;t block</span>}
        </div>
      </div>
      {canWrite && <Button variant="ghost" size="xs" aria-label="Remove task" onClick={() => del.mutate(task)}>Remove</Button>}
    </div>
  );
}
