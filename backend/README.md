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

Email goes through Resend. Without `RESEND_API_KEY` emails are only logged, never sent, so dev and tests are safe.
Email links open the deal (`FRONTEND_URL/?deal=<id>`). Sample deals never trigger alerts.

## AI drafts (Claude)

`POST /deals/<id>/ai-draft/` with `action` = `brief` | `first` | `follow` | `tag` | `summary` | `next`.
Writing uses `AI_MODEL_SMART` (Sonnet 4.6); tagging, summaries and next step use `AI_MODEL_FAST` (Haiku 4.5).
Reply tags and call summaries are schema-validated (Pydantic via `messages.parse`). Every call is logged in
`AiDraftLog` (model, tokens, time, error; no prompt text). Without `ANTHROPIC_API_KEY`, the endpoint returns
`503 not_granted` and the UI says AI isn't set up.

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
