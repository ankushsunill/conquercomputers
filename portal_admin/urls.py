from django.urls import path

from . import views

urlpatterns = [
    path("auth/state/", views.auth_state, name="api_auth_state"),
    path("auth/signup/", views.auth_signup, name="api_auth_signup"),
    path("auth/login/", views.auth_login, name="api_auth_login"),
    path("auth/logout/", views.auth_logout, name="api_auth_logout"),
    path("auth/password/change/", views.auth_password_change, name="api_auth_password_change"),
    path("auth/password/reset/", views.auth_password_reset, name="api_auth_password_reset"),
    path("firestore/<str:collection>/", views.firestore_collection, name="api_firestore_collection"),
    path("firestore/<str:collection>/<str:document_id>/", views.firestore_document, name="api_firestore_document"),
]
