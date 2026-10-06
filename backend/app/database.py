"""Engine, session factory and the request-scoped session dependency.

SQLite by default so a fresh clone runs with nothing but `pip install -r
requirements.txt` -- the approved architecture may name Postgres or MySQL, but
naming one is not the same as having one, and a scaffold that cannot start
without a database server is a scaffold nobody runs. Point `DATABASE_URL` at
the real thing when it exists; nothing else has to change.
"""

import os
from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")

# SQLite rejects a connection made on one thread and used on another, which is
# exactly what happens when FastAPI runs a sync dependency in its threadpool.
_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=_connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


if engine.dialect.name == "postgresql":
    # The `chunks.embedding` column (see app/models.py) needs the pgvector
    # extension. Creating it on first connect means pointing DATABASE_URL at a
    # plain Postgres 16 instance is enough -- nothing manual to run first.
    @event.listens_for(engine, "connect")
    def _ensure_pgvector_extension(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("CREATE EXTENSION IF NOT EXISTS vector")
        cursor.close()
        dbapi_connection.commit()


class Base(DeclarativeBase):
    """Declarative base that every generated model inherits."""


def get_db() -> Iterator[Session]:
    """One session per request, closed even when the handler raises."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
