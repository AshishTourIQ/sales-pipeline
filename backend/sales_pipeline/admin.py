"""
Admin is for debugging. Tenant tables are behind Row-Level Security, so the
admin only shows rows for the tenant of the logged-in staff user.
"""
from django.contrib import admin

from core.tenancy import set_current_tenant

from .models import Deal, Pipeline, Task


class TenantAdmin(admin.ModelAdmin):
    def get_queryset(self, request):
        set_current_tenant(getattr(request.user, "tenant_id", None))
        return super().get_queryset(request).filter(tenant_id=getattr(request.user, "tenant_id", None))


@admin.register(Pipeline)
class PipelineAdmin(TenantAdmin):
    list_display = ("name", "pilot_enabled", "created_at")


@admin.register(Deal)
class DealAdmin(TenantAdmin):
    list_display = ("company", "stage", "owner", "source", "stage_changed_at", "is_sample")
    list_filter = ("stage", "is_sample")
    list_select_related = ("company", "owner")


@admin.register(Task)
class TaskAdmin(TenantAdmin):
    list_display = ("title", "owner", "due", "done", "auto")
    list_filter = ("done", "auto")
