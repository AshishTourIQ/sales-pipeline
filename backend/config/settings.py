"""
Django settings. Every secret and environment-specific value comes from .env
(see .env.example). Nothing sensitive is hard-coded here.
"""
from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOWED_ORIGINS=(list, []),
    AI_ENABLED=(bool, True),
    AI_TIMEOUT_SECONDS=(int, 45),
    JWT_ACCESS_MINUTES=(int, 30),
    JWT_REFRESH_DAYS=(int, 7),
)
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "django_filters",
    "django_celery_beat",
    # Stand-in for the host app's tenants and users (replaced on merge)
    "core",
    # The module
    "sales_pipeline",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# Each request runs in one transaction, so the tenant set for Row-Level
# Security (SET LOCAL app.tenant_id) lasts exactly as long as the request.
DATABASES = {"default": {**env.db("DATABASE_URL"), "ATOMIC_REQUESTS": True}}

AUTH_USER_MODEL = "core.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = env("DJANGO_TIME_ZONE", default="Asia/Kolkata")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------- REST framework / JWT ----------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "EXCEPTION_HANDLER": "sales_pipeline.api.exceptions.exception_handler",
    # Proxies in front of Django that append to X-Forwarded-For. Rate limits and the wrong-key block count
    # the address just before them; unset, the whole (caller-written) header is the address.
    "NUM_PROXIES": env.int("DRF_NUM_PROXIES", default=None),
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env("JWT_ACCESS_MINUTES")),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env("JWT_REFRESH_DAYS")),
    "SIGNING_KEY": env("JWT_SIGNING_KEY", default="") or SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
}

CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")

# ---------- Celery ----------
CELERY_BROKER_URL = env("CELERY_BROKER_URL", default="redis://localhost:6380/1")
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", default="redis://localhost:6380/2")
CELERY_TASK_ACKS_LATE = True
CELERY_TIMEZONE = TIME_ZONE
CELERY_BEAT_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"
REDIS_URL = env("REDIS_URL", default="redis://localhost:6380/0")
# Jobs that hang (Recall, Google, Claude calls) are stopped instead of blocking the worker
CELERY_TASK_SOFT_TIME_LIMIT = env.int("CELERY_TASK_SOFT_TIME_LIMIT", default=240)
CELERY_TASK_TIME_LIMIT = env.int("CELERY_TASK_TIME_LIMIT", default=300)
CELERY_WORKER_HIJACK_ROOT_LOGGER = False

# ---------- Cache (rate limits, job locks) ----------
# Must be shared by every server process in production (Redis), or each process counts
# rate limits on its own. Empty = in-memory (fine for local dev and tests only).
CACHE_URL = env("CACHE_URL", default="")
CACHES = {
    "default": (
        {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": CACHE_URL, "KEY_PREFIX": "sp"}
        if CACHE_URL else {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}
    )
}

# Scheduled jobs (django-celery-beat copies these into its DB schedule on start)
from celery.schedules import crontab  # noqa: E402

ALERT_CHECK_MINUTES = env.int("ALERT_CHECK_MINUTES", default=60)
DIGEST_HOUR = env.int("DIGEST_HOUR", default=8)
DIGEST_MINUTE = env.int("DIGEST_MINUTE", default=0)
CELERY_BEAT_SCHEDULE = {
    "sales-pipeline-checks": {"task": "sales_pipeline.run_checks", "schedule": ALERT_CHECK_MINUTES * 60},
    "sales-pipeline-daily-digest": {"task": "sales_pipeline.daily_digest", "schedule": crontab(hour=DIGEST_HOUR, minute=DIGEST_MINUTE, day_of_week="mon-fri")},
    "sales-pipeline-prune-alerts": {"task": "sales_pipeline.prune_alerts", "schedule": crontab(hour=3, minute=30, day_of_week="sun")},
    # Recorded calls whose processing didn't run or failed (worker down, Recall still processing)
    "sales-pipeline-recall-retry": {"task": "sales_pipeline.process_pending_recordings", "schedule": 10 * 60},
}

# Gets stuck-deal and Tier A alerts together with the deal owner
GTM_LEAD_EMAIL = env("GTM_LEAD_EMAIL", default="")

# ---------- Email (SMTP): to leads (game link) and to the team (alerts, digests, invites) ----------
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.smtp.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", default="")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_TIMEOUT = env.int("EMAIL_TIMEOUT", default=15)
# Sender names: leads see EMAIL_FROM_NAME, the team sees STAFF_EMAIL_FROM_NAME (same address)
EMAIL_FROM_NAME = env("EMAIL_FROM_NAME", default="TourIQ")
STAFF_EMAIL_FROM_NAME = env("STAFF_EMAIL_FROM_NAME", default="TourIQ Pipeline")
EMAIL_ENABLED = bool(EMAIL_HOST and EMAIL_HOST_USER)
# Testing: send every email (team and leads) to this one inbox instead of the real recipient
EMAIL_REDIRECT_TO = env("EMAIL_REDIRECT_TO", default="")
# The pricing game (a placeholder until the real game is live; Settings → Files and links overrides it)
GAME_LINK = env("GAME_LINK", default="https://touriq.ai/game")
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:3000")
# Staff invite links (set-password emails) stop working after this many days
INVITE_DAYS = env.int("INVITE_DAYS", default=7)
# Intake API (game / analysis / audit tools): requests allowed per key
INTAKE_RATE = env("INTAKE_RATE", default="120/min")
# ...and per key per day, so a leaked key can't flood the pipeline
INTAKE_DAILY_RATE = env("INTAKE_DAILY_RATE", default="5000/day")
# ...and per calling address, whatever key it sends (random keys don't get a fresh allowance)
INTAKE_IP_RATE = env("INTAKE_IP_RATE", default="600/min")
# Wrong intake keys allowed per address per hour before it is blocked
INTAKE_BAD_KEY_LIMIT = env.int("INTAKE_BAD_KEY_LIMIT", default=20)

# ---------- Rate limits: sign-in ----------
# Login, invite check and invite accept, per address
AUTH_RATE = env("AUTH_RATE", default="20/min")
# Login attempts per email address (slows password guessing on one account)
LOGIN_EMAIL_RATE = env("LOGIN_EMAIL_RATE", default="10/hour")
# Token refreshes per address
TOKEN_REFRESH_RATE = env("TOKEN_REFRESH_RATE", default="60/min")

# ---------- AI (Claude) ----------
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY", default="")
AI_ENABLED = env("AI_ENABLED") and bool(ANTHROPIC_API_KEY)
AI_MODEL_FAST = env("AI_MODEL_FAST", default="")
AI_MODEL_SMART = env("AI_MODEL_SMART", default="")
AI_TIMEOUT_SECONDS = env("AI_TIMEOUT_SECONDS")

# ---------- Google Calendar (demo and meeting events) ----------
# A service account; share the team calendar with its email ("Make changes to events").
# Give the key file's path, or its JSON content (for hosts without files).
GOOGLE_SERVICE_ACCOUNT_FILE = env("GOOGLE_SERVICE_ACCOUNT_FILE", default="")
GOOGLE_SERVICE_ACCOUNT_JSON = env("GOOGLE_SERVICE_ACCOUNT_JSON", default="")
GOOGLE_CALENDAR_ID = env("GOOGLE_CALENDAR_ID", default="")
# Optional (Google Workspace domain-wide delegation): act as this user, so events invite
# the attendees and get a Google Meet link. Without it, events go on the calendar only.
GOOGLE_DELEGATED_USER = env("GOOGLE_DELEGATED_USER", default="")
CALENDAR_EVENT_MINUTES = env.int("CALENDAR_EVENT_MINUTES", default=30)
CALENDAR_ENABLED = bool(GOOGLE_CALENDAR_ID and (GOOGLE_SERVICE_ACCOUNT_FILE or GOOGLE_SERVICE_ACCOUNT_JSON))

# ---------- Recall.ai (recorded calls) ----------
RECALL_API_KEY = env("RECALL_API_KEY", default="")
# us-east-1 | us-west-2 | eu-central-1 | ap-northeast-1 (keys and bots are per region)
RECALL_REGION = env("RECALL_REGION", default="us-east-1")
# Workspace secret (whsec_...) that signs Recall's webhooks
RECALL_WEBHOOK_SECRET = env("RECALL_WEBHOOK_SECRET", default="")
# Reject webhooks older than this (replay protection)
RECALL_WEBHOOK_TOLERANCE_SECONDS = env.int("RECALL_WEBHOOK_TOLERANCE_SECONDS", default=300)
RECALL_ENABLED = bool(RECALL_API_KEY and RECALL_WEBHOOK_SECRET)

# ---------- Cloudflare R2 ----------
R2_ACCOUNT_ID = env("R2_ACCOUNT_ID", default="")
R2_ACCESS_KEY_ID = env("R2_ACCESS_KEY_ID", default="")
R2_SECRET_ACCESS_KEY = env("R2_SECRET_ACCESS_KEY", default="")
R2_BUCKET = env("R2_BUCKET", default="")
R2_PUBLIC_BASE_URL = env("R2_PUBLIC_BASE_URL", default="")

# ---------- Seed ----------
SEED_TENANT_NAME = env("SEED_TENANT_NAME", default="TourIQ")
SEED_EMAIL_DOMAIN = env("SEED_EMAIL_DOMAIN", default="touriq.ai")
SEED_DEFAULT_PASSWORD = env("SEED_DEFAULT_PASSWORD", default="")

# ---------- Logging ----------
# One line per record on stdout (the host's log collector picks it up). LOG_LEVEL: DEBUG, INFO, WARNING...
LOG_LEVEL = env("LOG_LEVEL", default="INFO")
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"line": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "line"}},
    "root": {"handlers": ["console"], "level": LOG_LEVEL},
    "loggers": {
        "django": {"handlers": ["console"], "level": "INFO", "propagate": False},
        # 4xx are normal (validation, permissions); 5xx are logged with the traceback
        "django.request": {"handlers": ["console"], "level": "ERROR", "propagate": False},
        "sales_pipeline": {"handlers": ["console"], "level": LOG_LEVEL, "propagate": False},
        "core": {"handlers": ["console"], "level": LOG_LEVEL, "propagate": False},
        "celery": {"handlers": ["console"], "level": "INFO", "propagate": False},
    },
}

# ---------- Security in production ----------
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
    # Behind a proxy that already redirects, set SECURE_SSL_REDIRECT=False
    SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
    # The health check is called over plain HTTP by load balancers
    SECURE_REDIRECT_EXEMPT = [r"^healthz/?$"]
