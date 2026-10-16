
#!/usr/bin/env bash

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

API_PID=""
WEB_PID=""

check_port() {
    local port="$1"

    if (echo >"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
        echo "Port $port is already in use."
        echo "Stop the existing server before starting PharmacyPOS."
        exit 1
    fi
}

cleanup() {
    trap - EXIT INT TERM

    echo
    echo "Stopping PharmacyPOS development servers..."

    if [[ -n "$WEB_PID" ]]; then
        kill -- "-$WEB_PID" 2>/dev/null || true
    fi

    if [[ -n "$API_PID" ]]; then
        kill -- "-$API_PID" 2>/dev/null || true
    fi

    wait 2>/dev/null || true
    echo "Servers stopped."
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ! -x "$ROOT/.venv/bin/python" ]]; then
    echo "Python virtual environment not found: .venv"
    exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is not installed or not available in PATH."
    exit 1
fi

if [[ ! -d "$ROOT/apps/web/node_modules" ]]; then
    echo "Frontend dependencies are missing."
    echo "Run: pnpm install --frozen-lockfile"
    exit 1
fi

check_port 8000
check_port 3000

echo "Starting PharmacyPOS..."
echo

echo "[1/2] Starting Django API..."
setsid "$ROOT/.venv/bin/python" "$ROOT/scripts/api.py" \
    runserver --noreload 127.0.0.1:8000 &
API_PID=$!

sleep 2

if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "Django failed to start."
    exit 1
fi

echo
echo "[2/2] Starting Next.js..."
setsid pnpm --dir "$ROOT/apps/web" exec next dev \
    --hostname 127.0.0.1 --port 3000 &
WEB_PID=$!

sleep 2

if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "Next.js failed to start."
    exit 1
fi

echo
echo "------------------------------------------"
echo " PharmacyPOS development environment"
echo "------------------------------------------"
echo " Website: http://127.0.0.1:3000"
echo " Django:  http://127.0.0.1:8000"
echo
echo " Press Ctrl+C to stop both servers."
echo "------------------------------------------"
echo

wait -n "$API_PID" "$WEB_PID" || true
echo "A server stopped. Shutting down the remaining server."
