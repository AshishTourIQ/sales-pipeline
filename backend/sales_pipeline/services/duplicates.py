"""
"Already in the pipeline?" Looked up while someone types a new lead (booth form,
New lead), so two staff logging the same operator see each other's deal. Matches
by contact email, then website domain, then company name (case, punctuation and
"LLC"/"Inc" ignored), across every pipeline. It only warns: saving is never blocked.
"""
import re

from django.db.models import Q

from ..models import Company, Deal
from .intake import _domain
from .pipelines import stage_def

LIMIT = 5
SUFFIXES = {"llc", "inc", "ltd", "limited", "co", "company", "gmbh", "sl", "sa", "pty", "corp", "the"}


def norm_name(name: str) -> str:
    words = re.findall(r"[a-z0-9]+", (name or "").lower())
    return " ".join(w for w in words if w not in SUFFIXES)


def _company_ids(tenant_id, name: str, website: str) -> dict[str, str]:
    """{company_id: how it matched} for companies with this website domain or name."""
    found: dict[str, str] = {}
    d = _domain(website)
    if d:
        for c in Company.objects.filter(tenant_id=tenant_id, website__icontains=d).only("id", "website")[:200]:
            if _domain(c.website) == d:
                found.setdefault(str(c.id), "website")
    n = norm_name(name)
    if n:
        # Narrow by the longest word, then compare the cleaned-up names
        word = max(n.split(), key=len)
        for c in Company.objects.filter(tenant_id=tenant_id, name__icontains=word).only("id", "name")[:200]:
            if norm_name(c.name) == n:
                found.setdefault(str(c.id), "company")
    return found


def find(tenant_id, *, company: str = "", email: str = "", website: str = "") -> list[dict]:
    email = (email or "").strip().lower()
    companies = _company_ids(tenant_id, company, website)
    q = Q()
    if email:
        q |= Q(contact__email__iexact=email)
    if companies:
        q |= Q(company_id__in=list(companies))
    if not q:
        return []
    deals = (Deal.objects.filter(q, tenant_id=tenant_id, is_sample=False)
             .select_related("company", "contact", "pipeline", "owner").order_by("-created_at")[:LIMIT])
    out = []
    for d in deals:
        by_email = bool(email and d.contact and d.contact.email.lower() == email)
        out.append({
            "deal_id": str(d.id), "pipeline_id": str(d.pipeline_id), "pipeline_name": d.pipeline.name,
            "company": d.company.name, "contact_name": d.contact.name if d.contact else "",
            "stage": d.stage, "stage_name": stage_def(d.pipeline, d.stage).name,
            "owner_id": str(d.owner_id) if d.owner_id else "",
            "match": "email" if by_email else companies.get(str(d.company_id), "company"),
        })
    return out
