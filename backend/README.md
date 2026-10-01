# Sales pipeline backend (Django + DRF)

Implements `frontend/docs/API_CONTRACT.md`. It's standalone for now and built to
merge into the host app later.

## Layout

```
config/                 settings (all values from .env), urls, celery app
core/                   host stand-in: Tenant, User (email login, pipeline_role, is_sales_team),
                        JWT login, /me, RLS helpers (tenancy.py), bootstrap_db command
sales_pipeline/         the module
  config.py             stage template, sources, rules (mirror of frontend template.ts)
  models.py             Pipeline, PipelineSettings, Company, Contact, Deal, StageHistory,
                        Activity, Task, DealAlert
  migrations/0002_rls.py  Row-Level Security policies (tenant isolation)
  services/             ALL business logic: deals.py (create/move/update), rules.py,
                        pipelines.py, importer.py, samples.py
  api/                  thin DRF views, serializers, permissions, error format
  management/commands/seed_touriq.py
  tests/                rules, API flow, RLS isolation
```

## First-time setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt   # exact versions: requirements.lock.txt

# 1. Fill backend\.env (see .env.example): POSTGRES_ADMIN_URL password, SEED_DEFAULT_PASSWORD
# 2. Redis (Docker, host port 6380)
docker compose up -d
# 3. Database + app role (non-superuser, so RLS applies), then tables
.\.venv\Scripts\python manage.py bootstrap_db
.\.venv\Scripts\python manage.py migrate
# 4. TourIQ tenant, team users (nikunj/param/manjit/guddu) and pipeline
.\.venv\Scripts\python manage.py seed_touriq
# 5. Run
.\.venv\Scripts\python manage.py runserver 8010
```

Frontend: `frontend/.env.local` already points at `http://localhost:8010`.
Run `npm run dev` there and sign in as `nikunj@<SEED_EMAIL_DOMAIN>`.

## Background jobs (Celery + Beat)

Two extra processes, each in its own terminal (Redis must be running):

```powershell
.\.venv\Scripts\celery -A config worker --pool=solo --loglevel=info   # --pool=solo is required on Windows
.\.venv\Scripts\celery -A config beat --loglevel=info
```

| Job | When | What |
|---|---|---|
| `sales_pipeline.run_checks` | every `ALERT_CHECK_MINUTES` | stuck deals → owner **and** `GTM_LEAD_EMAIL`; nurture check-back due → owner; late payment → task for owner. Each breach is reported once (`DealAlert`). |
| `sales_pipeline.daily_digest` | weekdays at `DIGEST_HOUR:DIGEST_MINUTE` | each team member's overdue + due-today tasks |
| `sales_pipeline.prune_alerts` | Sundays 03:30 | removes alert records older than 180 days |

All email goes through SMTP (`EMAIL_*` in `.env`, e.g. a Gmail / Google Workspace app password): alerts,
digests and invites to the team, and the game link to leads. Without `EMAIL_HOST` emails are only logged,
never sent, and tests always use an in-memory outbox.
Email links open the deal (`FRONTEND_URL/?deal=<id>`). Sample deals never trigger alerts.

## AI drafts (Claude)

`POST /deals/<id>/ai-draft/` with `action` = `brief` | `first` | `follow` | `tag` | `summary` | `next`.
Writing uses `AI_MODEL_SMART` (Sonnet 4.6); tagging, summaries and next step use `AI_MODEL_FAST` (Haiku 4.5).
Reply tags and call summaries are schema-validated (Pydantic via `messages.parse`). Every call is logged in
`AiDraftLog` (model, tokens, time, error; no prompt text). Without `ANTHROPIC_API_KEY`, the endpoint returns
`503 not_granted` and the UI says AI isn't set up.

## Booth lead form and staff invites

- `POST /deals/booth/` saves one visitor from the Arival booth sheet. Staff tick answers; the server
  works out points, tier (A–D) and the cap (`services/scoring.py`, questions in `config.py`), files the
  visitor by type and offer, and creates the follow-up (defaults per tier in Settings → Booth form).
  See `frontend/docs/API_CONTRACT.md` → "Booth lead form".
- Admins invite staff from Settings → You and team. The email (SMTP) carries a set-password link
  (`FRONTEND_URL/?invite=…`) that works once and expires after `INVITE_DAYS`. Logic: `core/invites.py`.

## Journey and the intake API

- "Offer sent" (`offer`) is an optional stage between Replied and Demo booked for leads on the game,
  comparative analysis or audit track. Migration `0011` adds it to existing pipelines.
- `Touchpoint` rows record each journey step; `services/touchpoints.py`.
- `POST /intake/` lets the outside tools report steps with a per-tool key (Settings → Integrations,
  stored hashed). Guide for those teams: `frontend/docs/INTAKE_API.md`. Logic: `services/intake.py`.
  Rate limit: `INTAKE_RATE`.

## Involvement and partner pipelines

- Calls and meetings record their team attendees (`Activity.attendees`); with owner, met-by and
  `Deal.account_manager` that drives the Involvement dashboard used for commissions.
- s9 splits into a team demo or the commercial call (`Deal.call_type`, `services.deals.set_call_type`).
- Pipelines start from a template (`config.TEMPLATES`): sales (`touriq`), `partners`, `referrals`.
  `transfer_deal` moves a deal between pipelines; `import_handoffs` brings booth partner hand-offs in.

## Google Calendar and Recall (recorded calls)

Both are optional and switched on in `.env` (every variable is explained in `.env.example`). Both
run in the Celery worker, so the worker must be running.

**Google Calendar**
1. Google Cloud console: create a project, enable the Google Calendar API, create a service account
   and download its JSON key.
2. In Google Calendar, share the team calendar with the service account's email, with "Make changes
   to events". Copy the calendar ID (Settings → Integrate calendar).
3. `.env`: `GOOGLE_SERVICE_ACCOUNT_FILE` (or `GOOGLE_SERVICE_ACCOUNT_JSON`) and `GOOGLE_CALENDAR_ID`.
4. Optional, Google Workspace: allow the service account domain-wide delegation for the scope
   `https://www.googleapis.com/auth/calendar.events` and set `GOOGLE_DELEGATED_USER` (e.g. Nikunj).
   Events are then created as that person, invite the owner and the contact, and get a Meet link.

**Recall.ai**
1. `.env`: `RECALL_API_KEY`, `RECALL_REGION` (the key's region) and `RECALL_WEBHOOK_SECRET` (Recall
   dashboard → Developers → API Keys & Secrets → Create Workspace Secret, `whsec_…`).
2. Recall dashboard → Webhooks: add the URL shown in Settings → Integrations
   (`…/api/sales-pipeline/webhooks/recall/<tenant id>/`) for `transcript.done` and `bot.done`. The
   server must be reachable from the internet.
3. Bots need transcription on (`recording_config.transcript`). Participant emails only come with
   Recall's calendar integration; without it, calls match by meeting link, title or name, and the
   rest wait in Settings → Integrations to be linked by hand.

`sales_pipeline.process_pending_recordings` (every 10 minutes) retries recordings the worker missed.

## Tests

```powershell
.\.venv\Scripts\python -m pytest
```

The app role has CREATEDB, so pytest creates its own `test_sales_pipeline` database.

## Rules for this codebase

- **Secrets live only in `.env`** (gitignored). Every variable is listed in `.env.example`
  with a comment; add new ones there in the same change.
- **Business logic lives in `services/`**; views only validate, call one service and shape the output.
- **Every stage change goes through `services.deals.move_deal()`**, so history and automation
  can't be skipped.
- **Tenant isolation is enforced twice:** querysets filter by tenant, and Postgres RLS
  (`app.tenant_id`, set per request by `TenantScopedMixin`) is the backstop. The app never
  connects as a superuser, because superusers bypass RLS.
- **`services/rules.py` must match `frontend/.../lib/rules.ts`.** `tests/test_rules.py` pins it.
