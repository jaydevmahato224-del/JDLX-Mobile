FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=10000

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt gunicorn

COPY backend /app

EXPOSE 10000

CMD ["sh", "-c", "python seed_production.py && gunicorn -w 2 -b 0.0.0.0:${PORT} app:app"]
