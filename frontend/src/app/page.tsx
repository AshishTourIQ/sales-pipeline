"use client";

import { useMemo } from "react";
import { createDrfApi, createMockApi, SalesPipelineModule } from "@/modules/sales-pipeline";
import { DevAuth, type DevAuthValue } from "./dev-auth";

const API = process.env.NEXT_PUBLIC_SALES_PIPELINE_API;

/**
 * Dev harness. With NEXT_PUBLIC_SALES_PIPELINE_API set (frontend/.env.local)
 * it signs in against Django and uses the real API; without it, it runs on
 * the browser-only mock API.
 */
export default function Page() {
  if (!API) return <MockHarness />;
  return <DevAuth>{(auth) => <DrfHarness auth={auth} />}</DevAuth>;
}

function MockHarness() {
  const api = useMemo(() => createMockApi(), []);
  return <SalesPipelineModule api={api} canWrite canOverride canAdmin aiEnabled />;
}

function DrfHarness({ auth }: { auth: DevAuthValue }) {
  const { getAccessToken, refresh } = auth;
  const api = useMemo(
    () => createDrfApi({ baseUrl: API ?? "", getAccessToken, onUnauthorized: refresh }),
    [getAccessToken, refresh],
  );
  return (
    <SalesPipelineModule
      api={api}
      currentUser={{ id: auth.me.id, name: auth.me.name }}
      canWrite={auth.me.can_write}
      canOverride={auth.me.pipeline_role === "admin"}
      canAdmin={auth.me.can_admin}
      productName={auth.me.tenant_name ?? "TourIQ"}
      aiEnabled={auth.me.ai_enabled}
    />
  );
}
