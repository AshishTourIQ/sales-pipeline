from django.conf import settings
from rest_framework import serializers
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from . import invites
from .throttles import AuthIPThrottle, LoginEmailThrottle, RefreshThrottle
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
    throttle_classes = [AuthIPThrottle, LoginEmailThrottle]


class RefreshView(TokenRefreshView):
    throttle_classes = [RefreshThrottle]


class InviteCheckIn(serializers.Serializer):
    token = serializers.CharField(max_length=500)


class InviteAcceptIn(InviteCheckIn):
    password = serializers.CharField(max_length=200, trim_whitespace=False)


def _invite_error(e: invites.InviteError) -> Response:
    return Response({"detail": e.detail, "code": e.code}, status=e.status)


class InviteCheckView(APIView):
    """Who the invite is for, so the set-password page can greet them."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [AuthIPThrottle]

    def post(self, request: Request) -> Response:
        s = InviteCheckIn(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            u = invites.read_token(s.validated_data["token"])
        except invites.InviteError as e:
            return _invite_error(e)
        return Response({"email": u.email, "name": u.display_name, "tenant_name": u.tenant.name if u.tenant else None})


class InviteAcceptView(APIView):
    """Set the password and sign in (returns the same tokens as login)."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [AuthIPThrottle]

    def post(self, request: Request) -> Response:
        s = InviteAcceptIn(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            u = invites.accept(s.validated_data["token"], s.validated_data["password"])
        except invites.InviteError as e:
            return _invite_error(e)
        refresh = TenantTokenSerializer.get_token(u)
        return Response({"access": str(refresh.access_token), "refresh": str(refresh)})


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
