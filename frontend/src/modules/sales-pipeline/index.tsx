"use client";

/**
 * Sales pipeline module — public entry point.
 *
 * Mount inside the host app (which already provides a TanStack QueryClientProvider):
 *
 *   const api = useMemo(() => createDrfApi({ baseUrl: "/api/sales-pipeline", getAccessToken }), []);
 *   <SalesPipelineModule api={api} currentUser={user} canWrite={can("sales_pipeline.change")}
 *     canAdmin={can("sales_pipeline.admin")} canOverride={can("sales_pipeline.admin")} aiEnabled={me.ai_enabled} />
 *
 * Styles: import "modules/sales-pipeline/styles/tokens.css" and "pipeline.css" from the
 * host's global CSS (see README). Toasts use sonner; render <Toaster /> once in the host.
 */
import { DataProvider } from "./context/data-context";
import { ModuleProvider, type ModuleConfig } from "./context/module-context";
import { UiProvider } from "./context/ui-context";
import { SalesPipelineApp } from "./components/SalesPipelineApp";

export type SalesPipelineModuleProps = ModuleConfig & { className?: string };

export function SalesPipelineModule({ className, ...config }: SalesPipelineModuleProps) {
  return (
    <ModuleProvider config={config}>
      <UiProvider initialMeId={config.currentUser?.id}>
        <DataProvider>
          <SalesPipelineApp className={className} />
        </DataProvider>
      </UiProvider>
    </ModuleProvider>
  );
}

export { createDrfApi, type DrfApiOptions } from "./api/drf-adapter";
export { createMockApi, type MockApiOptions } from "./api/mock-adapter";
export type { PipelineApi } from "./api/types";
export { ApiError } from "./api/types";
export * from "./types";
