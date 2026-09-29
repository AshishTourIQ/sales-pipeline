"""
One-time setup: create the app's Postgres role and database.

Reads POSTGRES_ADMIN_URL (your admin login) and DATABASE_URL (the app login to
create) from .env. Safe to run again: it only creates what's missing and
resets the app role's password to the one in DATABASE_URL.

The app role is NOT a superuser and has NOBYPASSRLS, so Row-Level Security
always applies to it. CREATEDB lets the test runner create its test database.
"""
from urllib.parse import unquote, urlparse

import psycopg
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from psycopg import sql

import environ


def _plain_postgres_url(url: str) -> str:
    """Accept SQLAlchemy-style URLs (postgresql+asyncpg://...) and a missing database name."""
    p = urlparse(url)
    scheme = p.scheme.split("+", 1)[0]
    path = p.path if p.path not in ("", "/") else "/postgres"
    return p._replace(scheme=scheme, path=path).geturl()


class Command(BaseCommand):
    help = "Create the Postgres role and database named in DATABASE_URL (uses POSTGRES_ADMIN_URL)."

    def handle(self, *args, **opts):
        env = environ.Env()
        environ.Env.read_env(settings.BASE_DIR / ".env")
        admin_url = env("POSTGRES_ADMIN_URL", default="")
        app_url = env("DATABASE_URL", default="")
        if not admin_url or "CHANGE_ME" in admin_url:
            raise CommandError("Set POSTGRES_ADMIN_URL in backend/.env to your Postgres admin login first.")

        admin_url = _plain_postgres_url(admin_url)
        app = urlparse(app_url)
        role, password, dbname = unquote(app.username or ""), unquote(app.password or ""), app.path.lstrip("/")
        if not (role and password and dbname):
            raise CommandError("DATABASE_URL must include user, password and database name.")
        if role == "postgres":
            raise CommandError("DATABASE_URL must use a separate app role, not 'postgres' (superusers bypass RLS).")

        try:
            conn = psycopg.connect(admin_url, autocommit=True)
        except psycopg.Error as e:
            # Don't echo the URL: it contains the admin password
            reason = str(e).splitlines()[-1] if str(e) else type(e).__name__
            raise CommandError(f"Couldn't connect with POSTGRES_ADMIN_URL: {reason.replace(admin_url, '<admin url>')}") from None
        with conn:
            exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", [role]).fetchone()
            verb = "ALTER" if exists else "CREATE"
            conn.execute(
                sql.SQL("{} ROLE {} LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB PASSWORD {}").format(
                    sql.SQL(verb), sql.Identifier(role), sql.Literal(password)
                )
            )
            self.stdout.write(f"{'Updated' if exists else 'Created'} role {role}")

            if conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", [dbname]).fetchone():
                self.stdout.write(f"Database {dbname} already exists")
            else:
                conn.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(sql.Identifier(dbname), sql.Identifier(role)))
                self.stdout.write(f"Created database {dbname}")

        self.stdout.write(self.style.SUCCESS("Done. Next: python manage.py migrate"))
