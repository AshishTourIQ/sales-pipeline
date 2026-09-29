from django.conf import settings
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import User


class TenantTokenSerializer(TokenObtainPairSerializer):
    """Login with email + password. The token carries the tenant and display name."""

    @classmethod
    def get_token(cls, user: User):  # type: ignore[override]
        token = super().get_token(user)
        token["tenant_id"] = str(user.tenant_id) if user.tenant_id else None
        token["name"] = user.display_name
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        if not self.user.tenant_id:  # type: ignore[union-attr]
            raise serializers.ValidationError({"detail": "This account isn't linked to a company workspace."})
        return data


class LoginView(TokenObtainPairView):
    serializer_class = TenantTokenSerializer


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        u: User = request.user  # type: ignore[assignment]
        return Response({
            "id": str(u.id),
            "name": u.display_name,
            "email": u.email,
            "tenant_id": str(u.tenant_id) if u.tenant_id else None,
            "tenant_name": u.tenant.name if u.tenant else None,
            "pipeline_role": u.pipeline_role,
            "can_write": u.can_write_pipeline,
            "can_admin": u.can_admin_pipeline,
            # Claude drafts need a server-side key; the UI hides the AI tab without one
            "ai_enabled": bool(settings.AI_ENABLED),
        })
