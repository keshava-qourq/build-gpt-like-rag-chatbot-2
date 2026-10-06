"""S3-compatible object storage client.

Originals are stored in AWS S3 in production and MinIO locally -- both speak
the S3 API, so one boto3 client configured entirely from environment
variables covers both. Leave `S3_ENDPOINT_URL` unset in production (boto3
then talks to AWS directly); point it at the local MinIO container in
development.
"""

from __future__ import annotations

import os
from functools import lru_cache

import boto3

S3_BUCKET = os.getenv("S3_BUCKET", "documents")


@lru_cache
def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT_URL") or None,
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "minioadmin"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "minioadmin"),
        region_name=os.getenv("AWS_REGION", "us-east-1"),
    )
