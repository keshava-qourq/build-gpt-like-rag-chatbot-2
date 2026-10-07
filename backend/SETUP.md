# Setup: local development and AWS deployment

This is the complete reference for running the stack locally and deploying
it to AWS. For day-to-day backend development commands (tests, linting),
see `backend/README.md`; this document does not repeat that content.

## 1. Environment variables

Every variable the backend, worker and compose stack read, with its
purpose and whether a safe default exists. The authoritative list with
inline comments is `backend/.env.example`; copy it to `backend/.env` before
starting anything (see section 2).

| variable | purpose | safe default? |
|---|---|---|
| `DATABASE_URL` | SQLAlchemy connection string. Postgres 16 with pgvector in any real deployment; a local SQLite file otherwise. | yes -- `sqlite:///./app.db` if unset; compose overrides it to point at the `postgres` service |
| `ALLOWED_ORIGINS` | Comma-separated browser origins allowed to call the API (CORS). | yes -- falls back to the Vite dev server origins (`http://localhost:5173`, `http://127.0.0.1:5173`) if unset |
| `JWT_SECRET` | Signs and verifies session JWTs. | yes for local dev (`dev-secret-change-me`), but must be overridden outside local development |
| `JWT_EXPIRES_MINUTES` | Session token lifetime in minutes. | yes -- `1440` |
| `S3_BUCKET` | Bucket name documents are stored in. | yes -- `documents` |
| `S3_ENDPOINT_URL` | S3-compatible endpoint. Set to MinIO locally; leave unset in AWS so boto3 talks to real S3. | yes locally (MinIO URL); must be unset in AWS |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Credentials for the S3 client. Local MinIO credentials by default; in AWS, ECS task role credentials are used instead and these are not set. | yes locally; not applicable in AWS (IAM task role) |
| `AWS_REGION` | Region the S3 client and, in AWS, the stack itself operate in. | yes -- `us-east-1` |
| `CELERY_BROKER_URL` | Broker the API publishes `ingest_document` tasks to and the worker consumes from. Redis locally, SQS in AWS. | yes -- local Redis URL |
| `CELERY_WORKER_CONCURRENCY` | Documents one worker process ingests concurrently. | yes -- `4` |
| `LLM_PROVIDER` | Registry key selecting the generation provider (`app/providers/llm.py`). | yes -- `openai`, the only entry registered today |
| `LLM_MODEL` | Model name passed to the selected LLM provider. | yes -- `gpt-4o` |
| `EMBEDDINGS_PROVIDER` | Registry key selecting the embeddings provider (`app/providers/embeddings.py`). | yes -- `openai`, the only entry registered today |
| `EMBEDDINGS_MODEL` | Model name passed to the selected embeddings provider. | yes -- `text-embedding-3-small` |
| `EMBEDDINGS_DIM` | Vector dimension recorded on `chunks.embedding` and compared against stored chunks at startup. | yes -- `1536` |
| `OPENAI_API_KEY` | API key used by both the default LLM and embeddings providers. | no -- uploads and chat both fail without it |
| `ADMIN_EMAIL` | Email of the one admin account seeded on first startup. | no safe default -- unset skips seeding entirely (sign-in then happens through an invitation) |
| `ADMIN_PASSWORD` | Password for that account. | ships with a placeholder (`change-me-before-first-login`) that must be changed before real use |
| `VITE_API_BASE_URL` | Backend origin the frontend is built against. Baked into the static build at image-build time (Vite inlines `VITE_*` at build, not at container start). | yes -- `http://localhost:8000` locally |
| `FOLLOWUP_CONTEXT_TURNS` | How many recent conversation turns a follow-up question's standalone-query rewrite may see. | yes -- `6` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Credentials/db name for the `postgres` compose service. Must agree with `DATABASE_URL`. | yes -- `postgres` / `postgres` / `app` |
| `ORG_NAME` / `ORG_ID` | Name/id of the single organization provisioned on first startup (single-tenant deployment). | yes -- defaults to "Default Organization" and a random uuid |

## 2. Local Docker Compose startup, from a clean checkout

```sh
cd backend
cp .env.example .env
# edit .env: set OPENAI_API_KEY at minimum; change ADMIN_PASSWORD and
# JWT_SECRET before anything but local development
docker compose up --build
```

One command brings up every service:

| service | what it is | reachable at |
|---|---|---|
| `frontend` | the React app (Vite) | http://localhost:5173 |
| `backend` | the FastAPI API | http://localhost:8000 |
| `worker` | Celery worker consuming `ingest_document` | no port; internal |
| `redis` | Celery broker | localhost:6379 |
| `postgres` | Postgres 16 with the pgvector extension | localhost:5432 |
| `minio` | local S3-compatible object storage | http://localhost:9000 (console on :9001) |

Open http://localhost:5173 once `frontend` is up. `GET
http://localhost:8000/health` returns `{"db": "ok", "s3": "ok"}` once
`postgres` and `minio` are reachable.

## 3. Schema creation and restart behavior

There is no separate migration command. The `backend` service's compose
command is `python -m app.seed_admin && uvicorn app.main:app ...`:

1. Importing `app.main` runs `Base.metadata.create_all` (unconditional on
   every startup) against whatever `DATABASE_URL` points at -- against the
   `postgres` service this creates the full schema, including the pgvector
   `chunks.embedding` column and its ivfflat index. `create_all` only
   creates tables/indexes that do not already exist, so this is a no-op on
   every restart after the first.
2. `app/seed_admin.py` then creates one admin user from `ADMIN_EMAIL` /
   `ADMIN_PASSWORD` if no user with that email exists yet. On a restart
   where the schema and the admin user both already exist, both steps are
   no-ops: the schema is left untouched and the admin user is neither
   re-created nor updated. Leaving `ADMIN_EMAIL`/`ADMIN_PASSWORD` unset
   skips seeding entirely.

There are no Alembic migrations in this repository; schema changes ship as
additive changes to the SQLAlchemy models in `app/models.py` and rely on
`create_all`'s create-if-missing behavior.

## 4. Provider configuration: generation vs. embeddings

Generation and embeddings are configured independently, through two
separate provider registries (`app/providers/llm.py`,
`app/providers/embeddings.py`), each keyed by its own `*_PROVIDER`
variable. Both registries have exactly one entry today, `openai`.

Generation:
- `LLM_PROVIDER` -- registry key, default `openai`.
- `LLM_MODEL` -- model name passed to the provider, default `gpt-4o`.
- `OPENAI_API_KEY` -- required when `LLM_PROVIDER=openai`.

Embeddings:
- `EMBEDDINGS_PROVIDER` -- registry key, default `openai`.
- `EMBEDDINGS_MODEL` -- model name, default `text-embedding-3-small`.
- `EMBEDDINGS_DIM` -- vector dimension, default `1536`. Recorded per vector
  on `chunks.embedding_model`/`chunks.embedding_dim` at ingestion time.
- `OPENAI_API_KEY` -- same key, required when `EMBEDDINGS_PROVIDER=openai`.

**Changing the embeddings model or dimension against a database that
already has embedded chunks fails startup, deliberately.**
`app/main.py` calls `verify_embeddings_configuration` on every startup,
which compares the configured `EMBEDDINGS_MODEL`/`EMBEDDINGS_DIM` against
whatever is already recorded on existing chunks. A mismatch raises
`EmbeddingsConfigurationError` and the app never starts serving --
searching over a mix of incompatible vectors would silently return wrong
results instead. A fresh database with no chunks yet is unaffected (the
check is a no-op). Changing the embeddings provider or model against an
existing library requires re-ingesting the document library under the new
configuration before the app will start again.

## 5. AWS deployment

Artifacts live under `infra/` (`backend/infra/cloudformation.yaml`,
`backend/infra/README.md`). The template is declarative only; nothing in
the repository applies it automatically.

### 5.1 Build and push the images

```sh
# backend/worker image (same image for both)
docker build -t <account>.dkr.ecr.<region>.amazonaws.com/rag-backend:<tag> backend/
docker push <account>.dkr.ecr.<region>.amazonaws.com/rag-backend:<tag>

# frontend image
docker build -t <account>.dkr.ecr.<region>.amazonaws.com/rag-frontend:<tag> frontend/
docker push <account>.dkr.ecr.<region>.amazonaws.com/rag-frontend:<tag>
```

ECR repositories must already exist; the template does not create them.

### 5.2 Create the secrets the task definitions reference

The template never accepts a plaintext secret value, only Secrets
Manager/SSM ARNs, injected into the ECS task definitions via the
`Secrets` field. Create each secret first:

```sh
aws secretsmanager create-secret --name rag-chatbot/db-credentials \
  --secret-string '{"username":"postgres","password":"<password>"}'
aws secretsmanager create-secret --name rag-chatbot/jwt-secret \
  --secret-string '<jwt-secret-value>'
aws secretsmanager create-secret --name rag-chatbot/openai-api-key \
  --secret-string '<openai-api-key>'
aws secretsmanager create-secret --name rag-chatbot/admin-password \
  --secret-string '<initial-admin-password>'
```

Note the returned ARNs; they are passed as `DbCredentialsSecretArn`,
`JwtSecretArn`, `OpenAiApiKeySecretArn` and `AdminPasswordSecretArn`
below.

### 5.3 Provision RDS (pgvector) and the S3 bucket, then deploy

The template provisions RDS Postgres 16 (with the `vector` extension
allow-listed via its parameter group) and the S3 bucket for document
originals as part of the same stack -- there is no separate provisioning
step for either. Deploy everything together:

```sh
aws cloudformation deploy \
  --template-file backend/infra/cloudformation.yaml \
  --stack-name rag-chatbot \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
      VpcId=vpc-xxxx \
      PublicSubnetIds=subnet-aaa,subnet-bbb \
      PrivateSubnetIds=subnet-ccc,subnet-ddd \
      CertificateArn=arn:aws:acm:...:certificate/xxxx \
      BackendImage=<account>.dkr.ecr.<region>.amazonaws.com/rag-backend:<tag> \
      FrontendImage=<account>.dkr.ecr.<region>.amazonaws.com/rag-frontend:<tag> \
      FrontendOrigin=https://app.example.com \
      S3BucketName=rag-chatbot-documents-<account> \
      DbCredentialsSecretArn=arn:aws:secretsmanager:...:secret:rds-creds-xxxx \
      JwtSecretArn=arn:aws:secretsmanager:...:secret:jwt-secret-xxxx \
      OpenAiApiKeySecretArn=arn:aws:secretsmanager:...:secret:openai-key-xxxx \
      AdminPasswordSecretArn=arn:aws:secretsmanager:...:secret:admin-password-xxxx
```

The VPC/subnets, the ACM certificate and the ECR repositories are not
created by this template; provision those first. This single `deploy`
call creates the ECS cluster and its three Fargate services (`backend`,
`worker`, `frontend`), the RDS instance, the S3 bucket, and the ALB with
its HTTPS listener.

### 5.4 Verify the deployment

```sh
aws cloudformation describe-stacks --stack-name rag-chatbot \
  --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerDnsName'].OutputValue" \
  --output text
```

Then, once the ACM certificate's domain is pointed at that load balancer:

```sh
curl -i https://app.example.com/health
```

A `200` response with `{"db": "ok", "s3": "ok"}` confirms the backend
service is reachable over HTTPS through the ALB and can reach both RDS and
S3. The `backend` ECS service's `DeploymentCircuitBreaker` rolls a
deployment back automatically if this health check never reports healthy,
so a `200` here also confirms the deployment itself did not already roll
back.

## See also

- `backend/README.md` -- day-to-day backend development commands.
- `backend/infra/README.md` -- what the CloudFormation template declares
  and what it deliberately leaves for you to provision first.
