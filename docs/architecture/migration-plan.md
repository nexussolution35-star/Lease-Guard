# Repository migration plan and log

Migration of LeaseGuard from a single Vite package to the approved pnpm monorepo
(frontend, backend, python-services, packages, supabase, infrastructure). Planned and revised on
7 November 2026; status updated 9 November 2026.

The first stages were committed one per stage (on `migration/monorepo`, now also on `develop`). The
later stages are in the current uncommitted change set on `develop`, called "this change set" below.

Commit hashes: the history was rewritten once to remove commit trailers, which changed every hash but
no file. The original baseline `5f12f53` is now `9795218`, and the original move commit `10e73b5` is
now `4b5c21a` (identical trees; the originals survive on the `backup/*-before-trailer-removal`
branches). This log uses the current hashes.

## Audit results (measured before the migration)

### Component inventory before migration

Counted on the filesystem. "Components" are non-test `.tsx` files exporting components.

| Directory | Components | Helper `.ts` | Test helpers | Tests | Notes |
| --- | --- | --- | --- | --- | --- |
| `components/ui` | 35 | 0 | 0 | 0 | shadcn/ui primitives |
| `components/shared` | 34 | 3 | 0 | 7 | 33 specified plus `AppLink` |
| `components/forms` | 17 | 9 | 1 (`testHarness.tsx`) | 7 | 15 specified plus `FieldMessage`, `RequiredIndicator` |
| `components/layout` | 20 | 2 | 1 (`testRouter.tsx`) | 2 | 17 specified plus `RecordNotFound`, `ResetDemoDataDialog`, `ScreenPlaceholder` |

Current counts are in [the component progress tracker](../COMPONENT_IMPLEMENTATION_PROGRESS.md).
`ScreenPlaceholder` is still used by most route files and must be removed when the last route gets
its real screen.

### Verification before migration (baseline `9795218`)

| Command | Exit code | Result |
| --- | --- | --- |
| `pnpm exec tsc -b --noEmit` | 0 | no errors |
| `pnpm lint` | 0 | 0 errors, 6 `only-export-components` warnings in shadcn primitives |
| `pnpm exec vitest run` | 0 | 44 files, 383 tests passed |
| `pnpm build` | 0 | built |

### Git and backup

- `main` had no commits. A full archive was created before any move at
  `../LeaseGuard-backups/LeaseGuard-20261107-pre-monorepo.tar.gz`
  (SHA-256 `9d5f2a98…3d22`). It was extracted to a temporary folder and all 324 files matched the
  source tree by SHA-256.
- The baseline commit holds 301 files after reviewing the staged list for secrets and build
  output. `CLAUDE.md` and `.agents/` stay untracked because `.gitignore` excludes them.
- Migration commits used `git mv` so history follows files.

### Docker

- Colima runs Docker Server 29.5.2. A throwaway Redis 7.4 container started, answered `PONG` and was
  removed, so plain `docker run` works.
- **The Docker Compose plugin is not installed** (`docker compose` and `docker-compose` are both
  missing); on 9 November buildx was found missing as well. Outcome: `infrastructure/scripts/compose.sh` (behind
  `pnpm docker:*`) falls back to Compose in the `docker:29-cli` image, and the Dockerfiles avoid
  BuildKit-only syntax so they also build with the legacy builder. See
  [local setup](../development/local-setup.md).
- The Supabase CLI was first run through `npx`; it is now a root devDependency (`supabase` 3.0.0)
  used by the `db:*` scripts. Its local stack provides the only Postgres instance;
  `docker-compose.yml` does not add another.

## Decisions

1. **`packages/domain` (`@leaseguard/domain`).** Domain types and pure rules shared by the backend
   and the frontend demo. No framework imports, no I/O, no clock reads. The backend executes the
   rules authoritatively; the frontend demo reuses them. Neither imports the other's internals.
   The package publishes TypeScript source under the `@leaseguard/source` export condition for
   Vite and tests, and compiled ESM for Node.
2. **Backend owns authoritative behaviour.** Financial calculations, monitoring, eligibility and
   approvals run in the NestJS backend using `@leaseguard/domain`. Python only extracts and validates.
3. **Generated API client.** `packages/api-client` is generated from the backend OpenAPI document.
   No hand-written duplicate contracts.
   *Outcome:* `packages/api-client` (`@leaseguard/api-client`) exists. `pnpm api:generate` writes
   `backend/openapi.json` and regenerates `packages/api-client/src/generated/schema.ts` with
   openapi-typescript; the runtime client wraps openapi-fetch (`createApiClient`, `unwrap`,
   `ApiError`). See [API conventions](../api/README.md).
4. **Simulated frontend layer retained** under `frontend/src/services` until each backend module
   has real endpoints. Demo-only functions such as simulated extraction and delivery never become
   backend endpoints.
   *Outcome:* the simulated layer moved to `frontend/src/services/demo` and is used only when
   `VITE_DATA_SOURCE=demo`. Screens read data through per-feature sources in
   `frontend/src/features/<feature>/api`, each with a demo and an API implementation selected by
   `VITE_DATA_SOURCE`. API mode never seeds or shows demo data. See
   [the frontend data layer](frontend-data-layer.md).
5. **One environment file.** `.env.example` at the root; every app reads the root `.env`.
   *Outcome:* each process validates and loads only the variables its own schema declares (see
   [Security model](../security/README.md#least-privilege-configuration)).
6. **Database access through RLS.** API requests use a Supabase client carrying the caller's JWT.
   The service-role client is for workers only, with explicit `company_id` filters.
   *Outcome:* implemented as decided (`RlsClientFactory` in the API, `ServiceRoleClientFactory`
   provided only by `WorkersModule`).

## File mapping (executed in `4b5c21a`)

| From | To | Action |
| --- | --- | --- |
| `index.html`, `vite.config.ts`, `tsconfig*.json`, `components.json`, `.oxlintrc.json`, `public/favicon.svg` | `frontend/` | Moved |
| `package.json` | `frontend/package.json`, new root `package.json` | Split |
| `src/routes/**` | `frontend/src/app/router/routes/**` | Moved |
| router creation in `main.tsx` | `frontend/src/app/router/router.ts` | Extracted |
| providers inside `AppLayout` | `frontend/src/app/providers/AppProviders.tsx` | Consolidated |
| root route components | `frontend/src/app/layouts/RootLayout.tsx` | Extracted |
| `src/index.css` | `frontend/src/styles/globals.css` | Moved |
| `src/components`, `lib`, `store`, `services`, `test`, `main.tsx` | `frontend/src/…` | Moved |
| `src/data/**` | `frontend/src/services/demo/seed/**` | Moved |
| `src/domain/seedConsistency.test.ts` | `frontend/src/services/demo/seed/` | Moved; it tests demo data |
| `src/domain/**` | `packages/domain/src/rules/**` | Moved |
| `src/types/**` | `packages/domain/src/types/**` | Moved |
| `docs/architecture.md` | `docs/architecture/frontend-data-layer.md` | Moved |
| `docs/components.md` | `docs/development/frontend-components.md` | Moved |
| `public/icons.svg` | — | Removed: Vite template asset, unreferenced |
| `next-themes`, `@hookform/resolvers`, `@tanstack/router-devtools` | — | Removed: no imports |
| `dist/`, `.tanstack/` | — | Removed: build output and cache |

In this change set the store-backed frontend services in `frontend/src/services/` moved to
`frontend/src/services/demo/` (only the pure list helpers in `frontend/src/services/query.ts`
stayed), and `frontend/src/services/api/` was added.

## Sequence and status

| Stage | Status | Evidence |
| --- | --- | --- |
| 1. Audit, backup, Git baseline | Done | Archive verified; baseline `9795218` |
| 2. Frontend into `frontend/`, domain package | Done | `4b5c21a`; at that commit: 383 tests, typecheck, lint, builds, dev server |
| 3. pnpm workspace and root scripts | Done | `pnpm-workspace.yaml` (`frontend`, `backend`, `packages/*`, `tests`); root scripts for dev, build, test, `db:*`, `api:generate`, `python:*`, `docker:*` (this change set) |
| 4. Backend foundation and workers | Done | Skeleton in `755f4b1`; business modules, guards, error filter, queues, worker processors, scheduler and job-run recording in this change set. Unit tests: `backend/src/**/*.test.ts` |
| 5. Supabase schema, RLS, storage, seed | Done | 17 migrations, 4 pgTAP files in `supabase/tests`, generated `supabase/seed.sql` (this change set). See [Database](../database/README.md) |
| 6. Python document-processing service | Done | `python-services/document-processing` with pytest suite and contract parity test (this change set) |
| 7. Service-contract fixes and reconciliation | Done in this change set | The 19 review findings are not itemised in this document |
| 8. Docker Compose, API client, start checks | Done | `docker-compose.yml` and `compose.sh`; `packages/api-client`; start-up environment validation in every process; `/health/ready` probes (this change set) |
| 9. Documentation | Done | Root `README.md` (`5518db9`); `frontend/README.md`, `tests/README.md`, the document-processing and `infrastructure/` READMEs, and `docs/` (this change set) |
| 10. Full verification and review | Pending | Results for this change set are not recorded here |

Test suites available for stage 10: `pnpm typecheck`, `pnpm lint`, `pnpm test` (domain, API client,
backend, frontend), `pnpm python:test`, `pnpm db:test`, `pnpm test:integration` and `pnpm test:e2e`.
