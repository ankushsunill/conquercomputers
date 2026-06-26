import json

from django.test import TestCase

from .models import WebsiteLead


class WebsiteWorkflowTests(TestCase):
    def test_home_page_serves_existing_html(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Conquer Computers", status_code=200)

    def test_lead_handler_saves_valid_lead(self):
        payload = {
            "firstName": "Test",
            "lastName": "Customer",
            "email": "customer@example.com",
            "phone": "+971543433553",
            "service": "CCTV Installation",
            "requirement": "Need CCTV quotation for office.",
            "page": "contact",
            "pageUrl": "https://www.conquercomputers.com/contact.html",
        }
        response = self.client.post(
            "/lead-handler.php",
            data=json.dumps(payload),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["success"])
        self.assertEqual(WebsiteLead.objects.count(), 1)
        self.assertGreaterEqual(WebsiteLead.objects.first().lead_score, 70)
