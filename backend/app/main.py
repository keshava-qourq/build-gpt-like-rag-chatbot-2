"""Application entrypoint.

Generated from the approved architecture: one router per component that owns
endpoints, one route per endpoint the API spec declares. Every generated route
is a stub that returns a typed placeholder, so the service starts, serves its
OpenAPI document and passes its tests before a single handler is implemented.
"""

import os
import uuid
from datetime import UTC, datetime

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app import models  # noqa: F401 -- imported so the tables register before create_all
from app.auth import require_auth
from app.database import Base, SessionLocal, engine
from app.models import Organization
from app.routers import auth, conversations, documents, invitations, users
from app.schemas import HealthResponse
from app.storage import S3_BUCKET, get_s3_client

_APP_DESCRIPTION = (
    "# Build a GPT-Like RAG Chatbot\n\n"
    "Build a modern, production-ready RAG chatbot similar to GPT.\n\n"
    "### Requirements\n"
    "- Modern ChatGPT-style UI with sidebar, chat history, new chat, and responsive design.\n"
    "- Upload PDF, DOCX, TXT, CSV and Markdown documents.\n"
    "- Extract → chunk → embed → store documents in a vector database.\n"
    "- Use semantic search to retrieve relevant document chunks.\n"
    "- Use conversation history for contextual follow-up questions.\n"
    "- Stream LLM responses in real time.\n"
    "- Show clickable citations/sources for retrieved content.\n"
    "- Never hallucinate; if information is unavailable, clearly say so.\n"
    "- Support Markdown, code blocks, tables, copy and regenerate.\n"
    "- Use clean modular architecture.\n\n"
    "### Stack\n"
    "- Frontend: React + TypeScript\n"
    "- Backend: Python + FastAPI\n"
    "- Database: PostgreSQL + pgvector\n"
    "- LLM: configurable provider\n"
    "- Embeddings: configurable provider\n"
    "- Deployment: Docker + AWS\n\n"
    "### Core Flow\n\n"
    "```text\n"
    "Upload → Extract → Chunk → Embed → pgvector\n"
    "                                      ↓\n"
    "Question → Retrieve → Context → LLM → Streaming Answer + Citations\n"
    "```\n\n"
    "Build the complete working flow, not a mock UI."
)

app = FastAPI(
    title="# Build GPT-Like RAG Chatbot (2)",
    description=_APP_DESCRIPTION,
    version="0.1.0",
)

# The SPA runs on a different origin than the API, so the browser refuses its calls
# unless that origin is allowed here. In development that is the Vite dev server; when
# deployed, the platform injects the frontend's real URL as ALLOWED_ORIGINS (comma
# separated). Point ALLOWED_ORIGINS at the real thing and nothing else has to change.
_dev_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
_allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins or _dev_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# The scaffold ships no migrations, so the tables are created from the models on
# startup. Replace this with Alembic before anything holds data worth keeping.
Base.metadata.create_all(bind=engine)


def _provision_organization() -> None:
    """This is a single-tenant deployment: there is exactly one organisation,
    named from config, and no endpoint ever accepts or returns a tenant
    selector. Provisioning it here means a fresh database always has the one
    row every org_id foreign key needs, without a separate setup step."""
    org_name = os.getenv("ORG_NAME", "Default Organization")
    org_id_raw = os.getenv("ORG_ID")

    with SessionLocal() as session:
        if session.query(Organization).first() is not None:
            return
        session.add(
            Organization(
                id=uuid.UUID(org_id_raw) if org_id_raw else uuid.uuid4(),
                name=org_name,
                created_at=datetime.now(UTC),
            )
        )
        session.commit()


_provision_organization()

app.include_router(auth.router)
app.include_router(invitations.router)
app.include_router(users.router, dependencies=[Depends(require_auth)])
app.include_router(documents.router, dependencies=[Depends(require_auth)])
app.include_router(conversations.router, dependencies=[Depends(require_auth)])


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Reachability of the database and object storage, per the api_spec.

    Neither failure raises: a dependency being down is exactly what this
    endpoint exists to report, not a reason to 500.
    """
    db_status = "ok"
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:
        db_status = "error"

    s3_status = "ok"
    try:
        get_s3_client().head_bucket(Bucket=S3_BUCKET)
    except Exception:
        s3_status = "error"

    return HealthResponse(db=db_status, s3=s3_status)
