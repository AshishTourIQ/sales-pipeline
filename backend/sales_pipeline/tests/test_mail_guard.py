"""The last check before any email leaves: dummy addresses and the test redirect."""
from django.core import mail

from sales_pipeline.services import client_mail, mail_guard, notify


def test_dummy_addresses_never_sent(settings):
    out = mail_guard.prepare(["jo@example.com", "a@harbor.test", "b@x.invalid", "real@consciouscreations.ai"], "S", "<p>h</p>", "t")
    assert out.to == ["real@consciouscreations.ai"] and len(out.skipped) == 3


def test_redirect_sends_only_to_the_test_inbox(settings):
    settings.EMAIL_REDIRECT_TO = "ashish@consciouscreations.ai"
    out = mail_guard.prepare(["lead@reeftours.com", "param@touriq.ai"], "Hello", "<p>hi</p>", "hi")
    assert out.to == ["ashish@consciouscreations.ai"]
    assert out.subject == "[TEST for lead@reeftours.com, param@touriq.ai] Hello"
    assert "meant for lead@reeftours.com, param@touriq.ai" in out.text


def test_team_and_lead_mail_both_guarded(settings):
    settings.EMAIL_ENABLED, settings.EMAIL_HOST_USER = True, "ai@consciouscreations.ai"
    settings.EMAIL_REDIRECT_TO = "ashish@consciouscreations.ai"
    mail.outbox.clear()
    assert notify.send_email(["param@touriq.ai"], "Digest", "<p>x</p>", "x") is True
    sent = client_mail.send("lead@reeftours.com", "Game", "<p>g</p>", "g", reply_to="param@touriq.ai")
    assert sent.ok and "test mode" in sent.detail
    assert [m.to for m in mail.outbox] == [["ashish@consciouscreations.ai"], ["ashish@consciouscreations.ai"]]
    assert mail.outbox[1].reply_to == []  # no reply-to a real person in test mode
    # A dummy lead address is never emailed, redirect or not
    blocked = client_mail.send("jo@example.com", "Game", "<p>g</p>", "g")
    assert not blocked.ok and "dummy" in blocked.detail and len(mail.outbox) == 2
