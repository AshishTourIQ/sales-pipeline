"""Every error goes out as {"detail": str, "code": str} (what the frontend reads)."""
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_handler
from rest_framework.views import set_rollback

from ..services.errors import ServiceError


def _first_message(data, _row: str = "") -> str:
    if isinstance(data, dict):
        if "detail" in data:
            return _first_message(data["detail"])
        for k, v in data.items():
            if not v:
                continue
            if isinstance(k, int):  # many=True errors keyed by item index: {1: {...}}
                return _first_message(v, f"row {k + 1}, ")
            msg = _first_message(v)
            return msg if k == "non_field_errors" else f"{_row}{k}: {msg}"
        return "Invalid input."
    if isinstance(data, list):
        # A many=True serializer gives one entry per item, {} for the valid ones: report the first bad one
        for i, item in enumerate(data):
            if item:
                row = f"row {i + 1}, " if isinstance(item, dict) and len(data) > 1 else ""
                return _first_message(item, row)
        return "Invalid input."
    return str(data)


def exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        # e.g. a non-UUID id in ?pipeline= or owner_id: a 400, not an HTML 500
        exc = ValidationError(exc.messages)
    if isinstance(exc, ServiceError):
        set_rollback()  # the request transaction must not commit half a change
        return Response({"detail": exc.detail, "code": exc.code}, status=exc.status)
    resp = drf_handler(exc, context)
    if resp is None:
        return None
    # A permission can give its own code (read_only / admin_only / no_access)
    code = getattr(getattr(exc, "detail", None), "code", None) or getattr(exc, "default_code", "error")
    if resp.status_code == status.HTTP_400_BAD_REQUEST:
        code = "invalid"
    resp.data = {"detail": _first_message(resp.data), "code": code, "errors": resp.data}
    return resp
