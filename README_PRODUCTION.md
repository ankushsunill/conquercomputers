# Conquer Computers Django Production Build

This package rebuilds the existing Conquer Computers static/PHP website as a Django project while keeping the current public website UI and portal/admin UI files intact.

## What Is Included

- `website` app: public pages, root assets, image routes, and the replacement `lead-handler.php`.
- `portal_admin` app: Django-backed portal auth, Firestore-style JSON data API, complaint uploads, PDF email audits, workflow notifications, lead CRM, daily report, backup, and setup health check.
- Existing HTML, CSS, JavaScript, images, sitemap, robots, manifest, and service worker files.
- Existing private CSV lead backup copied into `data/private-leads/` and imported into `db.sqlite3`.
- `static/js/django-firebase-compat.js`, which lets the existing Firebase-style frontend work against Django.

## Quick Start

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py import_legacy_data
python manage.py collectstatic --noinput
python manage.py runserver 127.0.0.1:8000
```

Open `http://127.0.0.1:8000/`.

## Admin Access

The first account requested from `login.html` is automatically activated as an admin profile for the custom portal. Later accounts are stored as pending until an admin approves them from `admin-dashboard.html`.

For Django's built-in `/admin/`, create a superuser:

```bash
python manage.py createsuperuser
```

## Important URLs

- Website: `/`
- Portal login: `/login.html`
- Custom admin panel: `/admin-dashboard.html`
- Django admin: `/admin/`
- Lead CRM: `/lead-crm.php?token=YOUR_CRM_TOKEN`
- Daily report: `/daily-report.php?token=YOUR_REPORT_TOKEN`
- Backup: `/cron-backup.php?token=YOUR_BACKUP_TOKEN`
- Setup health check: `/setup-health-check.php?token=YOUR_SETUP_TEST_TOKEN`

## Production Notes

- Set all variables from `.env.example` in the hosting environment.
- Change `DJANGO_SECRET_KEY` and all private tokens before launch.
- Use a real SMTP account for email delivery.
- Put `DEBUG=false` for production.
- Configure the web server to serve `/static/` from `staticfiles/` and `/media/` from `media/`.
- Keep `data/private-*` folders private and outside public static hosting.

## Data

The original CSV lead backup is preserved at `data/private-leads/leads-2026-05.csv`. The same rows were imported into the default SQLite database. Re-run this any time after deployment:

```bash
python manage.py import_legacy_data
```
