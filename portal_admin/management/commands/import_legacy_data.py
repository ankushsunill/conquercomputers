import csv
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from website.models import WebsiteLead


class Command(BaseCommand):
    help = "Import legacy Conquer Computers CSV data into Django models."

    def add_arguments(self, parser):
        parser.add_argument(
            "--path",
            default=str(Path(settings.DATA_ROOT) / "private-leads"),
            help="Folder containing leads-YYYY-MM.csv files or a single CSV file.",
        )

    def handle(self, *args, **options):
        target = Path(options["path"])
        files = [target] if target.is_file() else sorted(target.glob("leads-*.csv"))
        imported = 0
        skipped = 0

        for file_path in files:
            with file_path.open(newline="", encoding="utf-8-sig") as handle:
                reader = csv.DictReader(handle)
                for row in reader:
                    lead_id = (row.get("leadId") or "").strip()
                    if not lead_id:
                        skipped += 1
                        continue
                    submitted_at = parse_datetime(row.get("submittedAt") or "")
                    _, created = WebsiteLead.objects.update_or_create(
                        lead_id=lead_id,
                        defaults={
                            "submitted_at": submitted_at,
                            "name": row.get("name") or "",
                            "first_name": row.get("firstName") or "",
                            "last_name": row.get("lastName") or "",
                            "email": row.get("email") or "",
                            "phone": row.get("phone") or "",
                            "service": row.get("service") or "",
                            "requirement": row.get("requirement") or "",
                            "page": row.get("page") or "",
                            "page_url": row.get("pageUrl") or "",
                            "source": row.get("source") or "Website",
                            "status": row.get("status") or "New Lead",
                            "assigned_to": row.get("assignedTo") or "",
                            "notes": row.get("notes") or "",
                            "utm_source": row.get("utm_source") or "",
                            "utm_medium": row.get("utm_medium") or "",
                            "utm_campaign": row.get("utm_campaign") or "",
                            "utm_term": row.get("utm_term") or "",
                            "utm_content": row.get("utm_content") or "",
                            "ip_address": row.get("ip") or None,
                            "user_agent": row.get("userAgent") or "",
                        },
                    )
                    imported += int(created)

        self.stdout.write(self.style.SUCCESS(f"Imported {imported} new lead(s). Skipped {skipped} row(s)."))


def parse_datetime(value: str):
    value = (value or "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            naive = datetime.strptime(value[:19], fmt)
            return timezone.make_aware(naive, timezone.get_current_timezone())
        except ValueError:
            continue
    return timezone.now()
