"""Confirms every api_spec path is wired into the app, not just /health.

A route whose request/response types FastAPI cannot resolve fails to import
at all (see test_health.py's note on the OpenAPI document), but a route that
was simply never registered would pass that test silently. This is the one
that would catch it.
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

EXPECTED_PATHS = {
    "/health",
    "/auth/login",
    "/auth/logout",
    "/invitations",
    "/invitations/accept",
    "/users/{id}",
    "/documents",
    "/documents/{id}",
    "/documents/{id}/download",
    "/conversations",
    "/conversations/{id}",
    "/conversations/{id}/messages",
    "/conversations/{id}/messages/{message_id}/regenerate",
}


def test_every_api_spec_path_is_registered() -> None:
    paths = set(client.get("/openapi.json").json()["paths"].keys())
    missing = EXPECTED_PATHS - paths
    assert not missing, f"api_spec paths missing from the app: {sorted(missing)}"
