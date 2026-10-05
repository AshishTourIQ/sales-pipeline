"use client";

import { ClipboardList, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { qk, useSaving, useSamples } from "../../api/hooks";
import { useData } from "../../context/data-context";
import { useUi } from "../../context/ui-context";
import { isStuck } from "../../lib/pipeline";
import { BoothQueueBanner } from "../booth/BoothSync";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";
import { useDueCount } from "./Sidebar";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

const TITLES = { tasks: "Tasks", outreach: "Outreach", dash: "Dashboard", guide: "Workflow guide", settings: "Settings" } as const;

export function TopBar() {
  const ui = useUi();
  const { pipeline, pipelines, deals, flags, ready, canWrite, stages } = useData();
  const saving = useSaving();
  const due = useDueCount();

  const title = ui.view === "board" ? (pipeline ? `${pipeline.name} pipeline` : "Pipeline") : TITLES[ui.view];
  const active = deals.filter((d) => d.stage !== "lost" && d.stage !== "nurture").length;
  const inWin = deals.filter((d) => stages.find((s) => s.key === d.stage)?.phase === "win").length;
  const attention = deals.filter((d) => isStuck(flags.get(d.id) ?? [])).length;

  return (
    <header className="flex flex-wrap items-center gap-2 px-3.5 pt-3.5 tab:gap-3 tab:px-[18px] desk:px-6 desk:pt-[18px]">
      <div>
        <h1 className="m-0 text-[19px] font-semibold leading-tight tracking-[-.015em] tab:text-[21px]">{title}</h1>
        {ui.view === "board" && pipeline && ready && (
          <div className="mt-1.5 hidden flex-wrap gap-1.5 tab:flex">
            <Badge variant="stat"><b className="font-semibold text-ink">{active}</b> active</Badge>
            <Badge variant="stat"><b className="font-semibold text-ink">{inWin}</b> in Win</Badge>
            {attention > 0 && <Badge variant="stat" className="hidden desk:inline-flex"><b className="font-semibold text-danger">{attention}</b> need attention</Badge>}
            {due > 0 && <Badge variant="stat" className="hidden desk:inline-flex"><b className="font-semibold text-danger">{due}</b> tasks due</Badge>}
          </div>
        )}
      </div>
      <span className="flex-1" />
      {pipelines.length > 0 && (
        <NativeSelect aria-label="Pipeline" className="w-auto desk:hidden" value={pipeline?.id ?? ""} onChange={(e) => ui.setPipelineId(e.target.value)}>
          {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </NativeSelect>
      )}
      <span className="hidden whitespace-nowrap text-xs text-ink-3 tab:inline">{ready ? (saving ? "Saving…" : "All changes saved") : ""}</span>
      {canWrite && ready && pipeline && (
        <>
          <Button onClick={ui.openBooth} className="px-[11px] tab:px-3" title="The Arival booth sheet: score a visitor and file them">
            <ClipboardList />Booth lead
          </Button>
          <Button variant="primary" onClick={() => ui.openCapture()} className="px-[11px] tab:px-3">
            <Plus strokeWidth={2.2} />Add lead
          </Button>
        </>
      )}
    </header>
  );
}

export function Banners() {
  const ui = useUi();
  const { canWrite, canAdmin, deals, error, pipeline } = useData();
  const { remove } = useSamples();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const hasSamples = deals.some((d) => d.sample);
  const cls = "mx-3.5 mt-2.5 flex flex-wrap items-center gap-2.5 rounded-[10px] px-3.5 py-2.5 text-[13px] tab:mx-[18px] tab:mt-3 desk:mx-6";
  return (
    <>
      {!canWrite && <div className={`${cls} bg-warn-soft text-warn`}>You can view this pipeline but not change it. Ask the owner for Contributor access to edit.</div>}
      {error && (
        <div className={`${cls} bg-warn-soft text-warn`} role="status">
          {error}
          <Button size="xs" onClick={() => void qc.refetchQueries({ queryKey: qk.all })}>Retry</Button>
        </div>
      )}
      <BoothQueueBanner />
      {hasSamples && ui.view === "board" && (
        <div className={`${cls} bg-sample-soft text-sample`}>
          Sample deals are loaded so you can try things out.
          {canAdmin && <Button size="xs" onClick={() => setConfirm(true)}>Remove sample deals</Button>}
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Remove sample deals?"
        text="This deletes every deal marked Sample and its tasks. Your real deals stay as they are."
        ok="Remove sample deals"
        danger
        onOk={() => { if (pipeline) remove.mutate(pipeline.id); ui.closeDeal(); }}
      />
    </>
  );
}
