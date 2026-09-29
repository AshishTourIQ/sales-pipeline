"use client";

import { Button } from "@/components/ui/button";
import { useData } from "../../context/data-context";
import { useUi } from "../../context/ui-context";

/** Shown on an empty pipeline. */
export function Welcome() {
  const ui = useUi();
  const { pipeline, deals, canWrite, canAdmin } = useData();
  if (!pipeline || deals.length) return null;
  return (
    <div className="mx-3.5 mb-3 flex flex-wrap items-center gap-4 rounded-xl border border-line bg-panel px-[18px] py-4 shadow-sh1 tab:mx-[18px] tab:mb-3.5 desk:mx-6">
      <div>
        <h2 className="m-0 mb-0.5 text-[15px] font-semibold">Your {pipeline.name} pipeline is empty</h2>
        <p className="m-0 text-[13px] text-ink-2">Add leads as you meet them, or import them from the Lead Tracker or an Excel or CSV file.</p>
      </div>
      {canWrite && (
        <div className="flex flex-wrap gap-2 tab:ml-auto">
          {canAdmin && <Button size="sm" onClick={() => ui.setView("settings", "data")}>Import leads</Button>}
          <Button size="sm" variant="primary" onClick={() => ui.openCapture()}>Add lead</Button>
        </div>
      )}
    </div>
  );
}
