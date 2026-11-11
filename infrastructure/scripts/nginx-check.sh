#!/usr/bin/env bash
# Checks infrastructure/docker/nginx/frontend.conf in the nginx image pinned by frontend/Dockerfile:
#   1. nginx accepts the configuration (`nginx -t`);
#   2. served from a small stand-in web root, every kind of file carries the documented caching,
#      compression and security headers.
# It does not build the frontend. It needs Docker and curl, starts one throwaway container on a free
# 127.0.0.1 port and removes it on exit. Files are copied in with `docker cp`, so no bind mount is
# needed. The container is the stock image (root master process); the headers do not depend on that.
#
#   bash infrastructure/scripts/nginx-check.sh      (pnpm docker:nginx-check)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONF="$REPO_ROOT/infrastructure/docker/nginx/frontend.conf"

for tool in docker curl; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "nginx-check: $tool is not installed or not on PATH" >&2
    exit 1
  }
done

# The same pinned image the frontend is built on.
IMAGE="$(sed -n 's/^ARG NGINX_IMAGE=//p' "$REPO_ROOT/frontend/Dockerfile")"
if [[ -z "$IMAGE" ]]; then
  echo "nginx-check: ARG NGINX_IMAGE not found in frontend/Dockerfile" >&2
  exit 1
fi

CONTAINER="leaseguard-nginx-check-$$"
WEB_ROOT="$(mktemp -d)"
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WEB_ROOT"
}
trap cleanup EXIT

# Stand-in for frontend/dist: the app shell, the one unhashed public file and a hashed asset that is
# larger than gzip_min_length (1024 bytes).
mkdir -p "$WEB_ROOT/assets"
printf '<!doctype html><title>LeaseGuard</title>\n' >"$WEB_ROOT/index.html"
printf '<svg xmlns="http://www.w3.org/2000/svg"/>\n' >"$WEB_ROOT/favicon.svg"
head -c 4096 /dev/zero | LC_ALL=C tr '\0' 'a' >"$WEB_ROOT/assets/app-0a1b2c3d.js"
chmod -R a+rX "$WEB_ROOT"

docker create --name "$CONTAINER" --publish 127.0.0.1::8080 "$IMAGE" >/dev/null
docker cp "$CONF" "$CONTAINER:/etc/nginx/conf.d/default.conf" >/dev/null
docker cp "$WEB_ROOT/." "$CONTAINER:/usr/share/nginx/html/" >/dev/null
docker start "$CONTAINER" >/dev/null

# nginx exits at once on an invalid configuration; otherwise wait for /healthz.
ADDRESS=""
ready=0
for _ in $(seq 1 40); do
  if [[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER")" != "true" ]]; then
    break
  fi
  ADDRESS="$(docker port "$CONTAINER" 8080/tcp 2>/dev/null | head -n 1)" || true
  if [[ -n "$ADDRESS" ]] && curl -fsS -o /dev/null "http://$ADDRESS/healthz" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.25
done
if [[ "$ready" != "1" ]]; then
  echo "nginx-check: nginx did not start with frontend.conf in $IMAGE. Container output:" >&2
  docker logs "$CONTAINER" >&2 || true
  exit 1
fi

docker exec "$CONTAINER" nginx -t

failures=0
HEADERS=""
CURRENT=""

# request <path> [curl options]: GET the path and keep the status line and headers, lower-cased.
# A GET, not `curl -I`: nginx does not compress the response to a HEAD request.
request() {
  local path="$1"
  shift
  CURRENT="GET $path${*:+ ($*)}"
  HEADERS="$(curl -sS -o /dev/null -D - "$@" "http://$ADDRESS$path" | tr -d '\r' | tr '[:upper:]' '[:lower:]')"
}

pass() {
  echo "ok    $CURRENT: $1"
}

fail() {
  echo "FAIL  $CURRENT: $1"
  failures=$((failures + 1))
}

# status <code>
status() {
  local got
  got="$(head -n 1 <<<"$HEADERS" | cut -d ' ' -f 2)"
  if [[ "$got" == "$1" ]]; then pass "status $1"; else fail "status $got, expected $1"; fi
}

# header <whole header line, lower case>
header() {
  if grep -qxF -- "$1" <<<"$HEADERS"; then pass "$1"; else fail "missing '$1'"; fi
}

# has_header <header name, lower case>
has_header() {
  if grep -q -- "^$1: " <<<"$HEADERS"; then pass "has $1"; else fail "missing $1"; fi
}

# no_header <header name, lower case>
no_header() {
  if grep -q -- "^$1: " <<<"$HEADERS"; then fail "unexpected $1"; else pass "no $1"; fi
}

security_headers() {
  header 'x-content-type-options: nosniff'
  header 'x-frame-options: deny'
  header 'referrer-policy: strict-origin-when-cross-origin'
}

# The app shell is revalidated on every visit (a 304 when unchanged), never stored blindly.
request /
status 200
header 'cache-control: no-cache'
has_header etag
security_headers

# A client-side route falls back to the app shell with the same policy.
request /leases/123
status 200
header 'cache-control: no-cache'
security_headers

# Content-hashed build output never changes once published.
request /assets/app-0a1b2c3d.js
status 200
header 'cache-control: public, max-age=31536000, immutable'
security_headers

# Still compressed when the request arrives through a proxy or CDN (Via header).
request /assets/app-0a1b2c3d.js -H 'Accept-Encoding: gzip' -H 'Via: 1.1 edge'
status 200
header 'content-encoding: gzip'
header 'vary: accept-encoding'
header 'cache-control: public, max-age=31536000, immutable'

# The one unhashed file has an explicit, modest lifetime.
request /favicon.svg
status 200
header 'cache-control: public, max-age=86400'
security_headers

# A missing asset is a real 404 and is not marked cacheable.
request /assets/missing-00000000.js
status 404
no_header cache-control
header 'x-content-type-options: nosniff'

# A missing file with an extension is a 404, not the app shell.
request /missing.png
status 404

request /healthz
status 200

if ((failures > 0)); then
  echo "nginx-check: $failures check(s) failed" >&2
  exit 1
fi
echo "nginx-check: frontend.conf passed in $IMAGE"
