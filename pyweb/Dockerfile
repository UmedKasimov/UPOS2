FROM python:3.11-slim-bookworm

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY upos ./upos

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["sh", "-c", "exec python -m uvicorn upos.main:app --host 0.0.0.0 --port \"${PORT:-3000}\" --proxy-headers --forwarded-allow-ips=\"*\""]
