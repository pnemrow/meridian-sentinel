FROM python:3.12-slim

# WeasyPrint system dependencies (cairo, pango, gdk-pixbuf, libffi, fonts).
# Without these the briefing PDF endpoint fails at import time.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    shared-mime-info \
    fonts-liberation \
    fonts-dejavu-core \
    libjpeg62-turbo \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY services/api/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Application code
COPY packages/         /app/packages/
COPY services/api/     /app/services/api/
COPY design-prototype/ /app/design-prototype/
COPY output/           /app/output/

ENV PYTHONPATH=/app

# Healthcheck so docker-compose can wait for the API to actually be serving.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
    CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000

CMD ["uvicorn", "services.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
