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

# Scheduled jobs (django-celery-beat copies these into its DB schedule on start)
from celery.schedules import crontab  # noqa: E402

ALERT_CHECK_MINUTES = env.int("ALERT_CHECK_MINUTES", default=60)
DIGEST_HOUR = env.int("DIGEST_HOUR", default=8)
DIGEST_MINUTE = env.int("DIGEST_MINUTE", default=0)
CELERY_BEAT_SCHEDULE = {
    "sales-pipeline-checks": {"task": "sales_pipeline.run_checks", "schedule": ALERT_CHECK_MINUTES * 60},
    "sales-pipeline-daily-digest": {"task": "sales_pipeline.daily_digest", "schedule": crontab(hour=DIGEST_HOUR, minute=DIGEST_MINUTE, day_of_week="mon-fri")},
    "sales-pipeline-prune-alerts": {"task": "sales_pipeline.prune_alerts", "schedule": crontab(hour=3, minute=30, day_of_week="sun")},
}

# ---------- Email (Resend) ----------
RESEND_API_KEY = env("RESEND_API_KEY", default="")
EMAIL_FROM = env("EMAIL_FROM", default="")
GTM_LEAD_EMAIL = env("GTM_LEAD_EMAIL", default="")
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:3000")

# ---------- AI (Claude) ----------
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY", default="")
AI_ENABLED = env("AI_ENABLED") and bool(ANTHROPIC_API_KEY)
AI_MODEL_FAST = env("AI_MODEL_FAST", default="")
AI_MODEL_SMART = env("AI_MODEL_SMART", default="")
AI_TIMEOUT_SECONDS = env("AI_TIMEOUT_SECONDS")

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

# ---------- Security in production ----------
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
