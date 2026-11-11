#!/usr/bin/env bash
# Runs Docker Compose against the repository-root docker-compose.yml, from any directory.
#
#   compose.sh config --quiet      (pnpm docker:config)
#   compose.sh up -d --build       (pnpm docker:up)
#   compose.sh down                (pnpm docker:down)
#
# Uses the first of:
#   1. the `docker compose` CLI plugin,
#   2. the standalone `docker-compose` binary,
#   3. Compose inside the official docker CLI image (COMPOSE_FALLBACK_IMAGE, default docker:29-cli),
#      talking to the host daemon through its socket.
#
# Fallback (3) mounts the repository at the same absolute path inside the container, so relative
# build contexts, `env_file` and the env files used for `${VAR}` interpolation resolve exactly as
# they do on the host. Its limitations:
#   - Only files under the repository are visible to Compose; a `-f` file elsewhere fails.
#   - Only some host shell variables are forwarded: COMPOSE_*, DOCKER_* and those referenced as
#     ${NAME} in docker-compose.yml (so `API_HOST_PORT=3001 pnpm docker:up` works as with a local
#     Compose). Anything else Compose should see must live in backend/.env or frontend/.env.
#   - The daemon must be able to bind-mount the repository path: true for Docker Desktop and for
#     Colima/Lima, which share the home directory at the same path by default.
#   - The daemon socket must be /var/run/docker.sock from the daemon's point of view (true for
#     Docker Desktop, Colima and a local Linux daemon); remote DOCKER_HOST daemons are not supported.
#   - The image is pulled on first use, so the first run needs network access.
# Set COMPOSE_FORCE_FALLBACK=1 to use the fallback even when a local Compose exists.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE_PATH="$REPO_ROOT/docker-compose.yml"
FALLBACK_IMAGE="${COMPOSE_FALLBACK_IMAGE:-docker:29-cli}"

command -v docker >/dev/null 2>&1 || {
  echo "compose.sh: docker is not installed or not on PATH" >&2
  exit 1
}

# Every invocation targets the root compose file with the repository root as the project directory,
# so `pnpm docker:*` behaves the same from any working directory.
cd "$REPO_ROOT"

# `${VAR}` interpolation reads the server settings (backend/.env) and the web app's public values
# (frontend/.env, for the frontend image's build arguments). Missing files are skipped.
env_files=()
for file in backend/.env frontend/.env; do
  if [[ -f "$REPO_ROOT/$file" ]]; then
    env_files+=(--env-file "$REPO_ROOT/$file")
  fi
done

if [[ "${COMPOSE_FORCE_FALLBACK:-0}" != "1" ]]; then
  if docker compose version >/dev/null 2>&1; then
    exec docker compose --project-directory "$REPO_ROOT" -f "$COMPOSE_FILE_PATH" ${env_files[@]+"${env_files[@]}"} "$@"
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    exec docker-compose --project-directory "$REPO_ROOT" -f "$COMPOSE_FILE_PATH" ${env_files[@]+"${env_files[@]}"} "$@"
  fi
  echo "compose.sh: no local Docker Compose found; using $FALLBACK_IMAGE" >&2
fi

# Interactive terminal: allocate a TTY so `up` (attached), `logs -f` and `exec` behave normally.
tty_flags="-i"
if [[ -t 0 && -t 1 ]]; then
  tty_flags="-it"
fi

# Forward Compose/Docker settings (project name, profiles, BuildKit, ...) but not DOCKER_HOST:
# inside the container the daemon is always reached through the mounted socket. Variables the compose
# file interpolates are forwarded too, so the host shell overrides the env files exactly as with a local Compose.
env_flags=""
while IFS='=' read -r name _; do
  case "$name" in
    COMPOSE_FORCE_FALLBACK | COMPOSE_FALLBACK_IMAGE | DOCKER_HOST | DOCKER_CONTEXT | DOCKER_CONFIG | DOCKER_CERT_PATH) ;;
    COMPOSE_* | DOCKER_*) env_flags="$env_flags --env $name" ;;
  esac
done < <(env)
while IFS= read -r name; do
  if [[ -n "${!name+set}" ]]; then
    env_flags="$env_flags --env $name"
  fi
done < <(grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*' "$COMPOSE_FILE_PATH" | cut -c3- | sort -u)

# shellcheck disable=SC2086 # tty_flags and env_flags are intentionally word-split.
exec docker run --rm --quiet $tty_flags $env_flags \
  --volume /var/run/docker.sock:/var/run/docker.sock \
  --volume "$REPO_ROOT:$REPO_ROOT" \
  --workdir "$REPO_ROOT" \
  "$FALLBACK_IMAGE" \
  docker compose --project-directory "$REPO_ROOT" -f "$COMPOSE_FILE_PATH" ${env_files[@]+"${env_files[@]}"} "$@"
