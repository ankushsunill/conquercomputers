import csv
import json
import mimetypes
import urllib.parse
import urllib.error
import urllib.request
from pathlib import Path

from django.conf import settings
from django.core.mail import EmailMessage, send_mail
from django.http import FileResponse, Http404, HttpRequest, HttpResponse, JsonResponse
from django.utils import timezone
from django.utils._os import safe_join
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from .models import WebsiteLead


TEMPLATE_ROOT = settings.BASE_DIR / "templates" / "website"
ROOT_STATIC_FILES = {
    "manifest.webmanifest": "application/manifest+json",
    "service-worker.js": "application/javascript",
    "robots.txt": "text/plain",
    "sitemap.xml": "application/xml",
    "offline.html": "text/html",
}


def home(request: HttpRequest) -> HttpResponse:
    return html_page(request, "index.html")


def html_page(request: HttpRequest, page: str) -> HttpResponse:
    if not page or page.endswith("/"):
        page = f"{page}index.html"
    if not page.endswith(".html"):
        raise Http404("Page not found")

    try:
        file_path = Path(safe_join(TEMPLATE_ROOT, page))
    except ValueError as exc:
        raise Http404("Page not found") from exc

    if not file_path.is_file() or TEMPLATE_ROOT not in file_path.resolve().parents:
        raise Http404("Page not found")

    return HttpResponse(file_path.read_text(encoding="utf-8", errors="replace"), content_type="text/html; charset=utf-8")


def root_static_file(request: HttpRequest, file_name: str) -> FileResponse:
    if file_name not in ROOT_STATIC_FILES:
        raise Http404("File not found")
    path = settings.BASE_DIR / "static" / file_name
    if not path.is_file():
        raise Http404("File not found")
    return FileResponse(path.open("rb"), content_type=ROOT_STATIC_FILES[file_name])


def image_file(request: HttpRequest, path: str) -> FileResponse:
    try:
        file_path = Path(safe_join(settings.BASE_DIR / "static" / "images", path))
    except ValueError as exc:
        raise Http404("Image not found") from exc
    if not file_path.is_file():
        raise Http404("Image not found")
    content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    return FileResponse(file_path.open("rb"), content_type=content_type)


def clean_text(value, max_length: int = 2000) -> str:
    text = value if isinstance(value, str) else ""
    text = "".join(ch for ch in text.strip() if ch >= " " or ch in "\r\n\t")
    text = text.replace("<", "").replace(">", "")
    return text[:max_length]


def request_json(request: HttpRequest) -> dict:
    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        data = {}
    return data if isinstance(data, dict) else {}


def client_ip(request: HttpRequest) -> str:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def append_lead_csv(lead: WebsiteLead) -> bool:
    data_root = Path(settings.DATA_ROOT)
    lead_dir = data_root / "private-leads"
    lead_dir.mkdir(parents=True, exist_ok=True)
    csv_file = lead_dir / f"leads-{timezone.localtime(lead.submitted_at):%Y-%m}.csv"
    headers = [
        "leadId",
        "submittedAt",
        "name",
        "firstName",
        "lastName",
        "email",
        "phone",
        "service",
        "requirement",
        "page",
        "pageUrl",
        "source",
        "status",
        "nextFollowUpDate",
        "assignedTo",
        "notes",
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "ip",
        "userAgent",
    ]
    is_new = not csv_file.exists()
    with csv_file.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        if is_new:
            writer.writeheader()
        writer.writerow(
            {
                "leadId": lead.lead_id,
                "submittedAt": timezone.localtime(lead.submitted_at).strftime("%Y-%m-%d %H:%M:%S"),
                "name": lead.name,
                "firstName": lead.first_name,
                "lastName": lead.last_name,
                "email": lead.email,
                "phone": lead.phone,
                "service": lead.service,
                "requirement": lead.requirement,
                "page": lead.page,
                "pageUrl": lead.page_url,
                "source": lead.source,
                "status": lead.status,
                "nextFollowUpDate": lead.next_follow_up_date or "",
                "assignedTo": lead.assigned_to,
                "notes": lead.notes,
                "utm_source": lead.utm_source,
                "utm_medium": lead.utm_medium,
                "utm_campaign": lead.utm_campaign,
                "utm_term": lead.utm_term,
                "utm_content": lead.utm_content,
                "ip": lead.ip_address or "",
                "userAgent": lead.user_agent,
            }
        )
    return True


def sync_google_sheet(payload: dict) -> tuple[bool, str]:
    webhook = getattr(settings, "GOOGLE_SHEET_WEBHOOK_URL", "")
    if not webhook:
        return False, ""
    try:
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(webhook, data=body, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=8) as response:
            return 200 <= response.status < 300, ""
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        return False, str(exc)


@csrf_exempt
@require_POST
def lead_handler(request: HttpRequest) -> JsonResponse:
    data = request_json(request)
    if not data:
        return JsonResponse({"success": False, "message": "Invalid JSON data."}, status=400)

    if clean_text(data.get("website", ""), 100):
        return JsonResponse({"success": True, "message": "Received.", "spamIgnored": True})

    first_name = clean_text(data.get("firstName", ""), 80)
    last_name = clean_text(data.get("lastName", ""), 80)
    name = clean_text(data.get("name", "") or f"{first_name} {last_name}".strip(), 180)
    email = clean_text(data.get("email", ""), 180)
    phone = clean_text(data.get("phone", ""), 90)
    service = clean_text(data.get("service", ""), 180)
    requirement = clean_text(data.get("requirement", ""), 3000)

    if not name or not phone or not service or not requirement:
        return JsonResponse({"success": False, "message": "Please fill all required fields."}, status=422)
    if email and "@" not in email:
        return JsonResponse({"success": False, "message": "Please enter a valid email address."}, status=422)
    phone_digits = "".join(ch for ch in phone if ch.isdigit())
    if len(phone_digits) < 8:
        return JsonResponse({"success": False, "message": "Please enter a valid phone number."}, status=422)

    lead = WebsiteLead.objects.create(
        name=name,
        first_name=first_name,
        last_name=last_name,
        email=email,
        phone=phone,
        service=service,
        requirement=requirement,
        page=clean_text(data.get("page", ""), 220),
        page_url=clean_text(data.get("pageUrl", ""), 700),
        source=clean_text(data.get("source", "Website"), 140) or "Website",
        utm_source=clean_text(data.get("utm_source", ""), 160),
        utm_medium=clean_text(data.get("utm_medium", ""), 160),
        utm_campaign=clean_text(data.get("utm_campaign", ""), 160),
        utm_term=clean_text(data.get("utm_term", ""), 160),
        utm_content=clean_text(data.get("utm_content", ""), 160),
        ip_address=client_ip(request) or None,
        user_agent=clean_text(request.META.get("HTTP_USER_AGENT", ""), 1200),
        metadata={"raw": {key: value for key, value in data.items() if key not in {"website"}}},
    )

    backup_saved = False
    backup_error = ""
    try:
        backup_saved = append_lead_csv(lead)
    except OSError as exc:
        backup_error = str(exc)

    subject = f"New Website Lead - {lead.service} - {lead.lead_id}"
    message = (
        "New website lead received.\n\n"
        f"Lead ID: {lead.lead_id}\n"
        f"Name: {lead.name}\n"
        f"Email: {lead.email}\n"
        f"Phone: {lead.phone}\n"
        f"Service: {lead.service}\n"
        f"Lead Score: {lead.lead_score}/100\n"
        f"Priority: {lead.priority}\n"
        f"Shortlisted: {'Yes' if lead.shortlisted else 'No'}\n"
        f"Requirement:\n{lead.requirement}\n\n"
        f"Source: {lead.source}\n"
        f"Page: {lead.page}\n"
        f"URL: {lead.page_url}\n"
        f"Date: {timezone.localtime(lead.submitted_at):%Y-%m-%d %H:%M:%S}\n"
    )

    company_email = settings.COMPANY_EMAIL
    mail_sent = False
    auto_reply_sent = False
    try:
        email_message = EmailMessage(subject, message, settings.DEFAULT_FROM_EMAIL, [company_email], reply_to=[email] if email else None)
        mail_sent = bool(email_message.send(fail_silently=True))
        if email:
            auto_reply_sent = bool(
                send_mail(
                    "We Received Your Inquiry - Conquer Computers LLC",
                    f"Dear {lead.name},\n\nThank you for contacting Conquer Computers LLC.\n\nWe have received your inquiry for {lead.service}. Our team will contact you shortly.\n\nLead Reference: {lead.lead_id}\n\nFor urgent support, call or WhatsApp us: +971 54 343 3553\n\nRegards,\nConquer Computers LLC\nDubai, UAE\nhttps://www.conquercomputers.com\n",
                    settings.DEFAULT_FROM_EMAIL,
                    [email],
                    fail_silently=True,
                )
            )
    except Exception:
        mail_sent = False
        auto_reply_sent = False

    payload = {
        "leadId": lead.lead_id,
        "submittedAt": timezone.localtime(lead.submitted_at).strftime("%Y-%m-%d %H:%M:%S"),
        "name": lead.name,
        "firstName": lead.first_name,
        "lastName": lead.last_name,
        "email": lead.email,
        "phone": lead.phone,
        "service": lead.service,
        "requirement": lead.requirement,
        "page": lead.page,
        "pageUrl": lead.page_url,
        "source": lead.source,
        "status": lead.status,
        "priority": lead.priority,
        "leadScore": lead.lead_score,
        "shortlisted": lead.shortlisted,
    }
    sheet_synced, sheet_error = sync_google_sheet(payload)

    whatsapp_text = (
        "New Website Lead\n\n"
        f"Lead ID: {lead.lead_id}\n"
        f"Name: {lead.name}\n"
        f"Email: {lead.email}\n"
        f"Phone: {lead.phone}\n"
        f"Service: {lead.service}\n"
        f"Lead Score: {lead.lead_score}/100\n"
        f"Requirement: {lead.requirement}\n"
        f"Page: {lead.page_url}"
    )
    company_phone = "".join(ch for ch in settings.COMPANY_PHONE if ch.isdigit()) or "971543433553"
    whatsapp_url = "https://wa.me/" + company_phone + "?text=" + urllib.parse.quote(whatsapp_text)

    return JsonResponse(
        {
            "success": bool(mail_sent or backup_saved),
            "message": "Lead email sent successfully." if mail_sent else "Lead saved locally. Email may need SMTP configuration.",
            "leadId": lead.lead_id,
            "emailSent": mail_sent,
            "customerAutoReplySent": auto_reply_sent,
            "backupSaved": backup_saved,
            "backupError": backup_error,
            "sheetSynced": sheet_synced,
            "sheetError": sheet_error,
            "leadScore": lead.lead_score,
            "shortlisted": lead.shortlisted,
            "whatsappUrl": whatsapp_url,
        }
    )
