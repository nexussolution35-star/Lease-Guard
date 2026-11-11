# check=skip=SecretsUsedInArgOrEnv
# (BuildKit check directive: the VITE_* build arguments, including the Supabase anon key, are public
# browser configuration, not secrets. The legacy builder ignores this line.)
# LeaseGuard frontend image: the Vite single-page application served by nginx.
#
# Build from the repository root (the frontend compiles the @leaseguard/domain and
# @leaseguard/api-client workspace packages from source):
#   docker build -f frontend/Dockerfile -t leaseguard-frontend \
#     --build-arg VITE_API_URL=https://api.example.test \
#     --build-arg VITE_SUPABASE_URL=https://project.supabase.co \
#     --build-arg VITE_SUPABASE_ANON_KEY=<public anon key> .
#
# VITE_* values are compiled into the JavaScript bundle and readable by anyone who loads the app:
# they are public configuration, never secrets. The Supabase anon key is public by design (Row Level
# Security applies). Never pass a service-role key or any other secret here.
# All three are required: without them the app only shows its configuration error screen.
# Works with BuildKit and with the legacy builder (no BuildKit-only syntax).

ARG NODE_IMAGE=node:24.22.2-trixie-slim
ARG NGINX_IMAGE=nginx:1.30.6-alpine

# ----------------------------------------------------------------------------- build
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
ENV PATH="${PNPM_HOME}:${PATH}"
# The version pinned by the root package.json `packageManager` field.
RUN corepack enable pnpm && corepack prepare pnpm@12.8.1 --activate && pnpm --version
WORKDIR /app
# Every workspace manifest, so pnpm validates the lockfile against the whole workspace; only the
# frontend and its workspace dependencies are installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/
COPY packages/domain/package.json packages/domain/
COPY packages/api-client/package.json packages/api-client/
COPY backend/package.json backend/
COPY tests/package.json tests/
RUN pnpm install --frozen-lockfile --filter "@leaseguard/frontend..."

COPY packages/domain/tsconfig.json packages/domain/
COPY packages/domain/src packages/domain/src
COPY packages/api-client/tsconfig.json packages/api-client/
COPY packages/api-client/src packages/api-client/src
COPY frontend frontend

ARG VITE_API_URL=
ARG VITE_SUPABASE_URL=
ARG VITE_SUPABASE_ANON_KEY=
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
# Generates the route tree, type-checks and bundles into frontend/dist.
RUN pnpm --filter "@leaseguard/frontend" build

# ----------------------------------------------------------------------------- runtime
FROM ${NGINX_IMAGE} AS runtime
COPY infrastructure/docker/nginx/frontend.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
# Run nginx as its unprivileged user: it only needs to write its pid file and temp/cache files. The
# `user` directive only applies to a root master process, so it is removed.
RUN sed -i '/^user /d' /etc/nginx/nginx.conf \
    && touch /run/nginx.pid \
    && chown nginx:nginx /run/nginx.pid \
    && chown -R nginx:nginx /var/cache/nginx
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
