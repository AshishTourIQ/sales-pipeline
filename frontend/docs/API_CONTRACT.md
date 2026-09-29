# Sales pipeline API contract (Django REST Framework)

This is the contract the frontend's `createDrfApi()` adapter calls
(`src/modules/sales-pipeline/api/drf-adapter.ts`). The TypeScript types in
`src/modules/sales-pipeline/types.ts` are the source of truth for field shapes.

## Conventions

- Base path: `/api/sales-pipeline` (configurable via `baseUrl`).
- JSON only. **snake_case on the wire**; the adapter converts to camelCase.
  Map-like fields keep their keys unchanged: `rules` (keyed by rule key), `targets`, and the checklists `qual`, `pilot_checks`
  and `onboarding`.
- Auth: `Authorization: Bearer <SimpleJWT access token>`. On a 401 the host
  refreshes the token and the request is retried once.
- Tenant isolation: the tenant is resolved from the JWT. Postgres RLS is the
  backstop. The adapter can also send an `X-Tenant` header if the host uses one.
- IDs are strings (UUIDs are fine). Timestamps are ISO 8601. Dates are `YYYY-MM-DD`.
  Demo times are local `YYYY-MM-DDTHH:mm`.
- List endpoints return a bare array (no pagination today; the adapter also
  accepts DRF's `{results: [...]}`).
- Errors: `{"detail": "...", "code": "..."}` with the HTTP status (400s also carry
  the raw field `errors`). 403 codes: `read_only` (Viewer), `admin_only` (set-up by a
  non-admin), `no_access` (no pipeline role), `override_not_allowed`. The UI shows the
  read-only line for `read_only` and the server's `detail` for the others.
- RBAC (the server enforces it; the host passes the same flags to the UI):
  - Viewer: GET only.
  - Contributor (`canWrite`): deals, moves, tasks, activities, expansion, AI drafts.
  - Admin (`canAdmin`): also pipeline set-up — `PATCH /settings/` (team, rules,
    targets), `POST/PATCH /pipelines/`, stage add/remove, import, samples, and
    stage-task templates. Only admins may force a gated move (`canOverride`).
- `/api/auth/me/` returns `can_write`, `can_admin` and `ai_enabled` (false when the
  server has no Claude key; the UI then hides the AI tab).

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/pipelines/` | | `Pipeline[]` (include `deal_count`) |
| POST | `/pipelines/` | `{name}` | `Pipeline` (stages copied from the TourIQ template) |
| PATCH | `/pipelines/{id}/` | `{name?, pilot_enabled?, stages?: [{key, name?, limit?, owner_id?, phase?, description?}]}` | `Pipeline` (edits existing stages only) |
| POST | `/pipelines/{id}/stages/` | `{name, phase, after, limit?, owner_id?, description?}` | `{pipeline, stage}`: a custom stage (`key: "c_..."`) inserted after `after` (`""` = first) |
| POST | `/pipelines/{id}/stages/{key}/remove/` | `{move_to}` | `{pipeline, moved}`: its deals move to `move_to` first (required when it has deals); Nurture/Lost can't be removed |
| GET | `/deals/?pipeline={id}` | | `Deal[]` |
| POST | `/deals/` | `CreateDealInput` | `DealMutationResult` |
| PATCH | `/deals/{id}/` | `DealPatch` | `{deal, advanced}` (recompute `fit`; ticking the last checklist item advances) |
| DELETE | `/deals/{id}/` | | 204 (also deletes its tasks) |
| POST | `/deals/{id}/move/` | `MoveDealInput` | `DealMutationResult` |
| POST | `/deals/{id}/activities/` | `{type, text}` | `Deal` |
| POST | `/deals/{id}/expansion/` | `{}` | `DealMutationResult` (new deal entering at s5, source "Existing client (expansion)") |
| POST | `/deals/{id}/ai-draft/` | `{action, option?, pasted?}` | `{text, tag?, truncated?}` |
| GET | `/tasks/?pipeline={id}` | | `Task[]` |
| POST | `/tasks/` | `{pipeline_id, deal_id, title, owner_id, due}` | `Task` |
| PATCH | `/tasks/{id}/` | `{title?, owner_id?, due?, done?}` | `{task, advanced}`: `advanced` is a `DealMutationResult` when this tick finished the stage |
| DELETE | `/tasks/{id}/` | | 204 |
| GET | `/stage-tasks/?pipeline={id}` | | `StageTaskTemplate[]` |
| POST | `/stage-tasks/` | `{pipeline_id, stage, owner_id, title, due_in_days}` | `{template, tasks_created}` (added to that person's deals in that stage now) |
| DELETE | `/stage-tasks/{id}/` | | `{tasks_removed}` (open copies removed) |
| GET | `/users/` | | `[{id, name, email, is_sales_team}]`: workspace users the Team picker chooses from |
| GET / PATCH | `/settings/` | `{team?, rules?, targets?}` | `PipelineSettings` (per tenant) |
| POST | `/pipelines/{id}/import/` | `{rows: ImportRow[]}` | `{created, skipped}` (skip duplicate company names) |
| POST / DELETE | `/pipelines/{id}/samples/` | | `{created}` / `{removed}` |

`DealMutationResult` = `{deal, tasks_created: Task[], tasks_closed: string[]}`.

## Stages are per pipeline

`Pipeline.stages` is an ordered list: the main route in order, then Nurture and Lost
(`[{key, name, phase, limit, owner_id, optional?, lane?, custom?, description?}]`).
Numbers follow the order. Built-in keys (`s1`–`s13`, `pilot`) keep their automation; custom
stages have none (give them stage tasks). "Next stage" = the next non-optional main stage.
A lead source or route pointing at a removed built-in stage uses the next stage that still exists.
Reference: `backend/sales_pipeline/services/stages.py` and `frontend/.../lib/pipeline.ts`.

## Stage gating

A deal can only move **forward** along the main route once its current stage is done:
every open task with `blocking=true` and `stage == deal.stage` (automatic, stage-task copies, one-off)
plus the stage's checklist (`qual` at s8, `pilot_checks` at Pilot, `onboarding` at s12).

- Forward move with open items → `409 stage_tasks_open`. Nurture, Lost and backward moves are never gated.
- Ticking the last item (task PATCH `done=true`, or checklist PATCH) moves the deal to the next main stage
  (s9 and Pilot go to s10; s13 has no next stage) and returns it as `advanced`.
- Admins may send `{force: true, override_reason}` on `/move/`; the reason is saved as an activity.
  Others get `403 override_not_allowed`; a missing reason gets `400 override_reason_required`.
- Reminder tasks (`blocking=false`: stage-4 follow-ups, proposal chasers, check-ins after Live, nurture/lost reviews) never block.
- Stage tasks (`/stage-tasks/`) are copied onto every deal of `owner_id` in `stage`, now and when one enters the stage later.

## Server-side automation (runs inside create, move and expansion)

The reference implementation is `src/modules/sales-pipeline/lib/rules.ts` together
with `moveDeal` / `createDealSync` in `api/mock-adapter.ts`. Port that logic to
Python as it stands. Each rule applies only if it is on in `settings.rules`.

1. **r_owner**: on a move, the deal's owner becomes the target stage's default owner.
2. **r_autoclose**: on a move, the deal's open `auto` tasks from other stages are
   set to `done=true, auto_closed=true`.
3. **Rule tasks**: create the tasks for the stage the deal enters (titles and due
   offsets are in `ruleTasks()`). Demo prep tasks fall on the day before `demo_date`.
4. **r_capture48**: booth sources (`Arival booth`, `Spark booth`) get "Follow up
   within 48 hours" and skip the r_reply task.
5. **r_signed**: entering s11 sets payment to `Invoiced` (and `invoiced_at`) and
   sets `signed_at`. Entering s13 sets `live_at`.
6. **Lost** requires `loss_reason` (400 `loss_reason_required`). An `Unsubscribed`
   reason gets no 90-day review task.
7. Every move appends a `history` entry `{from, to, at, by_id, by_name}`. An optional
   `note` becomes an activity.
8. Activities are capped at the latest 150 per deal.

Flags (over the stage limit, near the limit, re-engage date passed, no demo after
5 days, payment late) are computed client-side from `stage_changed_at` and history.
A Celery Beat job can compute the same rules for reminders and escalations.

## AI drafts (`/deals/{id}/ai-draft/`)

The server builds the prompt from the deal (the fields, the last 8 notes and the
TourIQ wording rules), calls Claude and validates the output. `action` is one of:

| action | model (per the stack) | output |
|---|---|---|
| `brief`, `first`, `follow` (`option`: 3, 7, 14 or reply) | Sonnet 4.6 | plain text |
| `next` | Haiku 4.5 | plain text |
| `tag` (pasted reply) | Haiku 4.5, JSON | `{text, tag}`, where `tag` ∈ interested, not_now, wrong_person, no, unsubscribe |
| `summary` (pasted notes) | Haiku 4.5, JSON | `{text}` (the formatted needs, objections and follow-up draft) |

Error codes the UI understands: `rate_limited` (429), `prompt_too_large` (413), `refused` (422),
`invalid_json` (502), `timeout` (504), `network` (503) and `not_granted` (503, no key / key rejected). A person always reviews and sends; the server never
sends email itself.

## Polling

The UI polls every 30 seconds (TanStack Query `refetchInterval`) and refetches when
the window regains focus. When the move to Django Channels happens, invalidate the
query keys `["sales-pipeline", "deals", id]` and `["sales-pipeline", "tasks", id]`
on push.
