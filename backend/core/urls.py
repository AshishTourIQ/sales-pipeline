from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .auth import LoginView, MeView

urlpatterns = [
    path("token/", LoginView.as_view(), name="token_obtain"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("me/", MeView.as_view(), name="me"),
]
