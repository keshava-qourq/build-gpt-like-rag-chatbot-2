"""Session-wide test setup.

The suite's sqlite database (`DATABASE_URL`'s default, `./app.db`) is a file
on disk shared across test runs, not reset between them. `app.main` runs an
embeddings-configuration consistency check at import time (AC-067), so a
chunk left over from an earlier run with a stale `embedding_model`/`dim`
would fail collection for every test module that imports `app.main` --
before any individual test's own fixtures get a chance to clean up after
themselves. Clearing these tables here, before collection imports anything,
keeps each `pytest` invocation starting from an empty table set regardless of
what a previous run left behind.
"""

from __future__ import annotations

from app.database import SessionLocal
from app.models import Chunk, Citation, Document, Message

_session = SessionLocal()
try:
    _session.query(Citation).delete()
    _session.query(Message).delete()
    _session.query(Chunk).delete()
    _session.query(Document).delete()
    _session.commit()
finally:
    _session.close()
