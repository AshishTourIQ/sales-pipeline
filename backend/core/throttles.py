"""
Rate limits for the sign-in endpoints (login, token refresh, staff invites). Counts live
in the shared cache (CACHE_URL), so every server process sees the same numbers.
Rates come from settings, so .env can change them without code.
"""
import hashlib

from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle


class _SettingRate(SimpleRateThrottle):
    setting = ""

    def get_rate(self):
        return getattr(settings, self.setting)


class AuthIPThrottle(_SettingRate):
    """Login and invite endpoints, per calling address."""

    scope = "auth_ip"
    setting = "AUTH_RATE"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class LoginEmailThrottle(_SettingRate):
    """Login attempts per email address, from any address: slows guessing one account's password."""

    scope = "login_email"
    setting = "LOGIN_EMAIL_RATE"

    def get_cache_key(self, request, view):
        email = str(request.data.get("email") or request.data.get("username") or "").strip().lower()
        if not email:
            return None
        return self.cache_format % {"scope": self.scope, "ident": hashlib.sha256(email.encode()).hexdigest()[:32]}


class RefreshThrottle(_SettingRate):
    scope = "token_refresh"
    setting = "TOKEN_REFRESH_RATE"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
