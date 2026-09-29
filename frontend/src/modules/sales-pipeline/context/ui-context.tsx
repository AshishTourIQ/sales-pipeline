"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { StageKey } from "../types";

export type View = "board" | "tasks" | "dash" | "guide" | "settings";
export type DrawerTab = "overview" | "tasks" | "activity" | "ai" | "guide";
export type Layout = "board" | "list";

export interface BoardFilters {
  ownerId: string;
  source: string;
  q: string;
  flagged: boolean;
}

export type MoveRequest = { dealId: string; to: StageKey } | null;

interface Persisted {
  view: View;
  sub: Record<View, string>;
  layout: Layout;
  pipelineId: string;
  meId: string;
  lastSource: string;
}

const DEFAULTS: Persisted = {
  view: "board",
  sub: { board: "find", tasks: "due", dash: "score", guide: "find", settings: "profile" },
  layout: "board",
  pipelineId: "touriq",
  meId: "",
  lastSource: "Arival booth",
};
const KEY = "sales-pipeline.ui.v1";

function read(): Persisted {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<Persisted>;
    return { ...DEFAULTS, ...v, sub: { ...DEFAULTS.sub, ...v.sub } };
  } catch {
    return DEFAULTS;
  }
}

interface UiValue extends Persisted {
  setView: (v: View, sub?: string) => void;
  setSub: (sub: string) => void;
  setLayout: (l: Layout) => void;
  setPipelineId: (id: string) => void;
  setMeId: (id: string) => void;
  setLastSource: (s: string) => void;

  filters: BoardFilters;
  setFilters: (f: Partial<BoardFilters>) => void;
  taskOwnerId: string;
  setTaskOwnerId: (id: string) => void;
  /** Selected stage per phase on phones (one stage at a time). */
  mobileStage: Partial<Record<string, StageKey>>;
  setMobileStage: (phase: string, k: StageKey) => void;

  openDealId: string | null;
  drawerTab: DrawerTab;
  openDeal: (id: string, tab?: DrawerTab) => void;
  closeDeal: () => void;
  setDrawerTab: (t: DrawerTab) => void;

  moveRequest: MoveRequest;
  requestMove: (dealId: string, to: StageKey) => void;
  clearMove: () => void;

  capture: { open: boolean; stage?: StageKey };
  openCapture: (stage?: StageKey) => void;
  closeCapture: () => void;
}

const Ctx = createContext<UiValue | null>(null);

export function UiProvider({ children, initialMeId }: { children: ReactNode; initialMeId?: string }) {
  const [p, setP] = useState<Persisted>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const v = read();
    setP(initialMeId ? { ...v, meId: initialMeId } : v);
    setHydrated(true);
  }, [initialMeId]);
  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
  }, [p, hydrated]);

  const [filters, setF] = useState<BoardFilters>({ ownerId: "", source: "", q: "", flagged: false });
  const [taskOwnerId, setTaskOwnerId] = useState<string>("");
  useEffect(() => { if (hydrated) setTaskOwnerId(p.meId); }, [hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep link from alert emails: ?deal=<id> opens that deal on the board
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("deal");
    if (!id) return;
    setP((x) => ({ ...x, view: "board" }));
    setOpenDealId(id);
    const url = new URL(window.location.href);
    url.searchParams.delete("deal");
    window.history.replaceState(null, "", url.toString());
  }, []);
  const [mobileStage, setMS] = useState<Partial<Record<string, StageKey>>>({});
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("overview");
  const [moveRequest, setMoveRequest] = useState<MoveRequest>(null);
  const [capture, setCapture] = useState<{ open: boolean; stage?: StageKey }>({ open: false });

  const setView = useCallback((view: View, sub?: string) => setP((x) => ({ ...x, view, sub: sub ? { ...x.sub, [view]: sub } : x.sub })), []);
  const setSub = useCallback((sub: string) => setP((x) => ({ ...x, sub: { ...x.sub, [x.view]: sub } })), []);
  const setPipelineId = useCallback((pipelineId: string) => {
    setP((x) => ({ ...x, pipelineId, view: x.view === "settings" ? "board" : x.view }));
    setF({ ownerId: "", source: "", q: "", flagged: false });
    setOpenDealId(null);
  }, []);

  const value = useMemo<UiValue>(() => ({
    ...p,
    setView,
    setSub,
    setLayout: (layout) => setP((x) => ({ ...x, layout })),
    setPipelineId,
    setMeId: (meId) => { setP((x) => ({ ...x, meId })); setTaskOwnerId(meId); },
    setLastSource: (lastSource) => setP((x) => ({ ...x, lastSource })),
    filters,
    setFilters: (f) => setF((x) => ({ ...x, ...f })),
    taskOwnerId,
    setTaskOwnerId,
    mobileStage,
    setMobileStage: (phase, k) => setMS((x) => ({ ...x, [phase]: k })),
    openDealId,
    drawerTab,
    openDeal: (id, tab = "overview") => { setOpenDealId(id); setDrawerTab(tab); },
    closeDeal: () => setOpenDealId(null),
    setDrawerTab,
    moveRequest,
    requestMove: (dealId, to) => setMoveRequest({ dealId, to }),
    clearMove: () => setMoveRequest(null),
    capture,
    openCapture: (stage) => setCapture({ open: true, stage }),
    closeCapture: () => setCapture({ open: false }),
  }), [p, setView, setSub, setPipelineId, filters, taskOwnerId, mobileStage, openDealId, drawerTab, moveRequest, capture]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi(): UiValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUi must be used inside <SalesPipelineModule>");
  return v;
}
