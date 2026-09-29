"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PipelineApi } from "../api/types";
import type { CurrentUser } from "../types";

export interface ModuleConfig {
  api: PipelineApi;
  /** Signed-in user from the host app. When absent, people pick their name in Settings. */
  currentUser?: CurrentUser | null;
  /** RBAC from the host: false = read-only (Viewer). */
  canWrite?: boolean;
  /** Admins may move a deal forward with open stage tasks (reason required). */
  canOverride?: boolean;
  /**
   * Admins set the pipeline up: settings (team, rules, targets), pipelines, stages,
   * stage tasks, import and sample deals. The server enforces the same split.
   */
  canAdmin?: boolean;
  /** Show the AI drafts tab (server must have the Claude endpoint enabled). */
  aiEnabled?: boolean;
  /** Shown in the sidebar under the product name. */
  productName?: string;
}

interface ModuleValue extends Required<Omit<ModuleConfig, "currentUser">> {
  currentUser: CurrentUser | null;
}

const Ctx = createContext<ModuleValue | null>(null);

export function ModuleProvider({ config, children }: { config: ModuleConfig; children: ReactNode }) {
  const value: ModuleValue = {
    api: config.api,
    currentUser: config.currentUser ?? null,
    canWrite: config.canWrite ?? true,
    canOverride: config.canOverride ?? false,
    canAdmin: (config.canWrite ?? true) && (config.canAdmin ?? false),
    aiEnabled: config.aiEnabled ?? true,
    productName: config.productName ?? "TourIQ",
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useModule(): ModuleValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useModule must be used inside <SalesPipelineModule>");
  return v;
}
