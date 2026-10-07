FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Run as an unprivileged user. The service never needs root, and a container that
# drops it limits what a compromise of the app can do to the host.
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000

# Reports the container unhealthy when the app stops answering. Uses the Python
# standard library rather than curl, which the slim base image does not ship.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=3)"

# Schema creation (Base.metadata.create_all, additive/idempotent) and the
# one-shot admin seed (app/seed_admin.py, idempotent -- a no-op once the
# admin user exists) both happen as a side effect of importing app.main, so
# running them before uvicorn starts serving means every deploy -- including
# the ECS Fargate task this image runs as -- has its schema and initial
# admin account in place before the health check can pass. No --reload: this
# is the production entrypoint, not the local dev one.
CMD ["sh", "-c", "python -m app.seed_admin && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
