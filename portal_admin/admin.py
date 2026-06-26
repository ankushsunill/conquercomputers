from django.contrib import admin

from .models import BackupRun, ComplaintAttachment, PortalDocument, PortalEvent, SentDocument


@admin.register(PortalDocument)
class PortalDocumentAdmin(admin.ModelAdmin):
    list_display = ("collection", "document_id", "updated_at", "created_at")
    list_filter = ("collection", "updated_at")
    search_fields = ("collection", "document_id", "data")
    readonly_fields = ("created_at", "updated_at")


@admin.register(PortalEvent)
class PortalEventAdmin(admin.ModelAdmin):
    list_display = ("event_type", "reference", "client_name", "client_email", "created_at")
    list_filter = ("event_type", "created_at")
    search_fields = ("reference", "client_name", "client_email", "summary", "metadata")
    readonly_fields = ("created_at",)


@admin.register(SentDocument)
class SentDocumentAdmin(admin.ModelAdmin):
    list_display = ("document_type", "document_number", "job_card_id", "client_name", "client_email", "created_at")
    list_filter = ("document_type", "company_sent", "client_sent", "created_at")
    search_fields = ("document_number", "job_card_id", "client_name", "client_email", "file_name")
    readonly_fields = ("created_at",)


@admin.register(ComplaintAttachment)
class ComplaintAttachmentAdmin(admin.ModelAdmin):
    list_display = ("complaint_id", "original_name", "email", "mime_type", "size", "uploaded_at")
    list_filter = ("mime_type", "uploaded_at")
    search_fields = ("complaint_id", "uid", "email", "original_name", "stored_name")
    readonly_fields = ("uploaded_at",)


@admin.register(BackupRun)
class BackupRunAdmin(admin.ModelAdmin):
    list_display = ("file_name", "size", "created_at")
    readonly_fields = ("created_at",)
