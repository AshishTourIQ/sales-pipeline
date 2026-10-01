"""
Journey steps (Touchpoint rows): what a lead has done on the way to a demo.

Recorded by the booth form, by stage moves (demo booked / held), by a person in
the deal drawer, and by the game / analysis / audit tools through /intake/.
"""
from django.utils import timezone

from ..models import Deal, Touchpoint
from . import speed

# Booked or held: the lead reached a demo (Deal.demo_at)
DEMO_KINDS = {"demo_booked", "demo_held"}

KIND_LABELS = dict(Touchpoint.KINDS)
# Which track a step belongs to (for the Journey dashboard and for placing new intake leads)
KIND_TRACK = {
    "game_played": "game", "analysis_viewed": "analysis", "analysis_sent": "analysis",
    "audit_submitted": "audit", "audit_report_sent": "audit",
}


def record(deal: Deal, kind: str, actor, *, source: str = "pipeline", at=None, score: str = "", link: str = "",
           detail: str = "", external_id: str = "", once: bool = False) -> Touchpoint | None:
    """Add a step. once=True skips it when the deal already has that kind (e.g. demo booked twice)."""
    if once and Touchpoint.objects.filter(deal=deal, kind=kind).exists():
        return None
    t = Touchpoint.objects.create(
        tenant_id=deal.tenant_id, deal=deal, kind=kind, source=source, at=at or timezone.now(), score=score[:40],
        link=link[:600], detail=detail[:500], external_id=external_id[:120],
        by=getattr(actor, "user", None), by_name=getattr(actor, "name", "") or "",
    )
    if kind in DEMO_KINDS:
        speed.mark_demo(deal.id, t.at)
    return t


def touchpoint_out(t: Touchpoint) -> dict:
    return {"id": str(t.id), "kind": t.kind, "source": t.source, "at": t.at.isoformat(), "score": t.score, "link": t.link,
            "detail": t.detail, "by_name": t.by_name}
