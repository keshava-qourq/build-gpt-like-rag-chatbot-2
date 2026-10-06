"""The Celery application ingestion jobs are handed off through.

Redis is the broker locally; AWS SQS is the broker in production -- both are
valid Celery transports, so the API (which enqueues) and the worker (which
consumes) share this one app, configured entirely from `CELERY_BROKER_URL`.
The worker process itself -- extraction, chunking, embedding, status
transitions -- is the ingestion sprint's work; this module is only the shared
handle both sides import.
"""

from __future__ import annotations

import os

from celery import Celery

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", CELERY_BROKER_URL)

celery_app = Celery(
    "rag_chatbot",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
)
