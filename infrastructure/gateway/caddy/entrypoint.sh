#!/bin/sh
# Refuses to start without the gateway's settings, naming what is missing, then runs Caddy in the foreground.
set -eu
missing=""
[ -n "${APP_DOMAIN:-}" ] || missing="$missing APP_DOMAIN"
[ -n "${API_DOMAIN:-}" ] || missing="$missing API_DOMAIN"
[ -n "${GATEWAY_TLS:-}" ] || missing="$missing GATEWAY_TLS"
if [ -n "$missing" ]; then
  echo "gateway: missing settings:$missing (see infrastructure/deployment/production/env/gateway.env.example)" >&2
  exit 1
fi
if [ "$APP_DOMAIN" = "$API_DOMAIN" ]; then
  echo "gateway: APP_DOMAIN and API_DOMAIN must be different host names" >&2
  exit 1
fi
case "$GATEWAY_TLS" in
  internal | *@*.*) ;;
  *)
    echo "gateway: GATEWAY_TLS must be an email address (Let's Encrypt) or 'internal'" >&2
    exit 1
    ;;
esac
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
