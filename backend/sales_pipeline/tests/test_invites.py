"""Staff invites: admin invites by email, the link sets a password and signs them in."""
import re

from rest_framework.test import APIClient

from core.invites import make_token
from core.models import User
from sales_pipeline.services import notify

INVITE = "/api/sales-pipeline/users/"


def link_token() -> str:
    m = re.search(r"\?invite=([^\s\"<]+)", notify.OUTBOX[-1].text)
    assert m
    return m.group(1)


def invite(admin_api, **over):
    body = {"name": "Tatiana Ruiz", "email": "Tatiana@Example.test", "role": "contributor", "sales_team": True}
    body.update(over)
    return admin_api.post(INVITE, body, format="json")


def test_invite_email_and_accept(admin_api, ws):
    notify.OUTBOX.clear()
    r = invite(admin_api)
    assert r.status_code == 201, r.data
    assert r.data["pending"] is True and r.data["email"] == "tatiana@example.test" and r.data["role"] == "contributor"
    mail = notify.OUTBOX[-1]
    assert mail.to == ["tatiana@example.test"] and "invited you" in mail.subject and "Set your password" in mail.html

    anon = APIClient()
    token = link_token()
    check = anon.post("/api/auth/invite/check/", {"token": token}, format="json")
    assert check.status_code == 200 and check.data["name"] == "Tatiana Ruiz"

    weak = anon.post("/api/auth/invite/accept/", {"token": token, "password": "123"}, format="json")
    assert weak.status_code == 400 and weak.data["code"] == "weak_password"

    ok = anon.post("/api/auth/invite/accept/", {"token": token, "password": "Booth-Arival-2026!"}, format="json")
    assert ok.status_code == 200 and ok.data["access"] and ok.data["refresh"]

    login = anon.post("/api/auth/token/", {"email": "tatiana@example.test", "password": "Booth-Arival-2026!"}, format="json")
    assert login.status_code == 200
    # The link works once
    again = anon.post("/api/auth/invite/accept/", {"token": token, "password": "Another-Pass-99!"}, format="json")
    assert again.status_code == 400 and again.data["code"] == "invite_used"


def test_invited_person_joins_team_and_user_list(admin_api, ws):
    invite(admin_api)
    team = admin_api.get("/api/sales-pipeline/settings/").data["team"]
    assert "Tatiana Ruiz" in [m["name"] for m in team]
    users = {u["email"]: u for u in admin_api.get(INVITE).data}
    assert users["tatiana@example.test"]["pending"] is True
    assert users["nikunj@touriq.test"]["pending"] is False


def test_resend(admin_api, ws):
    uid = invite(admin_api).data["id"]
    notify.OUTBOX.clear()
    r = admin_api.post(f"{INVITE}{uid}/resend-invite/", {}, format="json")
    assert r.status_code == 200 and len(notify.OUTBOX) == 1


def test_only_admins_invite(api, ws):
    assert invite(api).status_code == 403


def test_existing_active_user_not_reinvited(admin_api, ws):
    r = invite(admin_api, email="param@touriq.test")
    assert r.status_code == 400 and r.data["code"] == "already_active"


def test_bad_and_tampered_tokens(admin_api, ws):
    anon = APIClient()
    assert anon.post("/api/auth/invite/check/", {"token": "nope"}, format="json").data["code"] == "invite_invalid"
    # A token for someone who already has a password is refused
    u = User.objects.get(email="param@touriq.test")
    assert anon.post("/api/auth/invite/check/", {"token": make_token(u)}, format="json").data["code"] == "invite_used"
