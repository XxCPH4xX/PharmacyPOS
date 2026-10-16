#!/usr/bin/env python3
"""Run local Django commands with development-only credentials outside source control."""

import os
import secrets
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
env = os.environ.copy()
local = root / ".local"
local.mkdir(exist_ok=True)
secret = local / "django-secret"
if not secret.exists():
    secret.write_text(secrets.token_urlsafe(64))
    secret.chmod(0o600)
env.setdefault("DJANGO_SECRET_KEY", secret.read_text().strip())
env.setdefault("DJANGO_DEBUG", "1")
env.setdefault("POSTGRES_PORT", "54329")
pg = local / "postgres.env"
if pg.exists():
    for line in pg.read_text().splitlines():
        key, value = line.split("=", 1)
        env.setdefault(key, value)
python = str(root / ".venv/bin/python")
args = sys.argv[1:]
command = [python, "-m", "pytest", *args[1:]] if args and args[0] == "test" else [python, "manage.py", *args]
raise SystemExit(subprocess.call(command, cwd=root / "services/api", env=env))
