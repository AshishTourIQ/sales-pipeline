"""
Row-Level Security plumbing.

Every tenant-owned table has a Postgres policy that only shows rows whose
tenant_id equals the session setting app.tenant_id. We set that setting with
set_config(..., is_local=true), so it lives only until the current transaction
ends; requests are wrapped in a transaction (ATOMIC_REQUESTS).

If the setting is missing, the policies return no rows at all, so forgetting
to set the tenant fails closed.
"""
from contextlib import contextmanager
from typing import Iterator
from uuid import UUID

from django.db import connection, transaction

GUC = "app.tenant_id"


def set_current_tenant(tenant_id: UUID | str | None) -> None:
    """Scope the current transaction to one tenant. Must run inside a transaction."""
    with connection.cursor() as cur:
        cur.execute("SELECT set_config(%s, %s, true)", [GUC, str(tenant_id) if tenant_id else ""])


@contextmanager
def tenant_context(tenant_id: UUID | str) -> Iterator[None]:
    """For Celery tasks, commands and tests: open a transaction scoped to a tenant."""
    with transaction.atomic():
        set_current_tenant(tenant_id)
        yield
