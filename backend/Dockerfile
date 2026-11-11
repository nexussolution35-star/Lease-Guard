# LeaseGuard backend image: one image for both processes.
#   API:    node dist/main.js     (default command; serves HTTP on API_PORT, health at /health)
#   Worker: node dist/worker.js   (override the command; no HTTP server, so disable the health check)
#
# Build from the repository root (the backend depends on the @leaseguard/domain workspace package):
#   docker build -f backend/Dockerfile -t leaseguard-backend .
#
# Configuration is read from the environment at run time (see backend/.env.example and
# infrastructure/deployment/README.md); no .env file or secret is ever copied into the image.
# Works with BuildKit and with the legacy builder (no BuildKit-only syntax).

ARG NODE_IMAGE=node:24.22.2-trixie-slim

# ----------------------------------------------------------------------------- pnpm toolchain
FROM ${NODE_IMAGE} AS pnpm
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
ENV PATH="${PNPM_HOME}:${PATH}"
# The version pinned by the root package.json `packageManager` field.
RUN corepack enable pnpm && corepack prepare pnpm@12.8.1 --activate && pnpm --version
WORKDIR /app
# Every workspace manifest, so pnpm validates the lockfile against the whole workspace exactly as it
# does on a developer machine; only the backend and its workspace dependencies are installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY packages/domain/package.json packages/domain/
COPY packages/api-client/package.json packages/api-client/
COPY frontend/package.json frontend/
COPY tests/package.json tests/

# ----------------------------------------------------------------------------- build
FROM pnpm AS build
RUN pnpm install --frozen-lockfile --filter "@leaseguard/backend..."
COPY packages/domain/tsconfig.json packages/domain/tsconfig.build.json packages/domain/
COPY packages/domain/src packages/domain/src
COPY backend/tsconfig.json backend/tsconfig.build.json backend/
COPY backend/scripts backend/scripts
COPY backend/src backend/src
# The backend `build` script builds @leaseguard/domain first, then compiles the backend into dist/.
RUN pnpm --filter "@leaseguard/backend" build

# ----------------------------------------------------------------------------- production dependencies
FROM pnpm AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@leaseguard/backend..."

# ----------------------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    API_PORT=3000
WORKDIR /app
# The same workspace layout as the repository, so pnpm's relative symlinks (including the
# backend -> packages/domain workspace link) resolve unchanged.
COPY --from=prod-deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/domain/package.json packages/domain/
COPY --from=prod-deps /app/packages/domain/node_modules packages/domain/node_modules
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=prod-deps /app/backend/package.json backend/
COPY --from=prod-deps /app/backend/node_modules backend/node_modules
COPY --from=build /app/backend/dist backend/dist

WORKDIR /app/backend
# The `node` user (uid 1000) ships with the base image; the application files stay root-owned and
# read-only for it.
USER node
EXPOSE 3000
# Liveness of the API process (GET /health). Readiness, which also checks Redis and Supabase, is
# GET /health/ready. The worker serves no HTTP: run it with the health check disabled.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.API_PORT || 3000) + '/health', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
