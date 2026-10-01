from django.contrib import admin
from django.urls import include, path

from core.health import healthz

urlpatterns = [
    path("healthz/", healthz, name="healthz"),
    path("admin/", admin.site.urls),
    path("api/auth/", include("core.urls")),
    path("api/sales-pipeline/", include("sales_pipeline.api.urls")),
]
