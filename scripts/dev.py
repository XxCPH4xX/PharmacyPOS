#!/usr/bin/env python3
"""Start or stop the two local development processes without coupling them to a terminal."""

import json
import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCAL = ROOT / ".local"
LOCAL.mkdir(exist_ok=True)


def running(pid):
    status = Path(f"/proc/{pid}/status")
    if status.exists() and "State:\tZ" in status.read_text():
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "start"
    if action not in {"start", "stop", "status"}:
        raise SystemExit("Usage: python3 scripts/dev.py [start|stop|status]")
    env = os.environ.copy()
    runtime_file = LOCAL / "runtime.json"
    runtime = json.loads(runtime_file.read_text()) if runtime_file.exists() else {}
    if runtime.get("node"):
        env["PATH"] = str(Path(runtime["node"]).parent) + os.pathsep + env["PATH"]
    pnpm = shutil.which("pnpm", path=env["PATH"]) or runtime.get("pnpm")
    if action == "start" and not pnpm:
        raise SystemExit("Install Node.js and pnpm, then run this command again.")
    if action == "start" and (LOCAL / "postgres.env").exists() and shutil.which("podman"):
        existing = subprocess.run(["podman", "container", "exists", "pharmacore-db"], check=False)
        if existing.returncode == 0:
            subprocess.run(["podman", "start", "pharmacore-db"], check=True, stdout=subprocess.DEVNULL)
            import time

            for _ in range(30):
                ready = subprocess.run(
                    ["podman", "exec", "pharmacore-db", "pg_isready", "-U", "pharmacore"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
                if ready.returncode == 0:
                    break
                time.sleep(0.5)
            else:
                raise SystemExit("PostgreSQL is not ready. Inspect podman logs pharmacore-db.")
    commands = {
        "api": [sys.executable, str(ROOT / "scripts/api.py"), "runserver", "127.0.0.1:8000", "--noreload"],
        "web": [pnpm or "pnpm", "dev"],
    }
    for name, command in commands.items():
        pidfile = LOCAL / f"{name}.pid"
        pid = int(pidfile.read_text()) if pidfile.exists() else None
        active = pid is not None and running(pid)
        if action == "stop":
            if active:
                # Refuse to signal a reused PID belonging to a different process.
                proc = Path(f"/proc/{pid}/cmdline")
                if proc.exists() and (
                    str(ROOT / "scripts/api.py") in proc.read_text() or "pnpm" in proc.read_text()
                ):
                    os.killpg(pid, signal.SIGTERM)
                    print(f"Stopped {name}.")
                else:
                    print(f"Skipped {name}: PID ownership could not be verified.")
            pidfile.unlink(missing_ok=True)
        elif action == "status":
            print(f"{name}: {'running' if active else 'stopped'}")
        elif active:
            print(f"{name} is already running.")
        else:
            with (LOCAL / f"{name}.log").open("ab") as log:
                process = subprocess.Popen(
                    command,
                    cwd=ROOT,
                    env=env,
                    stdin=subprocess.DEVNULL,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
            pidfile.write_text(str(process.pid))
            print(f"Started {name}; log: .local/{name}.log")
    if action == "start":
        print("Open http://localhost:3000 after the web server is ready.")


if __name__ == "__main__":
    main()
