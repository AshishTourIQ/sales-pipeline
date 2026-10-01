from django.urls import path

from .auth import InviteAcceptView, InviteCheckView, LoginView, MeView, RefreshView

urlpatterns = [
    path("token/", LoginView.as_view(), name="token_obtain"),
    path("token/refresh/", RefreshView.as_view(), name="token_refresh"),
    path("me/", MeView.as_view(), name="me"),
    path("invite/check/", InviteCheckView.as_view(), name="invite_check"),
    path("invite/accept/", InviteAcceptView.as_view(), name="invite_accept"),
]
