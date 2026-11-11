FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DDK_DEPLOYMENT_MODE=public \
    DDK_HOST=0.0.0.0 \
    DDK_SYSTEM_CONTROL=0

WORKDIR /app

COPY requirements-public.txt ./requirements-public.txt
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r requirements-public.txt \
    && useradd --system --create-home --uid 10001 appuser

COPY --chown=appuser:appuser server ./server
COPY --chown=appuser:appuser static ./static
RUN mkdir -p /app/data && chown appuser:appuser /app/data && chmod 700 /app/data

USER appuser
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/api/health', timeout=3)" || exit 1

CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8787", "--proxy-headers", "--forwarded-allow-ips", "127.0.0.1"]
