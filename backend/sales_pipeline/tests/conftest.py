import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from core.models import PipelineRole, Tenant
from core.tenancy import set_current_tenant
from sales_pipeline.services.pipelines import create_pipeline, get_settings

User = get_user_model()


@pytest.fixture(autouse=True)
def _no_real_email(settings):
    """Never send real mail from tests, even with SMTP set up in .env: team mail goes to
    notify.OUTBOX, and a test that switches EMAIL_ENABLED on gets Django's in-memory outbox."""
    settings.EMAIL_ENABLED = False
    settings.EMAIL_REDIRECT_TO = ""
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"


@pytest.fixture(autouse=True)
def _fresh_cache():
    """Rate-limit counts and job locks live in the cache: each test starts from zero."""
    from django.core.cache import cache

    cache.clear()
    yield
    cache.clear()


def make_tenant(slug: str):
    t = Tenant.objects.create(name=slug.title(), slug=slug)
    users = {}
    for username, role in [("nikunj", PipelineRole.ADMIN), ("param", PipelineRole.CONTRIBUTOR), ("manjit", PipelineRole.CONTRIBUTOR), ("guddu", PipelineRole.CONTRIBUTOR)]:
        # Stage default owners resolve by username, so the first tenant gets the plain names
        uname = username if slug == "touriq" else f"{username}-{slug}"
        users[username] = User.objects.create_user(
            email=f"{username}@{slug}.test", password="x-Test-12345", username=uname, full_name=username.title(),
            tenant=t, pipeline_role=role, is_sales_team=True,
        )
    set_current_tenant(t.id)
    get_settings(t.id)
    pipeline = create_pipeline(t.id, "TourIQ")
    return t, users, pipeline


@pytest.fixture
def ws(db):
    """Workspace: tenant, team users (nikunj/param/manjit/guddu) and the TourIQ pipeline."""
    t, users, pipeline = make_tenant("touriq")
    return {"tenant": t, "users": users, "pipeline": pipeline}


@pytest.fixture
def api(ws):
    c = APIClient()
    c.force_authenticate(ws["users"]["param"])
    return c


@pytest.fixture
def admin_api(ws):
    """Nikunj, the pipeline admin: settings, stages, stage tasks, import and samples."""
    c = APIClient()
    c.force_authenticate(ws["users"]["nikunj"])
    return c
