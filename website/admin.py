from django.contrib import admin

from .models import WebsiteLead


@admin.register(WebsiteLead)
class WebsiteLeadAdmin(admin.ModelAdmin):
    list_display = (
        "lead_id",
        "submitted_at",
        "name",
        "phone",
        "service",
        "status",
        "priority",
        "lead_score",
        "shortlisted",
        "assigned_to",
    )
    list_filter = ("status", "priority", "shortlisted", "service", "submitted_at")
    search_fields = ("lead_id", "name", "email", "phone", "service", "requirement")
    readonly_fields = ("lead_id", "lead_score", "created_at", "updated_at")
    date_hierarchy = "submitted_at"
    ordering = ("-submitted_at",)
