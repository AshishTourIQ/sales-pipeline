"""
Create the TourIQ workspace: tenant, the four team members, settings and the
TourIQ pipeline. Safe to run again (only creates what's missing).

Logins are <username>@SEED_EMAIL_DOMAIN with SEED_DEFAULT_PASSWORD (from .env).
"""
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils.text import slugify

from core.models import PipelineRole, Tenant
from core.tenancy import tenant_context

from ...models import Pipeline
from ...services.pipelines import create_pipeline, get_settings

User = get_user_model()

TEAM = [
    # username, full name, role (Nikunj also gets Django admin access)
    ("nikunj", "Nikunj", PipelineRole.ADMIN),
    ("param", "Param", PipelineRole.CONTRIBUTOR),
    ("manjit", "Manjit", PipelineRole.CONTRIBUTOR),
    ("guddu", "Guddu", PipelineRole.CONTRIBUTOR),
]


class Command(BaseCommand):
    help = "Seed the TourIQ tenant, team users and pipeline."

    def handle(self, *args, **opts):
        password = settings.SEED_DEFAULT_PASSWORD
        if not password:
            raise CommandError("Set SEED_DEFAULT_PASSWORD in backend/.env first.")
        name = settings.SEED_TENANT_NAME
        tenant, made = Tenant.objects.get_or_create(slug=slugify(name), defaults={"name": name})
        self.stdout.write(f"{'Created' if made else 'Found'} tenant {tenant.name}")

        for username, full, role in TEAM:
            email = f"{username}@{settings.SEED_EMAIL_DOMAIN}"
            user = User.objects.filter(email=email).first()
            if user:
                self.stdout.write(f"  user {email} exists")
                continue
            user = User.objects.create_user(
                email=email, password=password, username=username, full_name=full, tenant=tenant,
                pipeline_role=role, is_sales_team=True,
            )
            if role == PipelineRole.ADMIN:
                user.is_staff = user.is_superuser = True
                user.save(update_fields=["is_staff", "is_superuser"])
            self.stdout.write(f"  created {email} ({role})")

        with tenant_context(tenant.id):
            get_settings(tenant.id)
            if Pipeline.objects.filter(tenant=tenant).exists():
                self.stdout.write("Pipeline already exists")
            else:
                create_pipeline(tenant.id, "TourIQ")
                self.stdout.write("Created the TourIQ pipeline")

        self.stdout.write(self.style.SUCCESS(f"Done. Log in as nikunj@{settings.SEED_EMAIL_DOMAIN} with SEED_DEFAULT_PASSWORD."))
