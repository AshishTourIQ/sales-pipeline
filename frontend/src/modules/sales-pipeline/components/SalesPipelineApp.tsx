"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCreatePipeline, useUpdateSettings } from "../api/hooks";
import { useData } from "../context/data-context";
import { useUi } from "../context/ui-context";
import { BoardView, MobileStageList } from "./board/BoardView";
import { ListView } from "./board/ListView";
import { CaptureDialog } from "./dialogs/CaptureDialog";
import { MoveDialogs } from "./dialogs/MoveDialogs";
import { DealDrawer } from "./drawer/DealDrawer";
import { Banners, TopBar } from "./shell/TopBar";
import { Sidebar } from "./shell/Sidebar";
import { SubTabs } from "./shell/SubTabs";
import { Toolbar } from "./shell/Toolbar";
import { DashboardView } from "./views/DashboardView";
import { GuideView } from "./views/GuideView";
import { SettingsView } from "./views/SettingsView";
import { TasksView } from "./views/TasksView";

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 699px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto my-14 max-w-[560px] px-5">
      <h2 className="m-0 mb-2 text-[22px] font-semibold tracking-[-.01em]">{title}</h2>
      {children}
    </div>
  );
}

function Setup() {
  const { canAdmin, settings } = useData();
  const create = useCreatePipeline();
  const saveSettings = useUpdateSettings();
  const ui = useUi();
  return (
    <Empty title="Set up your first pipeline">
      <p className="m-0 mb-4 text-ink-2">This creates the TourIQ pipeline: 13 stages from Target list to Live, an optional Pilot stage, the Nurture and Lost side lanes, and the automation rules from the playbook.</p>
      {canAdmin ? (
        <Button variant="primary" disabled={create.isPending} onClick={() => create.mutate("TourIQ", {
          onSuccess: (p) => { ui.setPipelineId(p.id); saveSettings.mutate(settings); },
        })}>
          Create the TourIQ pipeline
        </Button>
      ) : <p className="text-ink-2">Ask a pipeline admin to set it up.</p>}
    </Empty>
  );
}

export function SalesPipelineApp({ className }: { className?: string }) {
  const ui = useUi();
  const { ready, pipeline } = useData();
  const phone = useIsPhone();
  const boardMode = ready && !!pipeline && ui.view === "board" && ui.layout === "board" && !phone;

  let body: React.ReactNode;
  if (!ready) body = <Empty title="Loading the pipeline"><p className="m-0 text-ink-2">Connecting to your team&apos;s shared data.</p></Empty>;
  else if (!pipeline) body = <Setup />;
  else if (ui.view === "board") body = phone ? <MobileStageList /> : ui.layout === "list" ? <ListView /> : <BoardView />;
  else if (ui.view === "tasks") body = <TasksView />;
  else if (ui.view === "dash") body = <DashboardView />;
  else if (ui.view === "guide") body = <GuideView />;
  else body = <SettingsView />;

  return (
    <div
      className={cn(
        "min-h-dvh bg-canvas pb-[calc(66px+env(safe-area-inset-bottom,0px))] text-ink",
        "tab:flex tab:h-dvh tab:min-h-0 tab:pb-0",
        className,
      )}
    >
      <Sidebar />
      <div className="flex min-w-0 flex-col tab:min-h-0 tab:flex-1">
        <TopBar />
        <Banners />
        <SubTabs />
        <Toolbar />
        <main className={cn(boardMode ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "tab:min-h-0 tab:flex-1 tab:overflow-auto")}>
          {body}
        </main>
      </div>
      <DealDrawer />
      <CaptureDialog />
      <MoveDialogs />
    </div>
  );
}
