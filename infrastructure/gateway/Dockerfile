# LeaseGuard gateway image: nginx routing /api/v1/reports to the reports service and everything else to the core
# service (gateway.conf.template). Build from this directory:
#   docker build -t leaseguard-gateway infrastructure/gateway
# Run with CORE_UPSTREAM and REPORTS_UPSTREAM set (host:port of each service). Works with BuildKit and with the
# legacy builder (no BuildKit-only syntax).

# The nginx release the frontend image is served by (frontend/Dockerfile ARG NGINX_IMAGE).
ARG NGINX_IMAGE=nginx:1.30.6-alpine
FROM ${NGINX_IMAGE}

# The image renders /etc/nginx/templates/*.template into /etc/nginx/conf.d/ at start; drop the stock site.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY gateway.conf.template /etc/nginx/templates/default.conf.template

ENV CORE_UPSTREAM=api:3000 \
    REPORTS_UPSTREAM=reports:3100
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
