# LeaseGuard production gateway image: Caddy with automatic HTTPS (Let's Encrypt), routing by path from the shared
# table infrastructure/gateway/routes.json (ADR 0003). Build from infrastructure/gateway:
#   docker build -f infrastructure/gateway/caddy/Dockerfile -t leaseguard-gateway-caddy infrastructure/gateway
# Run with APP_DOMAIN, API_DOMAIN and GATEWAY_TLS set (see Caddyfile.template), ports 80 and 443 published, and a
# volume on /data (certificates and the ACME account; losing it means re-issuing every certificate).
# The nginx gateway beside it (../Dockerfile) stays the gateway of the local docker-compose.yml.
# Works with BuildKit and with the legacy builder (no BuildKit-only syntax).

ARG NODE_IMAGE=node:24.22.2-trixie-slim
ARG CADDY_IMAGE=caddy:2.10.2-alpine

# ----------------------------------------------------------------------------- render the Caddyfile
FROM ${NODE_IMAGE} AS render
WORKDIR /gateway
COPY routes.json ./
COPY caddy/Caddyfile.template caddy/render-caddyfile.mjs caddy/
RUN node caddy/render-caddyfile.mjs > Caddyfile

# ----------------------------------------------------------------------------- runtime
FROM ${CADDY_IMAGE}
COPY --from=render /gateway/Caddyfile /etc/caddy/Caddyfile
COPY caddy/entrypoint.sh /usr/local/bin/leaseguard-gateway
# Parse the rendered file now, so a broken template fails the build rather than the deploy.
RUN chmod 0755 /usr/local/bin/leaseguard-gateway \
    && APP_DOMAIN=app.example.test API_DOMAIN=api.example.test GATEWAY_TLS=internal \
       caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
EXPOSE 80 443 443/udp
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8081/healthz"]
CMD ["/usr/local/bin/leaseguard-gateway"]
