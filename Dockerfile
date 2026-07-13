FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

# IMPORTANT: the lottery state lives in memory and is shared across all
# viewers, so the app must run as a SINGLE worker (many threads). Do not scale
# to multiple workers or machines or the shared state will split.
CMD ["gunicorn", "--workers", "1", "--threads", "16", "--worker-class", "gthread", \
     "--timeout", "120", "--bind", "0.0.0.0:8080", "app:app"]
