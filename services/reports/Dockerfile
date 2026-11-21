# LeaseGuard reports service image (ADR 0003): node dist/main.js serves HTTP on REPORTS_PORT, health at /health and
# readiness at /health/ready. The gateway (infrastructure/gateway) routes /api/v1/reports here.
#
# Build from the repository root (the service depends on the @leaseguard/domain and @leaseguard/service-kit
# workspace packages):
#   docker build -f services/reports/Dockerfile -t leaseguard-reports .
#
# Configuration is read from the environment at run time (see services/reports/.env.example and
# infrastructure/deployment/README.md); no .env file or secret is ever copied into the image. The service holds the
# Supabase anon key only: every query runs with the caller's own token under Row Level Security.
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
# Every workspace manifest, so pnpm validates the lockfile against the whole workspace exactly as it does on a
# developer machine; only the reports service and its workspace dependencies are installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/reports/package.json services/reports/
COPY packages/domain/package.json packages/domain/
COPY packages/service-kit/package.json packages/service-kit/
COPY packages/api-client/package.json packages/api-client/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY tests/package.json tests/

# ----------------------------------------------------------------------------- build
FROM pnpm AS build
RUN pnpm install --frozen-lockfile --filter "@leaseguard/reports..."
COPY packages/domain/tsconfig.json packages/domain/tsconfig.build.json packages/domain/
COPY packages/domain/src packages/domain/src
COPY packages/service-kit/tsconfig.json packages/service-kit/tsconfig.build.json packages/service-kit/
COPY packages/service-kit/scripts packages/service-kit/scripts
COPY packages/service-kit/src packages/service-kit/src
COPY services/reports/tsconfig.json services/reports/tsconfig.build.json services/reports/
COPY services/reports/src services/reports/src
# The service's `build` script builds @leaseguard/domain and @leaseguard/service-kit first, then compiles into dist/.
RUN pnpm --filter "@leaseguard/reports" build

# ----------------------------------------------------------------------------- production dependencies
FROM pnpm AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@leaseguard/reports..."

# ----------------------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    REPORTS_PORT=3100
WORKDIR /app
# The same workspace layout as the repository, so pnpm's relative symlinks (including the workspace links to
# packages/domain and packages/service-kit) resolve unchanged.
COPY --from=prod-deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/domain/package.json packages/domain/
COPY --from=prod-deps /app/packages/domain/node_modules packages/domain/node_modules
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=prod-deps /app/packages/service-kit/package.json packages/service-kit/
COPY --from=prod-deps /app/packages/service-kit/node_modules packages/service-kit/node_modules
COPY --from=build /app/packages/service-kit/dist packages/service-kit/dist
COPY --from=prod-deps /app/services/reports/package.json services/reports/
COPY --from=prod-deps /app/services/reports/node_modules services/reports/node_modules
COPY --from=build /app/services/reports/dist services/reports/dist

WORKDIR /app/services/reports
# The `node` user (uid 1000) ships with the base image; the application files stay root-owned and read-only for it.
USER node
EXPOSE 3100
# Liveness (GET /health). Readiness, which also checks Redis and Supabase, is GET /health/ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.REPORTS_PORT || 3100) + '/health', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
