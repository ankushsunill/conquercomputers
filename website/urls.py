from django.urls import path, re_path

from portal_admin import views as portal_views

from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("lead-handler.php", views.lead_handler, name="lead_handler"),
    path("complaint-upload-handler.php", portal_views.complaint_upload_handler, name="complaint_upload_handler"),
    path("job-pdf-email-handler.php", portal_views.job_pdf_email_handler, name="job_pdf_email_handler"),
    path("workflow-notification-handler.php", portal_views.workflow_notification_handler, name="workflow_notification_handler"),
    path("website-data-sync.php", portal_views.website_data_sync, name="website_data_sync"),
    path("lead-crm.php", portal_views.lead_crm, name="lead_crm"),
    path("analytics-whatsapp-report.php", portal_views.daily_report, name="analytics_whatsapp_report"),
    path("daily-report.php", portal_views.daily_report, name="daily_report"),
    path("cron-backup.php", portal_views.cron_backup, name="cron_backup"),
    path("setup-health-check.php", portal_views.setup_health_check, name="setup_health_check"),
    path("images/<path:path>", views.image_file, name="image_file"),
    path("manifest.webmanifest", views.root_static_file, {"file_name": "manifest.webmanifest"}, name="manifest"),
    path("service-worker.js", views.root_static_file, {"file_name": "service-worker.js"}, name="service_worker"),
    path("robots.txt", views.root_static_file, {"file_name": "robots.txt"}, name="robots"),
    path("sitemap.xml", views.root_static_file, {"file_name": "sitemap.xml"}, name="sitemap"),
    re_path(r"^(?P<page>.+\.html)$", views.html_page, name="html_page"),
]
