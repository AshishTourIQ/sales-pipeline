"use client";

import { Button } from "@/components/ui/button";
import { useDuplicates } from "../../api/hooks";
import { useData } from "../../context/data-context";
import { useUi } from "../../context/ui-context";
import type { DuplicateMatch } from "../../types";

const WHY: Record<DuplicateMatch["match"], string> = { email: "same email", website: "same website", company: "same company name" };

/**
 * "Already in the pipeline?" under a new-lead form. Only warns: the person can still save
 * (two people at one company are two contacts). `onOpen` closes the form and opens the deal;
 * without it (the booth form, where closing would lose the visitor's answers) it only informs.
 */
export function DuplicateWarning({ company, email, website, onOpen }: {
  company: string; email: string; website?: string; onOpen?: () => void;
}) {
  const { memberName, pipeline } = useData();
  const ui = useUi();
  const { data } = useDuplicates({ company, email, website });
  if (!data?.length) return null;
  const open = (m: DuplicateMatch) => {
    onOpen?.();
    if (m.pipelineId !== pipeline?.id) ui.setPipelineId(m.pipelineId);
    ui.openDeal(m.dealId);
  };
  return (
    <div className="mt-3 rounded-[10px] bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn" role="status">
      <b className="font-semibold">Already in the pipeline?</b> Check before saving a second deal.
      <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
        {data.map((m) => (
          <li key={m.dealId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 flex-1">
              <b className="font-semibold">{m.company}</b>
              {m.contactName && `, ${m.contactName}`} · {m.stageName}
              {m.pipelineId !== pipeline?.id && ` (${m.pipelineName})`}
              {m.ownerId && ` · ${memberName(m.ownerId)}`} · {WHY[m.match]}
            </span>
            {onOpen && <Button size="xs" onClick={() => open(m)}>Open</Button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
