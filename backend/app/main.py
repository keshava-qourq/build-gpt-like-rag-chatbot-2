"""Application entrypoint.

Generated from the approved architecture: one router per component that owns
endpoints, one route per endpoint the API spec declares. Every generated route
is a stub that returns a typed placeholder, so the service starts, serves its
OpenAPI document and passes its tests before a single handler is implemented.
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401 -- imported so the tables register before create_all
from app.database import Base, engine

app = FastAPI(
    title="# Build GPT-Like RAG Chatbot (2)",
    description="# Build a GPT-Like RAG Chatbot\n\nBuild a modern, production-ready RAG chatbot similar to GPT.\n\n### Requirements\n- Modern ChatGPT-style UI with sidebar, chat history, new chat, and responsive design.\n- Upload PDF, DOCX, TXT, CSV and Markdown documents.\n- Extract \u2192 chunk \u2192 embed \u2192 store documents in a vector database.\n- Use semantic search to retrieve relevant document chunks.\n- Use conversation history for contextual follow-up questions.\n- Stream LLM responses in real time.\n- Show clickable citations/sources for retrieved content.\n- Never hallucinate; if information is unavailable, clearly say so.\n- Support Markdown, code blocks, tables, copy and regenerate.\n- Use clean modular architecture.\n\n### Stack\n- Frontend: React + TypeScript\n- Backend: Python + FastAPI\n- Database: PostgreSQL + pgvector\n- LLM: configurable provider\n- Embeddings: configurable provider\n- Deployment: Docker + AWS\n\n### Core Flow\n\n```text\nUpload \u2192 Extract \u2192 Chunk \u2192 Embed \u2192 pgvector\n                                      \u2193\nQuestion \u2192 Retrieve \u2192 Context \u2192 LLM \u2192 Streaming Answer + Citations\n```\n\nBuild the complete working flow, not a mock UI.",
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


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe, and the only route here that is not a stub."""
    return {"status": "ok"}
