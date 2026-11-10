#!/usr/bin/env bash
# Document-processing service (python-services/document-processing) tasks, run from any directory.
#
#   python.sh setup   create .venv and install the service with its [dev] extra (pnpm python:setup)
#   python.sh test    run pytest                                              (pnpm python:test)
#   python.sh lint    ruff check + ruff format --check                        (pnpm python:lint)
#   python.sh dev     uvicorn with --reload on 127.0.0.1                      (pnpm dev:python)
#
# Extra arguments are passed to the underlying tool, e.g. `pnpm python:test -k parsers`.
# `setup` uses $PYTHON when set (default python3); the service requires Python 3.14 or newer
# (pyproject.toml requires-python). The dev port comes from DOCUMENT_PROCESSING_URL, read from the
# environment or else the repository-root .env, and defaults to 8000.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_DIR="$REPO_ROOT/python-services/document-processing"
VENV_DIR="$SERVICE_DIR/.venv"
VENV_PYTHON="$VENV_DIR/bin/python"

die() {
  echo "python.sh: $*" >&2
  exit 1
}

require_venv() {
  [[ -x "$VENV_PYTHON" ]] ||
    die "no virtual environment at ${VENV_DIR#"$REPO_ROOT"/}; run \`pnpm python:setup\` first"
}

# Value of KEY in the repository-root .env (last assignment wins), without sourcing the file.
env_file_value() {
  local key="$1" file="$REPO_ROOT/.env" line value=""
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=(.*)$ ]]; then
      value="${BASH_REMATCH[2]}"
    fi
  done <"$file"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  value="${value#[\"\']}"
  value="${value%[\"\']}"
  printf '%s' "$value"
}

dev_port() {
  local url="${DOCUMENT_PROCESSING_URL:-}"
  [[ -n "$url" ]] || url="$(env_file_value DOCUMENT_PROCESSING_URL)"
  if [[ -z "$url" ]]; then
    echo 8000
    return
  fi
  "$VENV_PYTHON" -I -c '
import sys
from urllib.parse import urlsplit

parts = urlsplit(sys.argv[1])
if parts.scheme not in ("http", "https") or not parts.hostname:
    sys.exit(f"DOCUMENT_PROCESSING_URL is not an http(s) URL: {sys.argv[1]!r}")
print(parts.port or (443 if parts.scheme == "https" else 80))
' "$url"
}

command="${1:-}"
[[ $# -gt 0 ]] && shift

case "$command" in
  setup)
    python_bin="${PYTHON:-python3}"
    command -v "$python_bin" >/dev/null 2>&1 || die "$python_bin not found; install Python 3.14+ or set PYTHON"
    "$python_bin" -I -c 'import sys; sys.exit(0 if sys.version_info >= (3, 14) else 1)' ||
      die "$python_bin is $("$python_bin" -I -c 'import platform; print(platform.python_version())'); Python 3.14+ is required (set PYTHON=python3.14)"
    cd "$SERVICE_DIR"
    if [[ ! -x "$VENV_PYTHON" ]]; then
      "$python_bin" -m venv "$VENV_DIR"
    fi
    "$VENV_PYTHON" -m pip install --upgrade pip
    "$VENV_PYTHON" -m pip install -e '.[dev]' "$@"
    echo "python.sh: ready (${VENV_DIR#"$REPO_ROOT"/})"
    ;;
  test)
    require_venv
    cd "$SERVICE_DIR"
    exec "$VENV_PYTHON" -m pytest "$@"
    ;;
  lint)
    require_venv
    cd "$SERVICE_DIR"
    "$VENV_PYTHON" -m ruff check "$@" .
    "$VENV_PYTHON" -m ruff format --check .
    ;;
  dev)
    require_venv
    cd "$SERVICE_DIR"
    port="$(dev_port)"
    exec "$VENV_PYTHON" -m uvicorn app.main:app --reload --reload-dir app --host 127.0.0.1 --port "$port" "$@"
    ;;
  *)
    die "usage: python.sh {setup|test|lint|dev} [args...]"
    ;;
esac
