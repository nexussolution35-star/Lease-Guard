#!/usr/bin/env bash
# Proves the production stack (infrastructure/deployment/production/compose.yml) on this machine, then removes it:
#   1. builds every image (gateway, frontend, backend, reports, document-processing) under throwaway local tags;
#   2. starts the whole stack with NODE_ENV=production and its real startup validation, on the test domains
#      app.leaseguard.test and api.leaseguard.test, with Caddy's internal CA (`GATEWAY_TLS=internal`) on
#      127.0.0.1:${PROOF_HTTP_PORT}/${PROOF_HTTPS_PORT};
#   3. checks through the gateway over https: health and readiness, the web app, the redirect to https, CORS,
#      the WhatsApp webhook handshake and a signed POST, path routing to core and to reports, the verify token kept
#      out of the access log, a second API replica, and that production refuses development values;
#   4. removes every container, network, volume, image and file it created (also on failure or Ctrl-C).
#
# Supabase is the LOCAL CLI stack (`pnpm db:start`), reached through a TLS front (compose.proof.yml). The API and the
# reports service use its public anon key; the workers get a deliberately invalid service-role key, so the proof
# never writes to the local database (their jobs fail with 401, which is expected here).
#
#   bash infrastructure/scripts/production-proof.sh      (pnpm docker:production-proof)
#   PROOF_KEEP_IMAGES=1 ...                               keep the built images for a second run
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROD_DIR="$REPO_ROOT/infrastructure/deployment/production"
PROJECT="leaseguard-prodproof-$$"
REGISTRY="leaseguard-proof-$$"
TAG="proof"
HTTP_PORT="${PROOF_HTTP_PORT:-18080}"
HTTPS_PORT="${PROOF_HTTPS_PORT:-18443}"
APP="app.leaseguard.test"
API="api.leaseguard.test"
WORK="$REPO_ROOT/.scratch/production-proof-$$"
IMAGES=(gateway frontend backend reports document-processing)

for tool in docker curl node openssl; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "production-proof: $tool is not installed or not on PATH" >&2
    exit 1
  }
done

failures=0
pass() { echo "ok    $1"; }
fail() {
  echo "FAIL  $1"
  failures=$((failures + 1))
}
step() { echo; echo "== $1"; }

COMPOSE_ARGS=(-p "$PROJECT" --project-directory "$PROD_DIR" -f "$PROD_DIR/compose.yml" -f "$PROD_DIR/compose.proof.yml" --env-file "$WORK/.env")
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "${COMPOSE_ARGS[@]}" "$@"
  else
    # The official CLI image, with the repository at the same path (as infrastructure/scripts/compose.sh does).
    docker run --rm -i --volume /var/run/docker.sock:/var/run/docker.sock --volume "$REPO_ROOT:$REPO_ROOT" \
      --workdir "$REPO_ROOT" docker:29-cli docker compose "${COMPOSE_ARGS[@]}" "$@"
  fi
}

cleanup() {
  local status=$?
  step "Cleanup"
  if [[ -f "$WORK/.env" ]]; then compose down --volumes --remove-orphans --timeout 10 >/dev/null 2>&1 || true; fi
  if [[ "${PROOF_KEEP_IMAGES:-0}" != "1" ]]; then
    for name in "${IMAGES[@]}"; do docker image rm "$REGISTRY/leaseguard-$name:$TAG" >/dev/null 2>&1 || true; done
  fi
  rm -rf "$WORK"
  local left
  left="$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" -q | wc -l | tr -d ' ')"
  echo "containers left from $PROJECT: $left"
  exit "$status"
}
trap cleanup EXIT

# ------------------------------------------------------------------------------------------------ local Supabase
step "Local Supabase"
[[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:54321/auth/v1/health || true)" != 000 ]] || {
  echo "production-proof: the local Supabase stack is not running on 127.0.0.1:54321 (pnpm db:start)" >&2
  exit 1
}
ANON_KEY="$(cd "$REPO_ROOT" && npx --no-install supabase status -o env 2>/dev/null | sed -n 's/^ANON_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
[[ -n "$ANON_KEY" ]] || {
  echo "production-proof: could not read the local anon key from \`supabase status -o env\`" >&2
  exit 1
}
pass "local Supabase is up; anon key read (not printed)"

# ------------------------------------------------------------------------------------------------ settings
mkdir -p "$WORK/env"
chmod 700 "$WORK"
random() { openssl rand -hex 32; }
VERIFY_TOKEN="$(random)"
APP_SECRET="$(random)"
cat >"$WORK/.env" <<EOF
APP_DOMAIN=$APP
API_DOMAIN=$API
IMAGE_REGISTRY=$REGISTRY
IMAGE_TAG=$TAG
SUPABASE_URL=https://supabase.leaseguard.test
SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=proof-invalid-service-role-key
REDIS_PASSWORD=$(random)
DOCUMENT_PROCESSING_TOKEN=$(random)
WHATSAPP_APP_ID=1234567890
WHATSAPP_APP_SECRET=$APP_SECRET
GATEWAY_HTTP_PORT=127.0.0.1:$HTTP_PORT
GATEWAY_HTTPS_PORT=127.0.0.1:$HTTPS_PORT
LEASEGUARD_ENV_DIR=$WORK/env
EOF
for file in "$PROD_DIR"/env/*.env.example; do cp "$file" "$WORK/env/$(basename "${file%.example}")"; done
echo "GATEWAY_TLS=internal" >"$WORK/env/gateway.env"
printf 'WHATSAPP_WEBHOOK_VERIFY_TOKEN=%s\n' "$VERIFY_TOKEN" >"$WORK/env/api.env"
chmod 600 "$WORK/.env" "$WORK"/env/*.env
compose config --quiet
pass "compose.yml with the proof settings is valid"

# ------------------------------------------------------------------------------------------------ images
step "Images"
build() {
  local name="$1"
  shift
  local started=$SECONDS
  docker build --quiet -t "$REGISTRY/leaseguard-$name:$TAG" "$@" >/dev/null
  pass "built leaseguard-$name ($((SECONDS - started)) s, $(docker image inspect --format '{{.Size}}' "$REGISTRY/leaseguard-$name:$TAG" | awk '{ printf "%d MB", $1 / 1000000 }'))"
}
build gateway -f "$REPO_ROOT/infrastructure/gateway/caddy/Dockerfile" "$REPO_ROOT/infrastructure/gateway"
build backend -f "$REPO_ROOT/backend/Dockerfile" "$REPO_ROOT"
build reports -f "$REPO_ROOT/services/reports/Dockerfile" "$REPO_ROOT"
build frontend -f "$REPO_ROOT/frontend/Dockerfile" \
  --build-arg "VITE_API_URL=https://$API" \
  --build-arg "VITE_SUPABASE_URL=https://supabase.leaseguard.test" \
  --build-arg "VITE_SUPABASE_ANON_KEY=$ANON_KEY" "$REPO_ROOT"
build document-processing "$REPO_ROOT/python-services/document-processing"

# ------------------------------------------------------------------------------------------------ startup validation
step "Production refuses development values"
refused="$(docker run --rm -e NODE_ENV=production -e LOG_LEVEL=info -e API_PORT=3000 \
  -e API_CORS_ORIGINS=http://localhost:5173 -e SUPABASE_URL=http://127.0.0.1:54321 -e SUPABASE_ANON_KEY= \
  -e REDIS_URL=redis://redis:6379 -e QUEUE_PREFIX=leaseguard -e SUPABASE_STATEMENTS_BUCKET=statements \
  -e SUPABASE_LEASE_DOCUMENTS_BUCKET=lease-documents -e DOCUMENT_PROCESSING_MAX_FILE_MB=20 \
  "$REGISTRY/leaseguard-backend:$TAG" 2>&1 || true)"
for expected in 'SUPABASE_URL: must be an https URL in production' 'API_CORS_ORIGINS: every origin must be an https URL in production' \
  'SUPABASE_ANON_KEY: must be set in production' 'REDIS_URL: must include the Redis password in production'; do
  if grep -qF "$expected" <<<"$refused"; then pass "API refuses: $expected"; else fail "API did not refuse: $expected"; fi
done

# ------------------------------------------------------------------------------------------------ start
step "Start the stack"
compose up -d --quiet-pull >/dev/null 2>&1 || compose up -d
services=(gateway frontend api worker reports reports-worker document-processing redis)
healthy=0
for _ in $(seq 1 90); do
  healthy=1
  for service in "${services[@]}"; do
    id="$(compose ps -q "$service" 2>/dev/null | head -n 1)"
    state="$([[ -n "$id" ]] && docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)"
    [[ "$state" == "healthy" ]] || healthy=0
  done
  ((healthy)) && break
  sleep 2
done
for service in "${services[@]}"; do
  id="$(compose ps -q "$service" | head -n 1)"
  state="$(docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null || echo none)"
  if [[ "$state" == "healthy" ]]; then pass "$service is healthy"; else
    fail "$service is $state"
    docker logs --tail 30 "$id" 2>&1 | sed 's/^/      /'
  fi
done

# The gateway's local CA, so curl verifies the certificates instead of skipping the check.
GATEWAY_ID="$(compose ps -q gateway | head -n 1)"
for _ in $(seq 1 20); do
  docker cp "$GATEWAY_ID:/data/caddy/pki/authorities/local/root.crt" "$WORK/gateway-ca.crt" >/dev/null 2>&1 && break
  sleep 1
done
https() {
  local host="$1" path="$2"
  shift 2
  curl -sS --max-time 15 --cacert "$WORK/gateway-ca.crt" --resolve "$host:$HTTPS_PORT:127.0.0.1" "$@" "https://$host:$HTTPS_PORT$path"
}
# expect <description> <expected status> <host> <path> [curl options]
expect() {
  local description="$1" status="$2" host="$3" path="$4" got
  shift 4
  got="$(https "$host" "$path" -o "$WORK/body" -w '%{http_code}' "$@" || echo 000)"
  if [[ "$got" == "$status" ]]; then pass "$description: $got"; else fail "$description: $got, expected $status ($(head -c 200 "$WORK/body" 2>/dev/null))"; fi
}

# ------------------------------------------------------------------------------------------------ through the gateway
step "Health through the gateway (https, certificate verified)"
expect "https://$API/healthz (gateway)" 200 "$API" /healthz
expect "https://$API/health (core liveness)" 200 "$API" /health
expect "https://$API/health/ready (core readiness: Redis and Supabase)" 200 "$API" /health/ready
grep -q '"status":"ready"' "$WORK/body" && pass "core readiness body says ready" || fail "core readiness body: $(cat "$WORK/body")"
expect "https://$APP/ (web app)" 200 "$APP" /
grep -qi '<!doctype html>' "$WORK/body" && pass "web app serves its HTML shell" || fail "web app did not serve HTML"
expect "https://$APP/leases/123 (client-side route)" 200 "$APP" /leases/123
expect "https://$APP/health/ready (API paths answer on the app domain too)" 200 "$APP" /health/ready
redirect="$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --resolve "$API:$HTTP_PORT:127.0.0.1" "http://$API:$HTTP_PORT/health" || true)"
[[ "$redirect" == 30[18]\ https://$API/health ]] && pass "plain http redirects to https ($redirect)" || fail "http redirect: $redirect"
hsts="$(https "$API" /health -D - -o /dev/null | tr -d '\r' | grep -i '^strict-transport-security:' || true)"
[[ -n "$hsts" ]] && pass "HSTS header set ($hsts)" || fail "no HSTS header"

step "CORS follows APP_DOMAIN"
allowed="$(https "$API" /api/v1/me -X OPTIONS -H "Origin: https://$APP" -H 'Access-Control-Request-Method: GET' -D - -o /dev/null | tr -d '\r' | grep -i '^access-control-allow-origin:' || true)"
[[ "$allowed" == *"https://$APP"* ]] && pass "preflight from https://$APP allowed" || fail "preflight from the app: '$allowed'"
other="$(https "$API" /api/v1/me -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: GET' -D - -o /dev/null | tr -d '\r' | grep -i '^access-control-allow-origin:' || true)"
[[ -z "$other" ]] && pass "preflight from another origin gets no CORS grant" || fail "another origin was granted: $other"

step "WhatsApp webhook through the gateway"
CHALLENGE="proof-$RANDOM$RANDOM"
expect "handshake with the verify token" 200 "$API" "/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$VERIFY_TOKEN&hub.challenge=$CHALLENGE"
[[ "$(cat "$WORK/body")" == "$CHALLENGE" ]] && pass "handshake echoes the challenge" || fail "handshake body: $(cat "$WORK/body")"
expect "handshake with a wrong token" 403 "$API" "/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=$CHALLENGE"
printf '{"object":"whatsapp_business_account","entry":[{"id":"0","changes":[]}]}' >"$WORK/webhook.json"
SIGNATURE="sha256=$(openssl dgst -sha256 -hmac "$APP_SECRET" -hex <"$WORK/webhook.json" | sed 's/^.*= *//')"
expect "signed POST (signature over the exact bytes)" 200 "$API" /api/v1/webhooks/whatsapp \
  -X POST -H 'Content-Type: application/json' -H "X-Hub-Signature-256: $SIGNATURE" --data-binary "@$WORK/webhook.json"
grep -q '"received":true' "$WORK/body" && pass "webhook accepted: $(cat "$WORK/body")" || fail "webhook body: $(cat "$WORK/body")"
expect "POST with a wrong signature" 401 "$API" /api/v1/webhooks/whatsapp \
  -X POST -H 'Content-Type: application/json' -H "X-Hub-Signature-256: sha256=$(printf '0%.0s' $(seq 1 64))" --data-binary "@$WORK/webhook.json"
head -c 3500000 /dev/zero | tr '\0' ' ' >"$WORK/large.json"
expect "a 3.5 MB body passes the gateway and the API refuses it itself" 413 "$API" /api/v1/webhooks/whatsapp \
  -X POST -H 'Content-Type: application/json' -H "X-Hub-Signature-256: $SIGNATURE" --data-binary "@$WORK/large.json"
sleep 1
docker logs "$GATEWAY_ID" >"$WORK/gateway.log" 2>&1
if grep -F -- "hub.verify_token=REDACTED" "$WORK/gateway.log" >/dev/null; then pass "the gateway access log records the handshake with the token redacted"; else fail "no redacted handshake entry in the gateway access log"; fi
if grep -F -- "$VERIFY_TOKEN" "$WORK/gateway.log" >/dev/null; then fail "the verify token appears in the gateway log"; else pass "the verify token is not in the gateway access log"; fi

step "Path routing from routes.json"
routed() {
  local path="$1" service="$2" id="proof-route-$RANDOM$RANDOM"
  https "$API" "$path" -o /dev/null -H "X-Request-Id: $id" >/dev/null || true
  sleep 1
  local in_core=0 in_reports=0
  for cid in $(compose ps -q api); do docker logs "$cid" 2>&1 | grep -F -- "$id" >/dev/null && in_core=1; done
  for cid in $(compose ps -q reports); do docker logs "$cid" 2>&1 | grep -F -- "$id" >/dev/null && in_reports=1; done
  if [[ "$service" == core && $in_core == 1 && $in_reports == 0 ]] || [[ "$service" == reports && $in_reports == 1 && $in_core == 0 ]]; then
    pass "$path -> $service"
  else
    fail "$path: core log $in_core, reports log $in_reports, expected $service"
  fi
}
routed /api/v1/reports reports
routed /api/v1/reports/portfolio_overview reports
routed '/api/v1/reports?propertyId=1' reports
routed /api/v1/reportsx core
routed /api/v1/me core
routed /api/v1/dashboard/summary core

step "Scaling: a second API replica behind the gateway"
compose up -d --no-recreate --scale api=2 api >"$WORK/scale.log" 2>&1 || {
  fail "scaling the API to 2 replicas: $(tail -n 5 "$WORK/scale.log")"
}
for _ in $(seq 1 45); do
  ready=0
  for cid in $(compose ps -q api); do [[ "$(docker inspect --format '{{.State.Health.Status}}' "$cid")" == healthy ]] && ready=$((ready + 1)); done
  ((ready == 2)) && break
  sleep 2
done
sleep 12 # the gateway's DNS refresh (5 s) and first readiness check (10 s)
codes=""
for i in $(seq 1 30); do codes="$codes $(https "$API" /api/v1/me -o /dev/null -w '%{http_code}' -H "X-Request-Id: proof-scale-$i" || echo 000)"; done
sleep 1
replicas="$(compose ps -q api | wc -l | tr -d ' ')"
served=0
for cid in $(compose ps -q api); do docker logs "$cid" 2>&1 | grep -F -- 'proof-scale-' >/dev/null && served=$((served + 1)); done
if ((replicas == 2 && served == 2)); then pass "30 requests spread over both API replicas"; else
  fail "requests reached $served of $replicas API replicas (status codes:$(tr ' ' '\n' <<<"$codes" | sort | uniq -c | tr -s ' \n' ' '))"
fi

echo
if ((failures > 0)); then
  echo "production-proof: $failures check(s) failed" >&2
  exit 1
fi
echo "production-proof: every check passed"
