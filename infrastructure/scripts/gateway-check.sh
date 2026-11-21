#!/usr/bin/env bash
# Checks the gateway (infrastructure/gateway, ADR 0003):
#   1. every prefix in routes.json (the table the Vite dev proxy uses) has its locations in gateway.conf.template;
#   2. the gateway image builds and nginx accepts the rendered configuration (`nginx -t`);
#   3. with two stand-in services (nginx answering their own name), each path reaches the right one:
#      /api/v1/reports and below it the reports service, everything else (including /api/v1/reportsx) the core.
# It needs Docker and curl, uses a throwaway network and three containers on a free 127.0.0.1 port, and removes
# them, the network and the image on exit.
#
#   bash infrastructure/scripts/gateway-check.sh      (pnpm docker:gateway-check)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATEWAY_DIR="$REPO_ROOT/infrastructure/gateway"
TEMPLATE="$GATEWAY_DIR/gateway.conf.template"

for tool in docker curl node; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "gateway-check: $tool is not installed or not on PATH" >&2
    exit 1
  }
done

failures=0
pass() { echo "ok    $1"; }
fail() {
  echo "FAIL  $1"
  failures=$((failures + 1))
}

# 1. The routing table and the nginx template agree.
while IFS= read -r prefix; do
  if grep -qF "location = $prefix {" "$TEMPLATE" && grep -qF "location ^~ $prefix/ {" "$TEMPLATE"; then
    pass "gateway.conf.template routes $prefix and $prefix/"
  else
    fail "gateway.conf.template has no 'location = $prefix' and 'location ^~ $prefix/' for routes.json"
  fi
done < <(node -e 'for (const r of require(process.argv[1]).routes) console.log(r.prefix)' "$GATEWAY_DIR/routes.json")

SUFFIX="$$"
NETWORK="leaseguard-gateway-check-$SUFFIX"
IMAGE="leaseguard-gateway-check:$SUFFIX"
STUB_IMAGE="$(sed -n 's/^ARG NGINX_IMAGE=//p' "$GATEWAY_DIR/Dockerfile")"
STUB_CONF="$(mktemp -d)"
cleanup() {
  docker rm -f "gw-$SUFFIX" "core-$SUFFIX" "reports-$SUFFIX" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  docker image rm "$IMAGE" >/dev/null 2>&1 || true
  rm -rf "$STUB_CONF"
}
trap cleanup EXIT

# 2. Build, and stand-in services answering "<name> <uri>".
docker build --quiet -t "$IMAGE" "$GATEWAY_DIR" >/dev/null
docker network create "$NETWORK" >/dev/null
for name in core reports; do
  printf 'server { listen 9000; location / { default_type text/plain; return 200 "%s $request_uri\\n"; } }\n' "$name" >"$STUB_CONF/$name.conf"
  docker create --name "$name-$SUFFIX" --network "$NETWORK" --network-alias "$name" "$STUB_IMAGE" >/dev/null
  docker cp "$STUB_CONF/$name.conf" "$name-$SUFFIX:/etc/nginx/conf.d/default.conf" >/dev/null
  docker start "$name-$SUFFIX" >/dev/null
done
docker run -d --name "gw-$SUFFIX" --network "$NETWORK" --publish 127.0.0.1::8080 \
  -e CORE_UPSTREAM=core:9000 -e REPORTS_UPSTREAM=reports:9000 "$IMAGE" >/dev/null

ADDRESS=""
for _ in $(seq 1 40); do
  if [[ "$(docker inspect --format '{{.State.Running}}' "gw-$SUFFIX")" != "true" ]]; then break; fi
  ADDRESS="$(docker port "gw-$SUFFIX" 8080/tcp 2>/dev/null | head -n 1)" || true
  if [[ -n "$ADDRESS" ]] && curl -fsS -o /dev/null "http://$ADDRESS/healthz" 2>/dev/null; then break; fi
  ADDRESS=""
  sleep 0.25
done
if [[ -z "$ADDRESS" ]]; then
  echo "gateway-check: the gateway did not start. Container output:" >&2
  docker logs "gw-$SUFFIX" >&2 || true
  exit 1
fi
docker exec "gw-$SUFFIX" nginx -t 2>&1 | tail -n 1
pass "nginx accepts the rendered gateway configuration"

# 3. routes <path> <service>
routes() {
  local body
  body="$(curl -fsS "http://$ADDRESS$1" || true)"
  if [[ "$body" == "$2 $1" ]]; then pass "$1 -> $2"; else fail "$1 answered '${body}', expected '$2 $1'"; fi
}
routes /api/v1/reports reports
routes /api/v1/reports/portfolio_overview reports
routes '/api/v1/reports?propertyId=1' reports
routes /api/v1/reportsx core
routes /api/v1/me core
routes /api/v1/dashboard/summary core
routes /health/ready core
routes /api/docs core

if ((failures > 0)); then
  echo "gateway-check: $failures check(s) failed" >&2
  exit 1
fi
echo "gateway-check: the gateway routes as routes.json says"
