"""
Tenants and users. This is a stand-in for the host app's own models: when the
module is merged, sales_pipeline points at the host's Tenant and User instead.
"""
import uuid

from django.contrib.auth.models import AbstractUser, UserManager
from django.db import models


class Tenant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    slug = models.SlugField(unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.name


class PipelineRole(models.TextChoices):
    NONE = "none", "No access"
    VIEWER = "viewer", "Viewer (read only)"
    CONTRIBUTOR = "contributor", "Contributor"
    ADMIN = "admin", "Admin"


class EmailUserManager(UserManager):
    def create_user(self, email, password=None, **extra):  # type: ignore[override]
        extra.setdefault("username", email.split("@")[0])
        return super().create_user(extra.pop("username"), email, password, **extra)

    def create_superuser(self, email, password=None, **extra):  # type: ignore[override]
        extra.setdefault("username", email.split("@")[0])
        return super().create_superuser(extra.pop("username"), email, password, **extra)


class User(AbstractUser):
    """Corporate staff log in with email + password (per tenant)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    tenant = models.ForeignKey(Tenant, null=True, blank=True, on_delete=models.PROTECT, related_name="users")
    full_name = models.CharField(max_length=200, blank=True)
    # Sales pipeline access (maps to host RBAC on merge)
    pipeline_role = models.CharField(max_length=20, choices=PipelineRole.choices, default=PipelineRole.NONE)
    # Shown in owner pickers and as a stage owner
    is_sales_team = models.BooleanField(default=False)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username"]
    objects = EmailUserManager()

    @property
    def display_name(self) -> str:
        return self.full_name or self.get_full_name() or self.username

    @property
    def can_view_pipeline(self) -> bool:
        return self.tenant_id is not None and self.pipeline_role != PipelineRole.NONE

    @property
    def can_write_pipeline(self) -> bool:
        return self.tenant_id is not None and self.pipeline_role in (PipelineRole.CONTRIBUTOR, PipelineRole.ADMIN)

    @property
    def can_admin_pipeline(self) -> bool:
        """Pipeline set-up (settings, team, stages, pipelines, import, samples, stage tasks) is admin-only."""
        return self.tenant_id is not None and self.pipeline_role == PipelineRole.ADMIN
