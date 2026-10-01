"""
GET /healthz/ for load balancers and uptime checks. No login, no tenant data: it only
says whether the database and the cache answer. 200 = ready, 503 = don't send traffic.
"""
import logging

from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.http import require_GET

log = logging.getLogger(__name__)


@require_GET
def healthz(request):
    checks = {}
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
        checks["database"] = "ok"
    except Exception:  # noqa: BLE001
        log.exception("Health check: database down")
        checks["database"] = "down"
    try:
        cache.set("healthz", "1", 10)
        checks["cache"] = "ok" if cache.get("healthz") == "1" else "down"
    except Exception:  # noqa: BLE001
        log.exception("Health check: cache down")
        checks["cache"] = "down"
    ok = all(v == "ok" for v in checks.values())
    return JsonResponse({"ok": ok, **checks}, status=200 if ok else 503)
