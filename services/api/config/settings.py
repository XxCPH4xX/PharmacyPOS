import base64
import hashlib
import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
DEBUG = os.environ.get("DJANGO_DEBUG") == "1"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if len(SECRET_KEY) < 32:
    raise ImproperlyConfigured("Set DJANGO_SECRET_KEY to at least 32 random characters.")
if not DEBUG and os.environ.get("ALLOW_UNREVIEWED_DEPLOYMENT") != "1":
    raise ImproperlyConfigured("First release: complete the documented launch gates before deployment.")
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(",")
REQUIRE_PRIVILEGED_MFA = os.environ.get("REQUIRE_PRIVILEGED_MFA", "1") == "1"
MFA_ENCRYPTION_KEY = os.environ.get("MFA_ENCRYPTION_KEY", "")
if not MFA_ENCRYPTION_KEY and DEBUG:
    MFA_ENCRYPTION_KEY = base64.urlsafe_b64encode(
        hashlib.sha256((SECRET_KEY + ":development-mfa").encode()).digest()
    ).decode()
if not MFA_ENCRYPTION_KEY:
    raise ImproperlyConfigured("Set a separate MFA_ENCRYPTION_KEY before deployment.")
INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "rest_framework",
    "drf_spectacular",
    "core",
    "catalog",
    "inventory",
    "sales",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "core.middleware.CorrelationMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
]
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "pharmacore"),
        "USER": os.environ.get("POSTGRES_USER", "pharmacore"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""),
        "HOST": os.environ.get("POSTGRES_HOST", "127.0.0.1"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 60,
        "OPTIONS": {"options": "-c statement_timeout=15000"},
    }
}
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
USE_TZ = True
TIME_ZONE = "Asia/Dhaka"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
CSRF_TRUSTED_ORIGINS = os.environ.get(
    "CSRF_TRUSTED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
).split(",")
SESSION_COOKIE_AGE = 60 * 60 * 8
SESSION_SAVE_EVERY_REQUEST = False
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_SSL_REDIRECT = not DEBUG
SECURE_HSTS_SECONDS = 0 if DEBUG else 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = not DEBUG
SECURE_REFERRER_POLICY = "same-origin"
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "core.errors.exception_handler",
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.UserRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"user": "600/min", "login": "10/min", "register": "5/hour", "mfa": "10/min"},
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.LimitOffsetPagination",
    "PAGE_SIZE": 50,
}
SPECTACULAR_SETTINGS = {
    "TITLE": "PharmaCore API",
    "VERSION": "0.1.0",
    "DESCRIPTION": "Online pilot. Cash and staff-confirmed bKash/Nagad records; no live payment gateway. Prices are integer paisa. X-Branch-ID selects an authorized branch. Idempotency-Key is required for receiving and checkout.",
    "SERVE_PERMISSIONS": ["rest_framework.permissions.IsAuthenticated"],
}
if os.environ.get("REDIS_URL"):
    CACHES = {"default": {"BACKEND": "django_redis.cache.RedisCache", "LOCATION": os.environ["REDIS_URL"]}}
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}
