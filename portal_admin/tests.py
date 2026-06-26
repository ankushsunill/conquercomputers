import json

from django.test import TestCase

from .models import PortalDocument


class PortalApiTests(TestCase):
    def test_first_signup_creates_active_admin_profile(self):
        response = self.client.post(
            "/api/auth/signup/",
            data=json.dumps({"email": "admin@example.com", "password": "strongpass", "name": "Admin"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        profile = PortalDocument.objects.get(collection="users")
        self.assertEqual(profile.data["role"], "admin")
        self.assertTrue(profile.data["allowed"])

    def test_authenticated_firestore_round_trip(self):
        self.client.post(
            "/api/auth/signup/",
            data=json.dumps({"email": "admin@example.com", "password": "strongpass", "name": "Admin"}),
            content_type="application/json",
        )
        response = self.client.put(
            "/api/firestore/jobCards/Conquer1001/",
            data=json.dumps({"data": {"jobCardId": "Conquer1001", "workflowStatus": "New"}, "merge": True}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        response = self.client.get("/api/firestore/jobCards/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["documents"][0]["id"], "Conquer1001")
