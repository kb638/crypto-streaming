#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "[setup] 1) Installing workspace dependencies..."
pnpm install --recursive

echo "[setup] 2) Generating protobuf code (packages/api)..."
pnpm -C packages/api exec buf generate .

echo "[setup] 3) Installing Playwright Chromium (backend)..."
pnpm -F @pluto/backend playwright install chromium

# Frontend base URL (can override via env)
export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-http://localhost:8080}"

# We want headed mode by default per the spec.
# If there's no display (CI/VM), use xvfb-run if available so the browser still runs "headed".
BACK_CMD=(pnpm -F @pluto/backend dev)
if [[ -z "${DISPLAY:-}" ]]; then
  if command -v xvfb-run >/dev/null 2>&1; then
    echo "[setup] 4) No DISPLAY found — starting backend with xvfb-run (headed under virtual display)"
    BACK_CMD=(xvfb-run -a pnpm -F @pluto/backend dev)
  else
    echo "[warn] No DISPLAY and xvfb-run not found. Headed Playwright may not be visible on this host."
    echo "[warn] Install xvfb (Debian: sudo apt-get update && sudo apt-get install -y xvfb) for a visible headed browser."
  fi
fi

echo "[run] 5) Starting backend + frontend..."
"${BACK_CMD[@]}" & BACK_PID=$!
pnpm -F @pluto/frontend dev & FRONT_PID=$!

cleanup() {
  echo "[run] Shutting down…"
  kill "$BACK_PID" "$FRONT_PID" 2>/dev/null || true
  wait "$BACK_PID" "$FRONT_PID" 2>/dev/null || true
}
trap cleanup INT TERM

wait -n "$BACK_PID" "$FRONT_PID" || true
cleanup
