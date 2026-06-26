import secrets

from django.db import models
from django.utils import timezone


class WebsiteLead(models.Model):
    """Website inquiry saved from the public lead form."""

    STATUS_CHOICES = [
        ("New Lead", "New Lead"),
        ("Contacted", "Contacted"),
        ("Qualified", "Qualified"),
        ("Quotation Sent", "Quotation Sent"),
        ("Follow-up", "Follow-up"),
        ("Converted", "Converted"),
        ("Closed/Lost", "Closed/Lost"),
    ]

    PRIORITY_CHOICES = [
        ("Low", "Low"),
        ("Normal", "Normal"),
        ("High", "High"),
        ("Urgent", "Urgent"),
    ]

    lead_id = models.CharField(max_length=80, unique=True, db_index=True)
    submitted_at = models.DateTimeField(default=timezone.now, db_index=True)
    name = models.CharField(max_length=180)
    first_name = models.CharField(max_length=90, blank=True)
    last_name = models.CharField(max_length=90, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=90)
    service = models.CharField(max_length=180)
    requirement = models.TextField()
    page = models.CharField(max_length=220, blank=True)
    page_url = models.URLField(max_length=700, blank=True)
    source = models.CharField(max_length=140, default="Website")
    status = models.CharField(max_length=40, choices=STATUS_CHOICES, default="New Lead", db_index=True)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="Normal", db_index=True)
    shortlisted = models.BooleanField(default=False, db_index=True)
    lead_score = models.PositiveSmallIntegerField(default=0, db_index=True)
    next_follow_up_date = models.DateField(null=True, blank=True, db_index=True)
    assigned_to = models.CharField(max_length=160, blank=True)
    notes = models.TextField(blank=True)
    converted_to_job_card_id = models.CharField(max_length=120, blank=True)
    follow_up_count = models.PositiveIntegerField(default=0)
    last_contacted_at = models.DateTimeField(null=True, blank=True)
    utm_source = models.CharField(max_length=160, blank=True)
    utm_medium = models.CharField(max_length=160, blank=True)
    utm_campaign = models.CharField(max_length=160, blank=True)
    utm_term = models.CharField(max_length=160, blank=True)
    utm_content = models.CharField(max_length=160, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-submitted_at"]
        indexes = [
            models.Index(fields=["status", "priority", "shortlisted"]),
            models.Index(fields=["service", "submitted_at"]),
            models.Index(fields=["lead_score", "submitted_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.lead_id} - {self.name}"

    def save(self, *args, **kwargs):
        if not self.lead_id:
            self.lead_id = make_lead_id()
        self.lead_score = score_lead(self)
        if self.lead_score >= 75 or self.priority in {"High", "Urgent"}:
            self.shortlisted = True
        super().save(*args, **kwargs)


def make_lead_id() -> str:
    local_now = timezone.localtime()
    suffix = secrets.token_hex(3).upper()
    return f"CCL-{local_now:%Y%m%d-%H%M%S}-{suffix}"


def score_lead(lead: WebsiteLead) -> int:
    score = 25
    service = (lead.service or "").lower()
    requirement = (lead.requirement or "").lower()

    high_value_terms = ["amc", "cctv", "network", "server", "emergency", "website", "quotation"]
    if any(term in service for term in high_value_terms):
        score += 25
    if any(term in requirement for term in ["urgent", "today", "asap", "quotation", "office", "contract"]):
        score += 20
    if lead.email:
        score += 10
    if len(lead.requirement or "") >= 80:
        score += 10
    if lead.utm_campaign or lead.utm_source:
        score += 10
    return min(score, 100)
