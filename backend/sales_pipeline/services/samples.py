"""Clearly marked sample deals across every stage, removable in one call."""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from ..models import Activity, Company, Contact, Deal, StageHistory, Task
from .deals import Actor, fit_score
from . import stages as stage_list
from .pipelines import rules_for, stage_def
from .rules import RuleExtra, rule_tasks

User = get_user_model()

# company, contact, title, stage, days ago, source, platform, segment, interest, 5+ products, sells out
SAMPLE_DEALS = [
    ("Coral Coast Snorkel", "Maya Chen", "Owner", "s1", 1, "Outbound list", "FareHarbor", "Water / boat", "Warm", True, True),
    ("Bayfront Kayak Co", "Luis Ortega", "General manager", "s2", 3, "Outbound list", "Peek Pro", "Water / boat", "", True, False),
    ("Lakeside Pontoon Rentals", "Erin Walsh", "Owner", "s3", 1, "Arival report / newsletter", "FareHarbor", "Water / boat", "Warm", False, True),
    ("Harbor Lights Cruises", "Sam Patel", "Revenue manager", "s4", 6, "Pre-show outreach", "FareHarbor", "Water / boat", "Cold", True, True),
    ("Reef and Ride Adventures", "Kai Nakamura", "Owner", "s5", 0, "Arival booth", "FareHarbor", "Water / boat", "Hot", True, True),
    ("Sunset Sail Collective", "Priya Nair", "Marketing lead", "s6", 2, "Inbound (website, video)", "FareHarbor", "Water / boat", "Hot", True, True),
    ("Blue Fin Charters", "Tom Reyes", "Owner", "s7", 2, "Arival booth", "FareHarbor", "Water / boat", "Warm", True, True),
    ("Island Hop Ferries", "Grace Liu", "Operations lead", "s8", 1, "Partner referral", "Peek Pro", "Water / boat", "Warm", True, False),
    ("Dolphin Watch Tours", "Ben Carter", "General manager", "s9", 4, "Arival booth", "FareHarbor", "Water / boat", "Hot", True, True),
    ("Glass Bottom Boat Co", "Nora Hale", "Owner", "s10", 5, "Client referral", "FareHarbor", "Water / boat", "Hot", True, True),
    ("Paddle North", "Jonas Berg", "Owner", "s12", 8, "Arival booth", "FareHarbor", "Water / boat", "Warm", True, True),
    ("Whale Tail Excursions", "Ana Silva", "Revenue manager", "s13", 20, "Spark booth", "FareHarbor", "Water / boat", "Warm", True, True),
    ("Canyon Jeep Tours", "Rob Miles", "Owner", "nurture", 10, "Outbound list", "Xola", "Adventure", "Cold", False, True),
    ("River Rapids Outfitters", "Dee Brooks", "Owner", "lost", 12, "Pre-show outreach", "Other / unknown", "Adventure", "Cold", False, False),
]


@transaction.atomic
def load_samples(tenant_id, pipeline, actor: Actor) -> int:
    rules = rules_for(tenant_id)
    route = [s.key for s in stage_list.resolved(pipeline) if not s.lane and not s.optional]
    now = timezone.now()
    today = timezone.localdate()
    n = 0
    for name, cname, title, stage, days_ago, source, platform, segment, interest, p5, sells in SAMPLE_DEALS:
        if stage not in ("nurture", "lost"):
            stage = stage_list.resolve(pipeline, stage)  # the pipeline may not have every built-in stage
        company = Company.objects.create(tenant_id=tenant_id, name=name, segment=segment, platform=platform, products5=p5, sells_out=sells, reachable=True)
        contact = Contact.objects.create(tenant_id=tenant_id, company=company, name=cname, title=title, decision_maker=title == "Owner")
        at = now - timedelta(days=days_ago)
        entry = stage_list.entry_for_source(pipeline, source)
        if entry not in route:
            entry = route[0]
        lane = stage in ("nurture", "lost")
        target = stage_list.resolve(pipeline, "s4") if lane else stage
        if target not in route:
            target = entry
        steps = route[route.index(entry) + 1: route.index(target) + 1] if route.index(target) > route.index(entry) else []
        total = len(steps) + (1 if lane else 0)

        def ago(k: int):
            return now - timedelta(days=k, hours=1)

        oid = stage_def(pipeline, stage).owner_id
        owner = User.objects.filter(id=oid).first() if oid else None
        deal = Deal.objects.create(
            tenant_id=tenant_id, pipeline=pipeline, company=company, contact=contact, stage=stage, stage_changed_at=at,
            owner=owner, source=source, interest=interest, fit=fit_score(company), is_sample=True,
            snapshot_sent=stage_list.reached_or_past(pipeline, stage, "s7"),
            demo_date=f"{(today + timedelta(days=2)).isoformat()}T10:00" if stage == "s6" else "",
            payment={"status": "Paid" if stage == "s13" else "Invoiced" if stage == "s12" else "Not invoiced"},
            qual={"volume": True, "dm": True} if stage == "s8" else {},
            loss_reason="Wrong platform" if stage == "lost" else "",
            nurture_reason="Unsupported platform" if stage == "nurture" else "",
            reengage_date=today + timedelta(days=40) if stage == "nurture" else None,
            created_by=actor.user, created_at=ago(days_ago + total * 2 + 1) if total else at,
        )
        hist = [StageHistory(tenant_id=tenant_id, deal=deal, from_stage="", to_stage=entry, at=deal.created_at, by_name="Sample")]
        prev = entry
        for i, k in enumerate(steps):
            hist.append(StageHistory(tenant_id=tenant_id, deal=deal, from_stage=prev, to_stage=k, at=at if i == total - 1 else ago(days_ago + (total - i - 1) * 2), by_name="Sample"))
            prev = k
        if lane:
            hist.append(StageHistory(tenant_id=tenant_id, deal=deal, from_stage=prev, to_stage=stage, at=at, by_name="Sample"))
        StageHistory.objects.bulk_create(hist)
        Activity.objects.create(tenant_id=tenant_id, deal=deal, type="note", text="Sample deal for trying the pipeline. Not a real operator.", at=deal.created_at, by_name="Sample")
        extra = RuleExtra(demo_date=deal.demo_date, reengage_date=deal.reengage_date, loss_reason=deal.loss_reason)
        Task.objects.bulk_create([
            Task(tenant_id=tenant_id, pipeline=pipeline, deal=deal, title=t.title, owner=owner, due=t.due - timedelta(days=days_ago),
                 auto=True, rule=t.rule, stage=stage, is_sample=True, created_at=at, blocking=t.blocking)
            for t in rule_tasks(stage, rules, extra)
        ])
        n += 1
    return n


@transaction.atomic
def remove_samples(tenant_id, pipeline) -> int:
    deals = Deal.objects.filter(tenant_id=tenant_id, pipeline=pipeline, is_sample=True)
    company_ids = list(deals.values_list("company_id", flat=True))
    n = deals.count()
    Task.objects.filter(tenant_id=tenant_id, pipeline=pipeline, is_sample=True).delete()
    deals.delete()
    Company.objects.filter(tenant_id=tenant_id, id__in=company_ids, deals__isnull=True).delete()
    return n
