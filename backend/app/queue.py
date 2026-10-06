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

# How many documents a single worker process ingests concurrently (AC-048).
# Celery reads `worker_concurrency` from config when the worker is started
# without an explicit `-c`/`--concurrency` flag, so overriding this env var
# alone is enough to raise or lower throughput; the remainder of any queued
# batch past this count simply waits in the broker until a slot frees up.
CELERY_WORKER_CONCURRENCY = int(os.getenv("CELERY_WORKER_CONCURRENCY", "4"))

celery_app = Celery(
    "rag_chatbot",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    worker_concurrency=CELERY_WORKER_CONCURRENCY,
    # A task is only acked after it finishes, and a worker killed mid-task
    # has its message rejected (requeued) rather than silently dropped --
    # together these are what make crash recovery for `ingest_document`
    # possible without any infrastructure beyond this same broker (AC-049).
    task_acks_late=True,
    task_reject_on_worker_lost=True,
)
