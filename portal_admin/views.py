import base64
import csv
import html
import io
import json
import mimetypes
import re
import uuid
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.core.files.base import ContentFile
from django.core.mail import EmailMessage, send_mail
from django.db.models import Q
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from website.models import WebsiteLead

from .models import BackupRun, ComplaintAttachment, PortalDocument, PortalEvent, SentDocument


ALLOWED_EVENT_TYPES = {
    "job_card",
    "complaint",
    "pdf_email",
    "financial_pdf_email",
    "quotation",
    "invoice",
    "delivery_note",
    "delivery_status",
    "complaint_status",
    "admin_job_card",
    "workflow_notification",
}

PUBLIC_COLLECTIONS = {"leads"}
OWNER_COLLECTIONS = {
    "jobCards",
    "complaints",
    "deliveryNotes",
    "quotations",
    "invoices",
    "amcContracts",
    "inventoryItems",
    "auditLogs",
}


def clean_text(value, max_length: int = 1000) -> str:
    text = str(value).strip() if value is not None else ""
    text = "".join(ch for ch in text if ch >= " " or ch in "\r\n\t")
    text = text.replace("<", "").replace(">", "")
    return text[:max_length]


def json_payload(request: HttpRequest) -> dict:
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


def uid_for_user(user) -> str:
    return str(user.pk) if user and user.is_authenticated else ""


def user_payload(user) -> dict | None:
    if not user or not user.is_authenticated:
        return None
    return {"uid": uid_for_user(user), "email": user.email or user.username or ""}


def get_profile(uid: str) -> dict:
    doc = PortalDocument.objects.filter(collection="users", document_id=str(uid)).first()
    return doc.data if doc else {}


def is_admin_user(user) -> bool:
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    profile = get_profile(uid_for_user(user))
    return (
        profile.get("role") == "admin"
        and profile.get("allowed") is not False
        and profile.get("accountStatus", "active") == "active"
    )


def can_access_collection(request: HttpRequest, collection: str, action: str, document: PortalDocument | None = None, incoming: dict | None = None) -> bool:
    if collection in PUBLIC_COLLECTIONS:
        return True
    if not request.user.is_authenticated:
        return False
    if is_admin_user(request.user):
        return True

    uid = uid_for_user(request.user)
    if collection == "users":
        target_id = document.document_id if document else str(incoming.get("document_id", "")) if incoming else ""
        return target_id in {"", uid}

    if collection == "auditLogs":
        return action == "write"

    if document:
        data = document.data or {}
        return data.get("uid") == uid or data.get("assignedStaffUid") == uid or data.get("createdByUid") == uid
    if incoming:
        return incoming.get("uid", uid) == uid or incoming.get("assignedStaffUid") == uid
    return collection in OWNER_COLLECTIONS


def make_timestamp() -> str:
    return timezone.now().isoformat()


def resolve_special_values(value):
    if isinstance(value, dict):
        if value.get("__serverTimestamp"):
            return make_timestamp()
        return {str(key): resolve_special_values(item) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve_special_values(item) for item in value]
    return value


def parse_query_value(raw: str):
    if raw in {"true", "false"}:
        return raw == "true"
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw


def field_value(data: dict, field: str):
    current = data
    for part in field.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def document_to_json(document: PortalDocument) -> dict:
    return {
        "id": document.document_id,
        "collection": document.collection,
        "data": document.data or {},
        "createdAt": document.created_at.isoformat(),
        "updatedAt": document.updated_at.isoformat(),
    }


@csrf_exempt
@require_http_methods(["GET"])
def auth_state(request: HttpRequest) -> JsonResponse:
    return JsonResponse({"user": user_payload(request.user)})


@csrf_exempt
@require_http_methods(["POST"])
def auth_signup(request: HttpRequest) -> JsonResponse:
    data = json_payload(request)
    email = clean_text(data.get("email", ""), 180).lower()
    password = str(data.get("password", ""))
    name = clean_text(data.get("name", ""), 180) or (email.split("@")[0] if email else "Client")
    if not email or "@" not in email or len(password) < 6:
        return JsonResponse({"success": False, "code": "auth/invalid-email", "message": "Enter a valid email and a password of at least 6 characters."}, status=422)

    User = get_user_model()
    if User.objects.filter(Q(username=email) | Q(email=email)).exists():
        return JsonResponse({"success": False, "code": "auth/email-already-in-use", "message": "This email is already registered."}, status=409)

    first_profile = not PortalDocument.objects.filter(collection="users").exists()
    user = User.objects.create_user(username=email, email=email, password=password, first_name=name)
    uid = uid_for_user(user)
    profile = {
        "name": name,
        "email": email,
        "role": "admin" if first_profile else "client",
        "accountStatus": "active" if first_profile else "pending",
        "active": first_profile,
        "allowed": first_profile,
        "portalAccess": {"jobCard": True, "delivery": first_profile, "complaint": first_profile},
        "createdAt": make_timestamp(),
        "updatedAt": make_timestamp(),
    }
    PortalDocument.objects.update_or_create(collection="users", document_id=uid, defaults={"data": profile})
    login(request, user)
    return JsonResponse({"success": True, "user": user_payload(user), "profile": profile})


@csrf_exempt
@require_http_methods(["POST"])
def auth_login(request: HttpRequest) -> JsonResponse:
    data = json_payload(request)
    email = clean_text(data.get("email", ""), 180).lower()
    password = str(data.get("password", ""))
    user = authenticate(request, username=email, password=password)
    if user is None:
        return JsonResponse({"success": False, "code": "auth/invalid-credential", "message": "Incorrect email or password."}, status=401)
    login(request, user)
    return JsonResponse({"success": True, "user": user_payload(user), "profile": get_profile(uid_for_user(user))})


@csrf_exempt
@require_http_methods(["POST"])
def auth_logout(request: HttpRequest) -> JsonResponse:
    logout(request)
    return JsonResponse({"success": True})


@csrf_exempt
@require_http_methods(["POST"])
def auth_password_change(request: HttpRequest) -> JsonResponse:
    if not request.user.is_authenticated:
        return JsonResponse({"success": False, "message": "Please login again."}, status=401)
    data = json_payload(request)
    current_password = str(data.get("currentPassword", ""))
    new_password = str(data.get("newPassword", ""))
    if not request.user.check_password(current_password):
        return JsonResponse({"success": False, "code": "auth/wrong-password", "message": "Current password is incorrect."}, status=400)
    if len(new_password) < 6:
        return JsonResponse({"success": False, "code": "auth/weak-password", "message": "Password should be at least 6 characters."}, status=422)
    request.user.set_password(new_password)
    request.user.save(update_fields=["password"])
    login(request, request.user)
    return JsonResponse({"success": True})


@csrf_exempt
@require_http_methods(["POST"])
def auth_password_reset(request: HttpRequest) -> JsonResponse:
    data = json_payload(request)
    email = clean_text(data.get("email", ""), 180).lower() or (request.user.email if request.user.is_authenticated else "")
    if not email:
        return JsonResponse({"success": False, "message": "Email is required."}, status=422)
    send_mail(
        "Conquer Computers Portal Password Reset",
        "A password reset was requested for your Conquer Computers portal account. Please contact the administrator if you did not request this.",
        settings.DEFAULT_FROM_EMAIL,
        [email],
        fail_silently=True,
    )
    return JsonResponse({"success": True})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def firestore_collection(request: HttpRequest, collection: str) -> JsonResponse:
    if request.method == "POST":
        data = resolve_special_values(json_payload(request).get("data", json_payload(request)))
        if not can_access_collection(request, collection, "write", incoming=data):
            return JsonResponse({"success": False, "message": "Permission denied."}, status=403)
        document_id = clean_text(data.get("id") or data.get("documentId") or uuid.uuid4().hex, 190)
        data.pop("id", None)
        data.pop("documentId", None)
        if collection != "users" and request.user.is_authenticated and "uid" not in data:
            data["uid"] = uid_for_user(request.user)
        doc = PortalDocument.objects.create(collection=collection, document_id=document_id, data=data)
        return JsonResponse({"success": True, "id": doc.document_id, "document": document_to_json(doc)})

    if not can_access_collection(request, collection, "read"):
        return JsonResponse({"success": False, "message": "Permission denied."}, status=403)

    documents = list(PortalDocument.objects.filter(collection=collection))
    if not is_admin_user(request.user) and collection not in PUBLIC_COLLECTIONS:
        uid = uid_for_user(request.user)
        documents = [
            doc for doc in documents
            if collection == "users" and doc.document_id == uid
            or (doc.data or {}).get("uid") == uid
            or (doc.data or {}).get("assignedStaffUid") == uid
            or (doc.data or {}).get("createdByUid") == uid
        ]

    where_filters = request.GET.get("where")
    if where_filters:
        try:
            filters = json.loads(where_filters)
        except json.JSONDecodeError:
            filters = []
        for item in filters if isinstance(filters, list) else []:
            field = str(item.get("field", ""))
            op = str(item.get("op", "=="))
            expected = item.get("value")
            if op == "==":
                documents = [doc for doc in documents if field_value(doc.data or {}, field) == expected]

    order_field = request.GET.get("order_field")
    order_dir = request.GET.get("order_dir", "asc")
    if order_field:
        documents.sort(key=lambda doc: field_value(doc.data or {}, order_field) or "", reverse=order_dir == "desc")

    limit = request.GET.get("limit")
    if limit and str(limit).isdigit():
        documents = documents[: int(limit)]

    return JsonResponse({"success": True, "documents": [document_to_json(doc) for doc in documents]})


@csrf_exempt
@require_http_methods(["GET", "PUT", "PATCH", "DELETE"])
def firestore_document(request: HttpRequest, collection: str, document_id: str) -> JsonResponse:
    document_id = clean_text(document_id, 190)
    doc = PortalDocument.objects.filter(collection=collection, document_id=document_id).first()

    if request.method == "GET":
        if doc and not can_access_collection(request, collection, "read", document=doc):
            return JsonResponse({"success": False, "message": "Permission denied."}, status=403)
        return JsonResponse({"success": True, "exists": bool(doc), "document": document_to_json(doc) if doc else None})

    if request.method == "DELETE":
        if not doc:
            return JsonResponse({"success": True})
        if not can_access_collection(request, collection, "delete", document=doc):
            return JsonResponse({"success": False, "message": "Permission denied."}, status=403)
        doc.delete()
        return JsonResponse({"success": True})

    payload = json_payload(request)
    data = resolve_special_values(payload.get("data", payload))
    merge = bool(payload.get("merge", False))
    if not can_access_collection(request, collection, "write", document=doc, incoming={**data, "document_id": document_id}):
        return JsonResponse({"success": False, "message": "Permission denied."}, status=403)
    if collection != "users" and request.user.is_authenticated and "uid" not in data and not doc:
        data["uid"] = uid_for_user(request.user)
    if doc and merge:
        next_data = {**(doc.data or {}), **data}
    else:
        next_data = data
    next_data.setdefault("updatedAt", make_timestamp())
    doc, _ = PortalDocument.objects.update_or_create(collection=collection, document_id=document_id, defaults={"data": next_data})
    return JsonResponse({"success": True, "id": doc.document_id, "document": document_to_json(doc)})


@csrf_exempt
@require_http_methods(["POST"])
def complaint_upload_handler(request: HttpRequest) -> JsonResponse:
    allowed = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
        "video/mp4": "mp4",
        "video/webm": "webm",
        "video/quicktime": "mov",
        "application/pdf": "pdf",
    }
    files = request.FILES.getlist("complaintFiles")
    if len(files) > 5:
        return JsonResponse({"success": False, "message": "Maximum 5 files are allowed."}, status=400)

    complaint_id = clean_text(request.POST.get("complaintId") or f"manual-{timezone.now():%Y%m%d%H%M%S}-{uuid.uuid4().hex[:8]}", 140)
    uid = clean_text(request.POST.get("uid") or uid_for_user(request.user) or "guest", 160)
    email = clean_text(request.POST.get("email") or (request.user.email if request.user.is_authenticated else ""), 180)
    uploaded = []

    for uploaded_file in files:
        if uploaded_file.size > 10 * 1024 * 1024:
            return JsonResponse({"success": False, "message": "Each file must be below 10MB."}, status=400)
        mime_type = uploaded_file.content_type or mimetypes.guess_type(uploaded_file.name)[0] or ""
        if mime_type not in allowed:
            return JsonResponse({"success": False, "message": "Only JPG, PNG, WebP, GIF, MP4, WebM, MOV, and PDF files are allowed."}, status=400)
        base_name = re.sub(r"[^A-Za-z0-9_.-]+", "-", Path(uploaded_file.name).stem).strip("-_.") or "attachment"
        stored_name = f"{base_name}-{timezone.now():%Y%m%d%H%M%S}-{uuid.uuid4().hex[:10]}.{allowed[mime_type]}"
        attachment = ComplaintAttachment(
            complaint_id=complaint_id,
            uid=uid,
            email=email,
            original_name=uploaded_file.name,
            stored_name=stored_name,
            mime_type=mime_type,
            size=uploaded_file.size,
        )
        attachment.file.save(stored_name, ContentFile(uploaded_file.read()), save=True)
        uploaded.append(
            {
                "name": uploaded_file.name,
                "url": request.build_absolute_uri(attachment.file.url),
                "type": mime_type,
                "size": uploaded_file.size,
                "storedName": stored_name,
                "complaintId": complaint_id,
                "uploadedAt": attachment.uploaded_at.isoformat(),
                "uploadedBy": email,
            }
        )
    return JsonResponse({"success": True, "message": "Files uploaded successfully.", "files": uploaded})


@csrf_exempt
@require_http_methods(["POST"])
def job_pdf_email_handler(request: HttpRequest) -> JsonResponse:
    data = json_payload(request)
    pdf_base64 = clean_text(data.get("pdfBase64", ""), 20 * 1024 * 1024)
    pdf_base64 = re.sub(r"^data:application/pdf;base64,", "", pdf_base64, flags=re.I)
    pdf_base64 = re.sub(r"\s+", "", pdf_base64)
    if not pdf_base64:
        return JsonResponse({"success": False, "message": "PDF data missing."}, status=422)
    try:
        pdf_content = base64.b64decode(pdf_base64, validate=True)
    except ValueError:
        return JsonResponse({"success": False, "message": "Invalid or empty PDF data."}, status=422)
    if len(pdf_content) < 1000 or len(pdf_content) > 8 * 1024 * 1024:
        return JsonResponse({"success": False, "message": "Invalid PDF size."}, status=422)

    client_email = clean_text(data.get("clientEmail", ""), 180)
    file_name = re.sub(r"[^A-Za-z0-9_.-]+", "-", clean_text(data.get("fileName", "conquer-computers-document.pdf"), 180)).strip("-_.")
    if not file_name.lower().endswith(".pdf"):
        file_name += ".pdf"
    document_type = clean_text(data.get("documentType", "Document"), 80) or "Document"
    document_number = clean_text(data.get("documentNumber", ""), 120)
    job_card_id = clean_text(data.get("jobCardId", ""), 120)
    client_name = clean_text(data.get("clientName", ""), 160)
    service_details = clean_text(data.get("serviceDetails", ""), 1500)

    subject = f"Conquer Computers LLC {document_type}"
    if document_number:
        subject += f" - {document_number}"
    elif job_card_id:
        subject += f" - {job_card_id}"
    body = (
        f"Dear {client_name or 'Customer'},\n\n"
        f"Please find attached your {document_type.lower()} from Conquer Computers LLC.\n\n"
        f"Reference: {document_number or job_card_id or 'N/A'}\n"
        f"Details: {service_details}\n\n"
        "For support, call or WhatsApp: +971 54 343 3553\n"
        "Website: https://www.conquercomputers.com\n\n"
        "Regards,\nConquer Computers LLC\n"
    )

    company_sent = False
    client_sent = False
    try:
        company_message = EmailMessage(subject, "PDF document generated from the website portal.\n\n" + body, settings.DEFAULT_FROM_EMAIL, [settings.COMPANY_EMAIL])
        company_message.attach(file_name, pdf_content, "application/pdf")
        company_sent = bool(company_message.send(fail_silently=True))
        if client_email:
            client_message = EmailMessage(subject, body, settings.DEFAULT_FROM_EMAIL, [client_email])
            client_message.attach(file_name, pdf_content, "application/pdf")
            client_sent = bool(client_message.send(fail_silently=True))
    except Exception:
        company_sent = False
        client_sent = False

    audit = SentDocument.objects.create(
        document_type=document_type,
        job_card_id=job_card_id,
        document_number=document_number,
        client_name=client_name,
        client_email=client_email,
        file_name=file_name,
        company_sent=company_sent,
        client_sent=client_sent,
        audit_saved=True,
    )
    return JsonResponse(
        {
            "success": bool(company_sent or client_sent or audit.pk),
            "message": "PDF email processed successfully." if company_sent or client_sent else "PDF metadata saved, but email delivery needs SMTP configuration.",
            "companySent": company_sent,
            "clientSent": client_sent,
            "auditSaved": True,
            "fileName": file_name,
        }
    )


@csrf_exempt
@require_http_methods(["POST"])
def workflow_notification_handler(request: HttpRequest) -> JsonResponse:
    data = json_payload(request)
    job_card_id = clean_text(data.get("jobCardId", ""), 120)
    customer_email = clean_text(data.get("customerEmail", ""), 180)
    customer_name = clean_text(data.get("customerName", "Customer"), 180) or "Customer"
    if not job_card_id or "@" not in customer_email:
        return JsonResponse({"success": False, "message": "Job card ID and valid customer email are required."}, status=422)

    status = clean_text(data.get("workflowStatus", "Updated"), 100)
    priority = clean_text(data.get("priority", "Normal"), 80)
    due_date = clean_text(data.get("dueDate", ""), 80)
    visit_date = clean_text(data.get("visitDate", ""), 80)
    visit_time = clean_text(data.get("visitTime", ""), 80)
    staff = clean_text(data.get("assignedStaffName", ""), 160)
    subject = f"Job Card {job_card_id} status update - Conquer Computers LLC"
    lines = [
        f"Dear {customer_name},",
        "",
        "Your service job card has been updated.",
        f"Job Card: {job_card_id}",
        f"Status: {status}",
        f"Priority: {priority}",
    ]
    if due_date:
        lines.append(f"Expected Completion: {due_date}")
    if visit_date:
        lines.append(f"Scheduled Visit: {visit_date} {visit_time}".strip())
    if staff:
        lines.append(f"Assigned Staff: {staff}")
    lines.extend(["", "Thank you,", "Conquer Computers LLC"])
    body = "\n".join(lines)
    customer_sent = send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [customer_email], fail_silently=True)
    company_sent = send_mail("[Portal Copy] " + subject, body + f"\n\nCustomer Email: {customer_email}", settings.DEFAULT_FROM_EMAIL, [settings.COMPANY_EMAIL], fail_silently=True)
    PortalEvent.objects.create(event_type="workflow_notification", reference=job_card_id, client_name=customer_name, client_email=customer_email, summary=f"Workflow Notification: {job_card_id}", metadata=data)
    return JsonResponse({"success": bool(customer_sent or company_sent), "customerSent": bool(customer_sent), "companySent": bool(company_sent), "message": "Workflow status email processed."})


@csrf_exempt
@require_http_methods(["POST"])
def website_data_sync(request: HttpRequest) -> JsonResponse:
    data = json_payload(request)
    event_type = clean_text(data.get("eventType", ""), 80)
    if event_type not in ALLOWED_EVENT_TYPES:
        return JsonResponse({"success": False, "message": "Unsupported event type."}, status=422)
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    reference = clean_text(payload.get("reference", ""), 180)
    client_name = clean_text(payload.get("clientName") or payload.get("customerName") or "", 180)
    client_email = clean_text(payload.get("clientEmail") or data.get("email") or "", 180)
    summary = f"{event_type.replace('_', ' ').title()}: {reference or client_name or 'Saved'}"
    event = PortalEvent.objects.create(
        event_type=event_type,
        uid=clean_text(data.get("uid", ""), 160),
        email=clean_text(data.get("email", ""), 180),
        reference=reference,
        client_name=client_name,
        client_email=client_email,
        summary=summary,
        page_url=clean_text(data.get("pageUrl", ""), 700),
        metadata=payload,
        ip_address=client_ip(request) or None,
        user_agent=clean_text(request.META.get("HTTP_USER_AGENT", ""), 1200),
    )
    return JsonResponse({"success": True, "message": "Event saved.", "reference": event.reference})


def token_allowed(request: HttpRequest, setting_name: str) -> bool:
    expected = str(getattr(settings, setting_name, "") or "")
    provided = str(request.GET.get("token", ""))
    return bool(expected and provided and expected == provided)


@require_GET
def lead_crm(request: HttpRequest) -> HttpResponse:
    if not token_allowed(request, "CRM_TOKEN"):
        return HttpResponse("CRM disabled or invalid token.", status=403, content_type="text/plain")
    leads = WebsiteLead.objects.all()
    q = clean_text(request.GET.get("q", ""), 120)
    status = clean_text(request.GET.get("status", ""), 40)
    priority = clean_text(request.GET.get("priority", ""), 20)
    shortlisted = clean_text(request.GET.get("shortlisted", ""), 10)
    if q:
        leads = leads.filter(Q(name__icontains=q) | Q(email__icontains=q) | Q(phone__icontains=q) | Q(service__icontains=q) | Q(requirement__icontains=q))
    if status:
        leads = leads.filter(status=status)
    if priority:
        leads = leads.filter(priority=priority)
    if shortlisted in {"1", "true", "yes"}:
        leads = leads.filter(shortlisted=True)

    if request.GET.get("format") == "csv":
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="conquer-computers-leads.csv"'
        writer = csv.writer(response)
        writer.writerow(["Lead ID", "Date", "Name", "Phone", "Email", "Service", "Status", "Priority", "Score", "Shortlisted", "Requirement"])
        for lead in leads:
            writer.writerow([lead.lead_id, timezone.localtime(lead.submitted_at).strftime("%Y-%m-%d %H:%M"), lead.name, lead.phone, lead.email, lead.service, lead.status, lead.priority, lead.lead_score, "yes" if lead.shortlisted else "no", lead.requirement])
        return response

    rows = []
    for lead in leads[:500]:
        rows.append(
            "<tr>"
            f"<td>{html.escape(timezone.localtime(lead.submitted_at).strftime('%Y-%m-%d %H:%M'))}</td>"
            f"<td>{html.escape(lead.lead_id)}</td>"
            f"<td>{html.escape(lead.name)}</td>"
            f"<td>{html.escape(lead.phone)}</td>"
            f"<td>{html.escape(lead.email)}</td>"
            f"<td>{html.escape(lead.service)}</td>"
            f"<td>{html.escape(lead.requirement)}</td>"
            f"<td><span class='badge'>{html.escape(lead.status)}</span></td>"
            f"<td>{html.escape(lead.priority)}</td>"
            f"<td>{lead.lead_score}</td>"
            f"<td>{'Yes' if lead.shortlisted else 'No'}</td>"
            f"<td>{html.escape(lead.assigned_to)}</td>"
            "</tr>"
        )
    body = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conquer Computers Lead CRM</title>
<style>
body{{font-family:Arial,sans-serif;margin:0;background:#f4f6f8;color:#111}}.wrap{{padding:24px}}h1{{margin:0 0 10px}}.small{{color:#555;font-size:12px;margin-bottom:18px}}.filters{{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}}input,select,.btn{{padding:11px;border:1px solid #cfd6df;border-radius:6px;background:#fff}}.btn{{text-decoration:none;color:#111;font-weight:700}}.table-wrap{{overflow:auto;background:#fff;border:1px solid #ddd}}table{{border-collapse:collapse;width:100%;min-width:1350px}}th,td{{border-bottom:1px solid #eee;padding:10px;text-align:left;font-size:13px;vertical-align:top}}th{{background:#111e67;color:#fff;position:sticky;top:0}}tr:hover{{background:#f8fbff}}.badge{{display:inline-block;padding:4px 8px;border-radius:999px;background:#e9f7ed;color:#157f35;font-weight:bold}}.metric{{display:inline-block;background:#fff;border:1px solid #e1e6ef;padding:10px 12px;margin:0 8px 12px 0;border-radius:6px}}
</style></head><body><div class="wrap">
<h1>Website Lead CRM</h1>
<div class="small">Advanced lead scoring, shortlist filtering, status tracking, and CSV export powered by Django.</div>
<div><span class="metric">Total: {WebsiteLead.objects.count()}</span><span class="metric">Shortlisted: {WebsiteLead.objects.filter(shortlisted=True).count()}</span><span class="metric">High score: {WebsiteLead.objects.filter(lead_score__gte=75).count()}</span></div>
<form class="filters" method="get"><input type="hidden" name="token" value="{html.escape(request.GET.get('token',''))}">
<input name="q" value="{html.escape(q)}" placeholder="Search leads"><select name="status"><option value="">All statuses</option>{"".join(f'<option value="{html.escape(choice[0])}" {"selected" if status == choice[0] else ""}>{html.escape(choice[1])}</option>' for choice in WebsiteLead.STATUS_CHOICES)}</select>
<select name="priority"><option value="">All priorities</option>{"".join(f'<option value="{html.escape(choice[0])}" {"selected" if priority == choice[0] else ""}>{html.escape(choice[1])}</option>' for choice in WebsiteLead.PRIORITY_CHOICES)}</select>
<label class="btn"><input type="checkbox" name="shortlisted" value="1" {"checked" if shortlisted in {"1","true","yes"} else ""}> Shortlisted</label><button class="btn" type="submit">Filter</button><a class="btn" href="?token={html.escape(request.GET.get('token',''))}&format=csv">Export CSV</a></form>
<div class="table-wrap"><table><thead><tr><th>Date</th><th>Lead ID</th><th>Name</th><th>Phone</th><th>Email</th><th>Service</th><th>Requirement</th><th>Status</th><th>Priority</th><th>Score</th><th>Shortlisted</th><th>Assigned</th></tr></thead><tbody>{"".join(rows) or '<tr><td colspan="12">No leads found.</td></tr>'}</tbody></table></div>
</div></body></html>"""
    return HttpResponse(body, content_type="text/html; charset=utf-8")


@require_GET
def daily_report(request: HttpRequest) -> JsonResponse:
    if not token_allowed(request, "REPORT_TOKEN"):
        return JsonResponse({"success": False, "message": "Invalid report token."}, status=403)
    date_text = clean_text(request.GET.get("date", timezone.localdate().isoformat()), 20)
    try:
        target_date = datetime.strptime(date_text, "%Y-%m-%d").date()
    except ValueError:
        return JsonResponse({"success": False, "message": "Invalid date format. Use YYYY-MM-DD."}, status=422)

    leads = WebsiteLead.objects.filter(submitted_at__date=target_date)
    events = PortalEvent.objects.filter(created_at__date=target_date)
    documents = SentDocument.objects.filter(created_at__date=target_date)
    job_events = events.filter(event_type__in=["job_card", "admin_job_card"])
    complaints = events.filter(event_type="complaint")
    pdf_events = events.filter(event_type__in=["pdf_email", "financial_pdf_email"])

    lines = [
        f"Conquer Computers Daily Website Report - {target_date}",
        "=" * 52,
        "",
        f"Website Leads: {leads.count()}",
        f"Shortlisted Leads: {leads.filter(shortlisted=True).count()}",
        f"Job Cards Saved/Updated: {job_events.count()}",
        f"Complaints Registered: {complaints.count()}",
        f"PDF Emails Triggered: {pdf_events.count()}",
        f"PDF Email Audit Rows: {documents.count()}",
        "",
        "Latest Leads:",
    ]
    for lead in leads.order_by("-submitted_at")[:5]:
        lines.append(f"- {lead.name} | {lead.phone} | {lead.service} | score {lead.lead_score}")
    if not leads.exists():
        lines.append("None")
    report_text = "\n".join(lines) + f"\n\nGenerated: {timezone.localtime():%Y-%m-%d %H:%M:%S} Asia/Dubai\n"

    report_dir = Path(settings.DATA_ROOT) / "private-reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    report_file = report_dir / f"daily-report-{target_date}.txt"
    report_file.write_text(report_text, encoding="utf-8")
    email_sent = send_mail(f"Conquer Computers Daily Website Report - {target_date}", report_text, settings.DEFAULT_FROM_EMAIL, [settings.COMPANY_EMAIL], fail_silently=True)
    whatsapp_link = "https://wa.me/" + re.sub(r"\D+", "", settings.COMPANY_PHONE) + "?text=" + re.sub(r"\s+", "%20", report_text[:3000])
    return JsonResponse(
        {
            "success": True,
            "date": str(target_date),
            "reportSaved": report_file.name,
            "emailSent": bool(email_sent),
            "whatsappSent": False,
            "whatsappSkipped": True,
            "whatsappStatus": {"manualLink": whatsapp_link, "message": "WhatsApp Cloud API is not enabled by default."},
            "counts": {
                "leads": leads.count(),
                "shortlistedLeads": leads.filter(shortlisted=True).count(),
                "jobCards": job_events.count(),
                "complaints": complaints.count(),
                "pdfEmails": pdf_events.count(),
                "pdfAuditRows": documents.count(),
            },
            "reportPreview": report_text,
        }
    )


@require_GET
def cron_backup(request: HttpRequest) -> JsonResponse:
    if not token_allowed(request, "BACKUP_TOKEN"):
        return JsonResponse({"success": False, "message": "Backup disabled or invalid token."}, status=403)
    backup_dir = Path(settings.DATA_ROOT) / "private-backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    file_name = f"conquercomputers-backup-{timezone.localtime():%Y-%m-%d-%H%M%S}.zip"
    backup_path = backup_dir / file_name
    root = settings.BASE_DIR
    with zipfile.ZipFile(backup_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in root.rglob("*"):
            if path.is_dir() or "private-backups" in path.parts or "__pycache__" in path.parts:
                continue
            archive.write(path, path.relative_to(root))
    run = BackupRun.objects.create(file_name=file_name, size=backup_path.stat().st_size)
    return JsonResponse({"success": True, "file": str(backup_path.relative_to(settings.BASE_DIR)), "size": run.size})


@require_GET
def setup_health_check(request: HttpRequest) -> HttpResponse:
    if not token_allowed(request, "SETUP_TEST_TOKEN"):
        return HttpResponse("Setup health check disabled or invalid token.", status=403, content_type="text/plain")
    checks = [
        ("Django settings loaded", True),
        ("Database reachable", PortalDocument.objects.count() >= 0),
        ("Static folder exists", (settings.BASE_DIR / "static").is_dir()),
        ("Templates folder exists", (settings.BASE_DIR / "templates" / "website").is_dir()),
        ("Media folder writable", settings.MEDIA_ROOT.exists() or settings.MEDIA_ROOT.parent.exists()),
        ("Lead handler ready", True),
        ("CRM token configured", bool(settings.CRM_TOKEN)),
        ("Backup token configured", bool(settings.BACKUP_TOKEN)),
        ("Daily report token configured", bool(settings.REPORT_TOKEN)),
        ("Email backend configured", bool(settings.EMAIL_BACKEND)),
    ]
    rows = "".join(f"<div class='row'><strong>{html.escape(label)}</strong><span class='{'ok' if ok else 'bad'}'>{'OK' if ok else 'CHECK'}</span></div>" for label, ok in checks)
    body = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conquer Computers Setup Health Check</title><style>body{{font-family:Arial,sans-serif;background:#f5f7fb;margin:0;color:#111}}.wrap{{max-width:920px;margin:40px auto;background:#fff;border:1px solid #e2e8f0;padding:24px}}h1{{margin-top:0}}.row{{display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:12px 0}}.ok{{color:#0a7a37;font-weight:700}}.bad{{color:#b42318;font-weight:700}}.note{{background:#fff7e6;padding:12px;border:1px solid #ffe0a3;margin:16px 0}}</style></head><body><div class="wrap"><h1>Setup Health Check</h1><div class="note">Keep this URL private and rotate the token before production launch.</div>{rows}</div></body></html>"""
    return HttpResponse(body, content_type="text/html; charset=utf-8")
