from django.db import models


class PortalDocument(models.Model):
    """Generic JSON-backed replacement for the old Firestore collections."""

    collection = models.CharField(max_length=80, db_index=True)
    document_id = models.CharField(max_length=190)
    data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["collection", "document_id"],
                name="unique_portal_document",
            )
        ]
        indexes = [
            models.Index(fields=["collection", "document_id"]),
            models.Index(fields=["collection", "updated_at"]),
        ]
        ordering = ["collection", "-updated_at"]

    def __str__(self) -> str:
        return f"{self.collection}/{self.document_id}"


class PortalEvent(models.Model):
    event_type = models.CharField(max_length=80, db_index=True)
    uid = models.CharField(max_length=160, blank=True)
    email = models.EmailField(blank=True)
    reference = models.CharField(max_length=180, blank=True, db_index=True)
    client_name = models.CharField(max_length=180, blank=True)
    client_email = models.EmailField(blank=True)
    summary = models.CharField(max_length=500, blank=True)
    page_url = models.URLField(max_length=700, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["event_type", "created_at"]),
            models.Index(fields=["reference", "created_at"]),
            models.Index(fields=["client_email", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.event_type}: {self.reference or self.summary}"


class SentDocument(models.Model):
    document_type = models.CharField(max_length=80, blank=True)
    job_card_id = models.CharField(max_length=120, blank=True, db_index=True)
    document_number = models.CharField(max_length=120, blank=True, db_index=True)
    client_name = models.CharField(max_length=160, blank=True)
    client_email = models.EmailField(blank=True)
    file_name = models.CharField(max_length=180)
    company_sent = models.BooleanField(default=False)
    client_sent = models.BooleanField(default=False)
    audit_saved = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.file_name


class ComplaintAttachment(models.Model):
    complaint_id = models.CharField(max_length=140, db_index=True)
    uid = models.CharField(max_length=160, blank=True)
    email = models.EmailField(blank=True)
    original_name = models.CharField(max_length=240)
    stored_name = models.CharField(max_length=240)
    file = models.FileField(upload_to="uploads/complaints/%Y/%m/")
    mime_type = models.CharField(max_length=120)
    size = models.PositiveIntegerField(default=0)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-uploaded_at"]

    def __str__(self) -> str:
        return f"{self.complaint_id}: {self.original_name}"


class BackupRun(models.Model):
    file_name = models.CharField(max_length=220)
    size = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.file_name
