"""
Staff invites: an admin adds someone by email; they get a link to set their
password and are signed in.

The link carries a signed token (no table needed). It expires after
INVITE_DAYS and stops working once a password is set, because it is bound to
the user's current password hash (an invited user has an unusable one).

Stand-in for the host app's own invite flow, like the rest of `core`.
"""
from html import escape

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core import signing
from django.core.exceptions import ValidationError
from django.db import transaction

from .models import PipelineRole, User

SALT = "core.invite"


class InviteError(Exception):
    def __init__(self, detail: str, code: str, status: int = 400):
        super().__init__(detail)
        self.detail, self.code, self.status = detail, code, status


def is_pending(user: User) -> bool:
    return not user.has_usable_password()


def make_token(user: User) -> str:
    return signing.dumps({"u": str(user.id), "p": user.password[-16:]}, salt=SALT, compress=True)


def read_token(token: str) -> User:
    try:
        data = signing.loads(token, salt=SALT, max_age=settings.INVITE_DAYS * 86400)
    except signing.SignatureExpired:
        raise InviteError("This invite link has expired. Ask your admin to send a new one.", "invite_expired")
    except signing.BadSignature:
        raise InviteError("This invite link isn't valid. Check you copied the whole link.", "invite_invalid")
    user = User.objects.filter(id=data.get("u"), is_active=True).select_related("tenant").first()
    if user is None or not is_pending(user) or user.password[-16:] != data.get("p"):
        raise InviteError("This invite link has already been used. Sign in with your email and password.", "invite_used")
    return user


def invite_url(user: User) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/?invite={make_token(user)}"


def _unique_username(email: str) -> str:
    base = email.split("@")[0][:140] or "user"
    name, n = base, 1
    while User.objects.filter(username=name).exists():
        n += 1
        name = f"{base}{n}"
    return name


@transaction.atomic
def invite_user(tenant_id, inviter: User, *, email: str, name: str, role: str, sales_team: bool) -> tuple[User, bool]:
    """Create (or refresh) an invited user and email them. Returns (user, email_sent)."""
    email = email.strip().lower()
    if role not in (PipelineRole.VIEWER, PipelineRole.CONTRIBUTOR, PipelineRole.ADMIN):
        raise InviteError("Choose Viewer, Contributor or Admin.", "invalid_role")
    user = User.objects.filter(email__iexact=email).first()
    if user and user.tenant_id != tenant_id:
        raise InviteError("That email is already used in another workspace.", "email_taken")
    if user and not is_pending(user):
        if user.pipeline_role != PipelineRole.NONE:
            raise InviteError(f"{user.display_name} already has access.", "already_active")
        # Has a login but no pipeline access yet: grant it; no password email needed
        user.pipeline_role = role
        user.is_sales_team = user.is_sales_team or sales_team
        user.full_name = user.full_name or name.strip()
        user.save(update_fields=["pipeline_role", "is_sales_team", "full_name"])
        return user, False
    if user is None:
        user = User(email=email, username=_unique_username(email), tenant_id=tenant_id)
        user.set_unusable_password()
    user.full_name = name.strip() or user.full_name
    user.pipeline_role = role
    user.is_sales_team = sales_team
    user.is_active = True
    user.save()
    return user, send_invite(user, inviter)


def send_invite(user: User, inviter: User | None) -> bool:
    if not is_pending(user):
        raise InviteError(f"{user.display_name} has already set a password.", "already_active")
    # The host app sends mail its own way; here we reuse the pipeline's email helper (SMTP)
    from sales_pipeline.services.notify import send_email

    who = getattr(inviter, "display_name", "") or "Your team"
    workspace = user.tenant.name if user.tenant else "TourIQ"
    html, text = render_invite(user.display_name, who, workspace, invite_url(user), settings.INVITE_DAYS)
    return send_email([user.email], f"{who} invited you to the {workspace} sales pipeline", html, text)


def render_invite(name: str, inviter: str, workspace: str, url: str, days: int) -> tuple[str, str]:
    first = (name or "").split(" ")[0] or "there"
    html = (
        '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1A1C21">'
        '<div style="height:4px;background:#F15A24;border-radius:2px;margin-bottom:22px"></div>'
        f'<h2 style="font-size:20px;margin:0 0 10px">You\'re invited to the {escape(workspace)} sales pipeline</h2>'
        f'<p style="color:#3B4049;margin:0 0 8px;line-height:1.5">Hi {escape(first)},</p>'
        f'<p style="color:#3B4049;margin:0 0 20px;line-height:1.5">{escape(inviter)} added you to the team. '
        'Set your password to sign in. You\'ll use your email and this password from then on.</p>'
        f'<p style="margin:0 0 22px"><a href="{escape(url)}" style="display:inline-block;background:#F15A24;color:#fff;'
        'font-weight:600;text-decoration:none;padding:11px 20px;border-radius:8px">Set your password</a></p>'
        f'<p style="color:#8B919C;font-size:13px;margin:0 0 6px;line-height:1.5">The link works once and expires in {days} days. '
        'If the button doesn\'t work, paste this into your browser:</p>'
        f'<p style="color:#5A606C;font-size:12px;word-break:break-all;margin:0 0 20px">{escape(url)}</p>'
        '<p style="color:#8B919C;font-size:12px;margin:0">Not expecting this? You can ignore this email.</p></div>'
    )
    text = (f"Hi {first},\n\n{inviter} added you to the {workspace} sales pipeline. Set your password here to sign in:\n\n{url}\n\n"
            f"The link works once and expires in {days} days. You'll sign in with your email and this password from then on.\n\n"
            "Not expecting this? You can ignore this email.")
    return html, text


@transaction.atomic
def accept(token: str, password: str) -> User:
    user = read_token(token)
    try:
        validate_password(password, user)
    except ValidationError as e:
        raise InviteError(" ".join(e.messages), "weak_password")
    user.set_password(password)
    user.save(update_fields=["password"])
    return user
