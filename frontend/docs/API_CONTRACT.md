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
| POST | `/pipelines/` | `{name, template?}` | `Pipeline`: stages copied from `template` = `touriq` (sales), `partners` or `referrals` |
| POST | `/pipelines/{id}/handoffs/` | `{}` (admin) | `{moved}`: partner hand-offs whose company type fits this Partnerships / Referrals pipeline move in |
| PATCH | `/pipelines/{id}/` | `{name?, pilot_enabled?, stages?: [{key, name?, limit?, owner_id?, phase?, description?}]}` | `Pipeline` (edits existing stages only) |
| POST | `/pipelines/{id}/stages/` | `{name, phase, after, limit?, owner_id?, description?}` | `{pipeline, stage}`: a custom stage (`key: "c_..."`) inserted after `after` (`""` = first) |
| POST | `/pipelines/{id}/stages/{key}/remove/` | `{move_to}` | `{pipeline, moved}`: its deals move to `move_to` first (required when it has deals); Nurture/Lost can't be removed |
| GET | `/deals/?pipeline={id}&limit=&offset=` | | `{count, next_offset, results: Deal[]}`: pages of `limit` (default 500, max 1000), oldest first; `next_offset` is null on the last page |
| POST | `/deals/` | `CreateDealInput` | `DealMutationResult` |
| POST | `/deals/booth/` | `CreateBoothLeadInput` | `DealMutationResult`: the booth sheet, scored and filed (see "Booth lead form"). The same `client_id` again returns the first deal (a unique constraint per tenant backs this up) |
| GET | `/deals/duplicates/?company=&email=&website=` | | `[{deal_id, pipeline_id, pipeline_name, company, contact_name, stage, stage_name, owner_id, match}]` (max 5, newest first, all pipelines): "already in the pipeline?" while a lead is typed. `match` = `email`, `website` (same domain) or `company` (case, punctuation and LLC/Inc ignored). Warns only |
| PATCH | `/deals/{id}/` | `DealPatch` | `{deal, advanced}` (recompute `fit`; ticking the last checklist item advances) |
| DELETE | `/deals/{id}/` | (admin) | 204 (also deletes its tasks and history). Contributors get 403 `admin_only`: move it to Lost instead |
| POST | `/deals/{id}/move/` | `MoveDealInput` | `DealMutationResult` |
| POST | `/deals/{id}/activities/` | `{type, text, attendee_ids?}` | `Deal` (`attendee_ids` kept for `call` / `meeting` only) |
| PATCH | `/activities/{id}/` | `{attendee_ids}` | `Deal`: fix who was on a call or meeting |
| POST | `/deals/{id}/calendar-sync/` | `{}` | `{result, deal}`: put the demo / meeting on the team calendar now (`created`, `updated`, `deleted`, `none`) |
| GET | `/recordings/?status=unmatched,failed` | | `RecordedCall[]`: Recall recordings that need a person |
| POST | `/recordings/{id}/link/` | `{deal_id}` | `RecordedCall`: logged on that deal; the AI summary follows from the worker |
| POST | `/recordings/{id}/dismiss/` | `{}` | 204 |
| POST | `/webhooks/recall/{tenant_id}/` | Recall webhook (signed, no JWT) | `{ok}` |
| POST | `/deals/{id}/call-type/` | `{call_type}` | `DealMutationResult`: in s9, `team_demo` or `commercial`; the open second-call tasks are swapped |
| POST | `/deals/{id}/transfer/` | `{pipeline_id, stage?}` | `DealMutationResult`: the deal moves to that pipeline's first stage; tasks follow, open automatic ones close |
| POST | `/deals/{id}/touchpoints/` | `{kind, score?, link?, detail?}` | `Deal`: a person adds a journey step |
| POST | `/intake/` | intake event (key auth, not JWT) | `{deal_id, stage, created, duplicate, touchpoint_id}`: see `docs/INTAKE_API.md` |
| GET / POST | `/intake-keys/` | `{name}` (admin) | keys / `{key, secret}` (the full key is only in this response) |
| DELETE | `/intake-keys/{id}/` | (admin) | 204: revoked |
| POST | `/deals/{id}/expansion/` | `{}` | `DealMutationResult` (new deal entering at s5, source "Existing client (expansion)") |
| POST | `/deals/{id}/ai-draft/` | `{action, option?, pasted?}` | `{text, tag?, truncated?}` |
| GET | `/tasks/?pipeline={id}&limit=&offset=` | | `{count, next_offset, results: Task[]}` (paged like deals) |
| POST | `/tasks/` | `{pipeline_id, deal_id, title, owner_id, due}` | `Task` |
| PATCH | `/tasks/{id}/` | `{title?, owner_id?, due?, done?}` | `{task, advanced}`: `advanced` is a `DealMutationResult` when this tick finished the stage |
| DELETE | `/tasks/{id}/` | | 204 |
| GET | `/stage-tasks/?pipeline={id}` | | `StageTaskTemplate[]` |
| POST | `/stage-tasks/` | `{pipeline_id, stage, owner_id, title, due_in_days}` | `{template, tasks_created}` (added to that person's deals in that stage now) |
| DELETE | `/stage-tasks/{id}/` | | `{tasks_removed}` (open copies removed) |
| GET | `/users/` | | `[{id, name, email, is_sales_team, role, pending}]`: workspace users the Team picker chooses from; `pending` = invited, no password yet |
| POST | `/users/` | `{name, email, role, sales_team}` (admin) | `{...user, email_sent}`: creates the person and emails a set-password link |
| POST | `/users/{id}/resend-invite/` | `{}` (admin) | `{...user, email_sent}` |
| GET / PATCH | `/settings/` | `{team?, rules?, targets?, booth_followup?, links?, event_costs?}` | `PipelineSettings` (per tenant). `event_costs` = `{"Arival 2026": 12000}`; a PATCH merges, `null` removes an event |
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

## Booth lead form (`/deals/booth/`)

The Arival paper sheet as one call. The client sends **answers only**; the server scores
them (`services/scoring.py`, mirrored in `lib/scoring.ts`; `tests/test_scoring.py` pins both
copies of `SCORE_QUESTIONS` / `BOOTH_QUESTIONS`).

- 8 questions, max 19 points. Tiers: A 15+, B 10–14, C 5–9, D under 5.
- Cap: unless `role` = `decider` **and** `booking` ∈ `fareharbor`, `peek`, the tier is at most B
  (an unanswered question counts as not confirmed).
- `deal.booth` = `{client_id, visitor, answers, offer, game_played, game_score, met_at, destination,
  runs, pricing_tool, points, tier_before_cap, capped, tier, complete}`. Points and tier are
  recomputed on every read, so a change to the points re-scores every lead. `deal.met_by_id` = the
  staff member who met them.
- `PATCH /deals/{id}/` with `{booth: {visitor?, answers?, offer?, game_played?, game_score?}, met_by_id?}`
  re-scores; the deal never moves stage.

Routing by visitor, then offer (`offer` defaults from the tier: A demo_booked, B audit, C analysis, D game):

| visitor | lands in | follow-up task |
|---|---|---|
| operator, `demo_booked` | Demo booked (`booked_at` → `demo_date`) | "Send the demo invite and deck…" |
| operator, `demo_given` | Demo done | "Follow up with…" |
| operator, `audit` / `analysis` / `game` | Offer sent, `track` = the offer (Replied if the stage was removed) | the stage's own tasks, the first due on the follow-up date (see below) |
| consultant, platform | Nurture, "Partner hand-off" | "Hand … to the partnerships team" |
| press | Nurture, "Press hand-off" | "Follow up with … (press / Arival)" |
| competitor | Lost, "Not a prospect"; contact `opted_out` | none |
| vendor | Lost, "Not a prospect" | none |

The follow-up (blocking, rule `r_capture48`) goes to `followup_owner_id`, due `followup_due`, or
the tier's default from `settings.booth_followup` (`{A|B|C|D|partner|press: {owner_id, days}}`,
admin-editable). It replaces the generic 48-hour booth task. The sheet becomes a `meeting`
activity; `note` becomes a note.

## Involvement, second call, links, partner pipelines

- **Involvement (commissions):** `activity.attendee_ids` (team members on a call / meeting),
  `deal.account_manager_id`, `deal.met_by_id` and `deal.owner_id`. The Involvement dashboard and the
  drawer's "Who's involved" are computed client-side (`lib/involvement.ts`).
- **Second call (s9):** `deal.call_type` = `team_demo` | `commercial`, chosen on the move into s9
  (`{to: "s9", call_type}`) or switched later with `/call-type/`. Each has its own tasks (rule `r_second`).
- **Links:** `settings.links` = `{booking_link, demo_deck, audit_example, analysis_example}`;
  `deal.links` = `[{label, url}]` (max 10). Both, plus report links on the journey, go into every AI
  prompt; the booking link replaces `[booking link]`. New AI action `invite` (demo confirmation with the deck).
- **Company type:** `company.category` ∈ operator, booking_platform, ota, revenue_manager, agency,
  competitor, other (booth visitor types set it). Competitors are never drafted to (`do_not_contact`).
- **Contact types (Section 7):** operators → sales pipeline; booking platforms → `partners`
  (integration); OTAs → `channels` (ch1 Identified → ch2 Partnerships contact → ch3 Intro call → ch4 Channel
  agreement → ch5 Channel live, rule `r_channel`); revenue managers and agencies → `referrals`, with
  `commission_pct` (we pay them) and `commission_in_pct` (they pay us, two-way). **Competitors:** a deal whose
  company is `competitor` is moved to Lost ("Not a prospect"), its contact opted out and open tasks closed;
  moving it to any stage other than Lost (Nurture included) or to another pipeline returns 409 `competitor`. The import reads a
  "Company type" column (free text mapped to a type); competitors are imported straight into Lost. AI
  `brief` / `first` / `follow` are written for the contact type (partnership, channel or referral pitch).
- **Partner pipelines:** template `partners`: pt1 Identified → pt2 Partnerships contact → pt3 Intro call
  → pt4 Integration scoping → pt5 Pilot client → pt6 Integrated (rule `r_partner`). Template
  `referrals`: rf1 Identified → rf2 Intro call → rf3 Agreement → rf4 Active partner (rule `r_referral`),
  with `deal.commission_pct`.

## Events

`deal.event` is free text ("Arival 2026", "Spark 2026", any future event), set by the booth form's Event
field (which also picks the source: "Arival booth", "Spark booth" or "Event booth"), by `POST /deals/`,
`PATCH /deals/{id}/`, and `trade_show` on `/intake/` for new leads. The Sources dashboard counts leads,
demos and signed deals per event, and divides `settings.event_costs` by them (cost per lead, demo, signed).

## Speed to lead

`deal.first_touch_at` and `deal.demo_at` (ISO, `""` until it happens) are stamped once by the server
(`services/speed.py`). First touch: an `email`, `call` or `meeting` activity (not the booth conversation the
booth form logs), or a person ticking a task of rule `r_capture48`, `r_offer`, `r_sequence` or `r_reply`.
Demo: a `demo_booked` or `demo_held` touchpoint. A Tier A booth operator still untouched after
`TIER_A_TOUCH_HOURS` (24) emails the owner and the GTM lead once (scheduled checks, last 14 days only).
The Booth dashboard shows the median time to each, per tier.

## Google Calendar and Recall

- `deal.meeting_url` (editable) and `deal.on_calendar`. A deal with a `demo_date` (not Lost, not a
  sample) has an event on the team calendar ("TourIQ demo: …" or, for the source "Arival app meeting",
  "Arival meeting: …"). Creating, moving, re-dating or losing a deal queues the sync; deleting it
  removes the event. With delegation the event invites the owner and the contact and gets a Meet link,
  which is saved as `meeting_url`.
- Recall: `transcript.done` / `bot.done` webhooks → a `RecallMeeting` → the worker fetches the bot,
  participants and transcript, matches a deal (meeting link, then title, then participant email, then
  name), logs a `meeting` activity with the team `attendee_ids`, and adds an `ai` activity with the
  call summary. `settings.integrations` = `{calendar, calendar_invites, recall, recall_webhook_url}`.

## Offer sent and the journey

`offer` is an optional stage between Replied and Demo booked (like Pilot: no number, never the
"next stage"). A deal enters it with a `track` (`game` | `analysis` | `audit`): from the booth form,
from `/intake/`, or a move with `{to: "offer", track}`. Moving **into** it is never gated.
Its tasks (rule `r_offer`): send the offer (audit: the form, then the report on day 7); reminders on
day 3, 7 and 14 (non-blocking); "Demo booked: tick when they book" (blocking). Ticking the last
blocking task moves the deal to Demo booked. The stage limit is 14 days.

`deal.track` stays after the deal moves on, so the Journey dashboard can tell which track led to a demo.
`deal.touchpoints` = `[{id, kind, source, at, score, link, detail, by_name}]`, `kind` ∈ game_played,
analysis_viewed, analysis_sent, audit_submitted, audit_report_sent, demo_requested, demo_booked,
demo_held; `source` ∈ booth, intake, pipeline (moves to Demo booked / Demo done), manual.

## Staff invites (auth)

Public, no token: `POST /api/auth/invite/check/ {token}` → `{email, name, tenant_name}`;
`POST /api/auth/invite/accept/ {token, password}` → `{access, refresh}` (same as login). The
invite link is `FRONTEND_URL/?invite=<token>`: a signed token that expires after `INVITE_DAYS`
and stops working once the password is set. Errors: `invite_invalid`, `invite_expired`,
`invite_used`, `weak_password`. On merge the host app's own invite flow replaces this.

## Outreach (the Arival outreach tracker)

Nothing here sends a message. People write drafts in Claude chat, paste them in, an approver approves,
and someone sends by hand and ticks Sent. Every rule below is enforced on the server.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/outreach/?campaign=` | | people on outreach lists, with research, drafts, `next`, `last_touch`, `follow_up_due` |
| POST | `/outreach/import/` (admin) | `{campaign, contacts[], research[]}` | counts; one deal per company, re-import updates |
| PATCH | `/outreach/contacts/{id}/` | `priority` (admin), `email`, `linkedin`, `notes`, `verify{company,person,contact_info}` | the person |
| POST | `/outreach/contacts/{id}/step/` | `{step, value}` (date, `""` unticks) | the person |
| POST | `/outreach/contacts/{id}/reply-check/` | `{channel: linkedin|email|app, replied}` | the person |
| PATCH | `/outreach/companies/{id}/research/` | `{research{}, website, verified}` | everyone listed at that company |
| POST | `/outreach/contacts/{id}/drafts/` | `{channel, subject, body}` | the person |
| PATCH | `/outreach/drafts/{id}/` | `subject`, `body`, `action: approve|changes`, `note` | the person |
| DELETE | `/outreach/drafts/{id}/` | | the person |
| PATCH | `/users/{id}/` (admin) | `{can_approve_outreach}` | the user |

Rules: drafts and sent ticks need the company research and the person checked; sent ticks need an
approved draft of that channel; P1 people only by `settings.outreach.p1_user_id` (who may skip drafts);
"Yes" lead-review people are approved only by the P1 owner; nobody approves their own draft (admins
excepted); one Arival app sender per person; Skip, competitors and unsubscribed are never messaged.
Changing a required research field or the person's email/LinkedIn undoes the check.

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
`invalid_json` (502), `timeout` (504), `network` (503), `not_granted` (503, no key / key rejected) and
`do_not_contact` (409: `first` / `follow` for an opted-out contact, e.g. a competitor). A person always reviews and sends; the server never
sends email itself.

## Health and rate limits

`GET /healthz/` (outside `/api/`, no login): `{ok, database, cache}`, 200 when both answer, else 503.
Sign-in (`/api/auth/token/`, `/token/refresh/`, `/invite/check/`, `/invite/accept/`) and `/intake/`
are rate-limited (`.env`: `AUTH_RATE`, `LOGIN_EMAIL_RATE`, `TOKEN_REFRESH_RATE`, `INTAKE_*`); over the
limit they answer 429 `throttled`. Limits are counted in `CACHE_URL` (Redis), shared by every process.

## Polling

The UI polls every 30 seconds (TanStack Query `refetchInterval`) and refetches when
the window regains focus. When the move to Django Channels happens, invalidate the
query keys `["sales-pipeline", "deals", id]` and `["sales-pipeline", "tasks", id]`
on push.
