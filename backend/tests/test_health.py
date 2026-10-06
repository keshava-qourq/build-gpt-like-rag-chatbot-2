"""The baseline test the scaffold ships with.

The platform installs this tree and runs `pytest` against it, so there has to
be something green to run before an agent has written anything -- otherwise the
first real ticket cannot tell a broken change from a repository that never
worked.
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_reports_reachability() -> None:
    """A failure here means the application does not import or does not start.

    The values are "ok" or "error" depending on whether a real database and
    object store are reachable from wherever this runs, so only the shape --
    not a specific status -- is asserted.
    """
    response = client.get("/health")

    assert response.status_code == 200
    assert set(response.json().keys()) == {"db", "s3"}


def test_the_openapi_document_builds() -> None:
    """Every generated route contributes to the schema, so a route whose types
    FastAPI cannot resolve fails here rather than on a user's first request."""
    response = client.get("/openapi.json")

    assert response.status_code == 200
    assert "/health" in response.json()["paths"]
