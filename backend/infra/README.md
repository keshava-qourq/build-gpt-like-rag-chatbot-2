# AWS deployment (CloudFormation)

`cloudformation.yaml` is a declarative artifact only -- nothing in this
repository calls AWS or applies it. Deploy it yourself with:

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

## What it declares

- **One ECS cluster**, three Fargate services -- `backend`, `worker`,
  `frontend` -- each with its own task definition: container image,
  CPU/memory, an `awslogs` log configuration into one log group, and the
  environment it needs (AC-117).
- **RDS PostgreSQL 16** (`pgvector/pgvector`-compatible via a parameter
  group enabling `shared_preload_libraries: vector`) and an **S3 bucket**
  for document originals. `backend`/`worker` task environments set
  `DATABASE_URL` from the RDS endpoint and `S3_BUCKET`/`AWS_REGION` from
  the bucket/stack region, and never set `S3_ENDPOINT_URL` -- so
  `app/storage.py`'s boto3 client talks to the real AWS S3 endpoint, not
  the local MinIO one docker-compose points it at (AC-117).
- **An application load balancer** with one HTTPS listener (ACM
  certificate supplied by parameter) that forwards to the frontend by
  default and to the backend on `/api/*`, `/health`, `/docs`,
  `/openapi.json`. `ALLOWED_ORIGINS` on the backend task is set from the
  `FrontendOrigin` parameter -- the deployed frontend's own origin
  (AC-117).
- **Every secret** -- `OPENAI_API_KEY`, the RDS master credentials, and
  `JWT_SECRET` (plus the optional initial `ADMIN_PASSWORD`) -- is injected
  via the ECS `Secrets` field (`ValueFrom` a Secrets Manager/SSM ARN
  supplied as a template parameter), never as a plaintext `Environment`
  value. The parameters themselves hold only ARNs; no real secret value is
  ever written into this template or anywhere else in the repository
  (AC-118).
- **The backend container's health check** calls `GET /health` (same
  contract `backend/Dockerfile`'s own `HEALTHCHECK` uses); the ALB target
  group's health check hits the same path. The `backend` ECS service sets
  `DeploymentCircuitBreaker: {Enable: true, Rollback: true}`, so a task
  whose health check never reports healthy -- or starts failing it -- is
  treated as a failed deployment and rolled back rather than left serving
  traffic (AC-119).

## What you still have to do yourself

This template does not create the VPC/subnets, the ACM certificate, ECR
repositories, or the Secrets Manager secrets it references by ARN --
provision those first (or swap the relevant `Parameters` for nested
resources) and build/push `BackendImage`/`FrontendImage` before deploying.
