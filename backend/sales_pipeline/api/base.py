from rest_framework import permissions
from rest_framework.request import Request

from core.tenancy import set_current_tenant

from ..services.deals import Actor


class PipelineAccess(permissions.BasePermission):
    """
    Viewers read; contributors and admins work deals and tasks; only admins change
    pipeline set-up (the methods a view lists in `admin_methods`). Maps to host RBAC on merge.
    """

    message = "You can view this pipeline but not change it. Ask the owner for Contributor access."
    code = "read_only"

    def has_permission(self, request, view) -> bool:
        u = request.user
        if not (u and u.is_authenticated and getattr(u, "can_view_pipeline", False)):
            self.message, self.code = "You don't have access to the sales pipeline.", "no_access"
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        if not u.can_write_pipeline:
            return False
        if request.method in getattr(view, "admin_methods", ()) and not u.can_admin_pipeline:
            self.message, self.code = "Only a pipeline admin can change this. Ask an admin.", "admin_only"
            return False
        return True


WRITES = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class TenantScopedMixin:
    """
    After authentication, scope the request's transaction to the user's tenant
    so Postgres RLS policies apply. Querysets also filter by tenant explicitly
    (belt and braces).
    """

    permission_classes = [PipelineAccess]

    def initial(self, request: Request, *args, **kwargs) -> None:
        super().initial(request, *args, **kwargs)  # type: ignore[misc]
        set_current_tenant(request.user.tenant_id)

    @property
    def tenant_id(self):
        return self.request.user.tenant_id  # type: ignore[attr-defined]

    @property
    def actor(self) -> Actor:
        return Actor.of(self.request.user)  # type: ignore[attr-defined]


PAGE_DEFAULT = 500
PAGE_MAX = 1000


def paged(request: Request, qs, out) -> dict:
    """{count, next_offset, results} for ?limit=&offset= (limit at most PAGE_MAX). next_offset is
    null on the last page. Big pipelines come back in pages instead of one huge response."""
    def num(name, default):
        try:
            return max(0, int(request.query_params.get(name, default)))
        except (TypeError, ValueError):
            return default
    limit = min(PAGE_MAX, num("limit", PAGE_DEFAULT)) or PAGE_DEFAULT
    offset = num("offset", 0)
    count = qs.count()
    rows = [out(x) for x in qs[offset:offset + limit]]
    return {"count": count, "next_offset": offset + limit if offset + limit < count else None, "results": rows}
