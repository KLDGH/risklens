#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

# Make Homebrew tools available if present (macOS)
[ -f /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
[ -f /usr/local/bin/brew   ] && eval "$(/usr/local/bin/brew shellenv)"

# ── Python virtualenv ──────────────────────────────────────────────────────────
VENV="$ROOT/.venv"
if [ ! -f "$VENV/bin/python" ]; then
  echo "==> Creating Python virtualenv..."
  python3 -m venv "$VENV"
fi

echo "==> Installing Python dependencies..."
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -r "$ROOT/backend/requirements.lock.txt"

# ── Backend ────────────────────────────────────────────────────────────────────
echo "==> Running backend (fetching data + computing risk)..."
"$VENV/bin/python" "$ROOT/backend/run.py"

# ── Node / frontend ────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo ""
  echo "ERROR: node not found. Install Node 18+ then re-run this script."
  echo "  macOS: brew install node"
  echo "  Other: https://nodejs.org/en/download"
  exit 1
fi

echo "==> Installing frontend dependencies..."
cd "$ROOT/frontend"
npm install --silent

echo ""
echo "==> Starting dev server at http://localhost:5173"
npm run dev
