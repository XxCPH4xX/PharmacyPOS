FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY services/api/requirements.lock /app/requirements.lock
RUN pip install --no-cache-dir -r requirements.lock && useradd --create-home app
COPY --chown=app:app services/api /app
USER app
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--access-logfile", "-"]
