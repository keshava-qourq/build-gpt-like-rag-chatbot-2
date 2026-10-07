# Running the stack locally

```sh
cd backend
cp .env.example .env   # fill in provider keys and the admin credentials
docker compose up --build
```

That one command brings up every service the app needs:

| service     | what it is                                   | reachable at           |
|-------------|-----------------------------------------------|-------------------------|
| `frontend`  | the React app (Vite)                          | http://localhost:5173  |
| `backend`   | the FastAPI API                               | http://localhost:8000  |
| `worker`    | Celery worker consuming `ingest_document`     | (no port; internal)    |
| `redis`     | Celery broker                                 | localhost:6379          |
| `postgres`  | Postgres 16 with the pgvector extension       | localhost:5432          |
| `minio`     | local S3-compatible object storage (no AWS)   | http://localhost:9000  |

Open http://localhost:5173 in a browser once `frontend` is up. `GET
http://localhost:8000/health` returns `{"db": "ok", "s3": "ok"}` once
`postgres` and `minio` are reachable.

## Schema and the initial admin account

There is no separate migration command to run. `backend`'s compose command
is `python -m app.seed_admin && uvicorn app.main:app ...`:

1. Importing `app.main` runs `Base.metadata.create_all` (already in the
   app, unconditional on every startup) against whatever `DATABASE_URL`
   points at. Against the `postgres` service in this stack that creates the
   full schema, including the pgvector `chunks.embedding` column and its
   `ivfflat` index. `create_all` only creates tables/indexes that do not
   already exist, so this step is a no-op on every restart after the first
   (AC-115).
2. `app/seed_admin.py` then creates one admin user from `ADMIN_EMAIL` /
   `ADMIN_PASSWORD` (see `.env.example`) if no user with that email exists
   yet -- also a no-op on restart. Sign in at http://localhost:5173 with
   those credentials. Leave either var unset to skip seeding (e.g. to add
   the first user through an invitation instead).

## Required environment variables

Every variable the compose stack reads, with its purpose, lives in
`backend/.env.example` with a safe local default already filled in except
for the four that have no safe default:

- `OPENAI_API_KEY` -- required for both `LLM_PROVIDER=openai` (default) and
  `EMBEDDINGS_PROVIDER=openai` (default); uploads and chat both fail
  without it.
- `JWT_SECRET` -- has a dev default; override it outside local development.
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` -- the initial admin account (see
  above); ships with a placeholder password that must be changed before
  real use.

Everything else (`DATABASE_URL`, `CELERY_BROKER_URL`, `S3_*`,
`ALLOWED_ORIGINS`, `POSTGRES_*`, `VITE_API_BASE_URL`, model/provider names,
etc.) has a working local default already in `.env.example` and only needs
overriding once real infrastructure (a managed Postgres, SQS, S3, a
deployed frontend origin) replaces the containers this compose file starts.

## Object storage

Local runs use `minio` (an S3-compatible service) instead of AWS -- no AWS
account or credentials are needed to run the stack locally. The one-shot
`minio-init` service creates the `S3_BUCKET` bucket on first startup and
then exits; `backend` and `worker` both wait on it completing before they
start. Point `S3_ENDPOINT_URL` at a real AWS region (or leave it unset) and
the same `app/storage.py` client talks to AWS S3 instead, with no code
change.

## Worker and broker

`worker` runs `celery -A app.ingestion:celery_app worker`, the same
`celery_app` (`app/queue.py`) the `backend` service publishes
`ingest_document` tasks to over the same `CELERY_BROKER_URL` (`redis`
here), so a document uploaded through the API progresses to `ready`
without any separate wiring (AC-116).
