# Sales pipeline module (frontend)

The TourIQ sales pipeline, built from the design artifact as a self-contained
module that drops into the main Next.js app.

**Stack:** Next.js 15 (App Router), React 19, TypeScript (strict, plus
`noUncheckedIndexedAccess`), Tailwind v4, shadcn/ui primitives with the pipeline's
design tokens, TanStack Query, TanStack Table (list view), nivo (dashboard bars).

## Run it

```bash
npm install
npm run dev          # http://localhost:3000, runs on the in-browser mock API
```

To point it at Django, copy `.env.example` to `.env.local` and set
`NEXT_PUBLIC_SALES_PIPELINE_API`.

> Node 20.3 works for dev and build. The shadcn CLI and ESLint 9 need Node 20.19 or later.

## What's in it

The screens match the artifact:

- **Pipeline:** a chevron board by phase (Find, Engage, Win, Launch, plus the lanes)
  with drag and drop, a sortable list view, search and filters, and "needs
  attention". On phones the board shows one stage at a time.
- **Deal drawer:** the stepper, "where it goes next" routes, the next step,
  checklists (qualification, pilot, go-live), Snapshot and demo, payment,
  editable details, tasks, the activity timeline, AI drafts and the per-stage guide.
- **Capture lead:** entry stage and owner are routed by lead source, and a fit score
  is calculated.
- **Move dialogs:** Lost (reason required), Nurture (check-back date), Demo booked
  (time) and the pilot cap.
- **Tasks:** due now, upcoming, stuck deals and done.
- **Dashboard:** scoreboard against targets, conversion, average days vs the stage
  limit, sources and losses, and team workload.
- **Workflow guide** and **Settings:** team, stages, automation rules, targets,
  product pipelines, Lead Tracker CSV import, CSV export and sample deals.

The layout has three breakpoints: phone (<700px, bottom tab bar), tablet
(700–1100px, icon rail) and desktop (full sidebar).

## Layout

```
src/
  components/ui/              shadcn/ui primitives (button, dialog, sheet, checkbox, …)
  modules/sales-pipeline/
    index.tsx                 <SalesPipelineModule/> + public exports
    types.ts                  domain types (mirror the DRF serializers)
    config/template.ts        stages, routes, guide copy, sources, rules
    lib/                      pure logic: rules engine, flags, fit score, CSV, selectors
    api/                      PipelineApi interface, DRF adapter, mock adapter, Query hooks
    context/                  module config, UI state, derived data
    components/               shell, board, drawer, dialogs, views
    styles/tokens.css         design tokens (+ shadcn semantic mapping)
    styles/pipeline.css       chevrons, stepper, timeline
docs/API_CONTRACT.md          endpoints and server-side automation for the Django team
```

## Moving it into the main project

1. Copy `src/modules/sales-pipeline/` and any `src/components/ui/*` files the main
   app doesn't already have. If the main app's shadcn components use different
   variant names, swap the imports.
2. Add the dependencies: `@tanstack/react-query @tanstack/react-table@8 @nivo/core @nivo/bar sonner lucide-react class-variance-authority clsx tailwind-merge @radix-ui/react-{dialog,checkbox,label,slot}`.
3. In the global CSS, import the styles and add the breakpoints and colour aliases
   from `src/app/globals.css` (the `@theme` blocks). Map the literal values in
   `tokens.css` onto the main app's own tokens.
4. Mount it on a route. The host already provides `QueryClientProvider` and
   `<Toaster/>`:

```tsx
"use client";
import { useMemo } from "react";
import { createDrfApi, SalesPipelineModule } from "@/modules/sales-pipeline";

export default function SalesPipelinePage() {
  const { user, getAccessToken, refresh, can } = useAuth(); // host auth (SimpleJWT)
  const api = useMemo(() => createDrfApi({
    baseUrl: "/api/sales-pipeline",
    getAccessToken,
    onUnauthorized: refresh,          // return true to retry once
  }), [getAccessToken, refresh]);
  return (
    <SalesPipelineModule
      api={api}
      currentUser={{ id: user.id, name: user.name }}
      canWrite={can("sales_pipeline.change")}
      aiEnabled
    />
  );
}
```

## Notes

- **Automation belongs on the server.** `lib/rules.ts` is the reference
  implementation that the mock runs, and the Django move and create endpoints must
  produce the same result (see `docs/API_CONTRACT.md`).
- **Mock API:** `createMockApi()` stores data in `localStorage` and runs the same
  rules, so the UI can be demoed without the backend. Its AI drafts are placeholders.
- **Offline (PWA and IndexedDB queue)** isn't wired in yet. All writes go through
  the TanStack Query mutations in `api/hooks.ts`, which is where the offline queue
  should plug in.
- **Light theme only**, as in the design artifact.
