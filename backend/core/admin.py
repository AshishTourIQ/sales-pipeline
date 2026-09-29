from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Tenant, User


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "created_at")
    prepopulated_fields = {"slug": ("name",)}


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ("email", "full_name", "tenant", "pipeline_role", "is_sales_team", "is_active")
    list_filter = ("tenant", "pipeline_role", "is_sales_team", "is_active")
    search_fields = ("email", "full_name", "username")
    ordering = ("email",)
    fieldsets = BaseUserAdmin.fieldsets + (  # type: ignore[operator]
        ("Workspace", {"fields": ("tenant", "full_name", "pipeline_role", "is_sales_team")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "username", "full_name", "tenant", "pipeline_role", "is_sales_team", "password1", "password2")}),
    )
